import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs, users, spaceOwners } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { buildMcpHandler } from "./server.js";
import { Fts5Provider } from "../search/provider.js";

let db: DB;
let blobs: DiskBlobStore;
let app: Hono;
let orgId: string;
let spaceId: string;
let ownerUserId: string;
let mcpTok: string;   // scopes: ["mcp"]
let mcpTokB: string;  // a different org's mcp token (tenant isolation)

const APP = "https://app";
const VIEW = "https://view";

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-session-")));
  db = openDb(":memory:");

  const provider = new Fts5Provider(db, blobs);
  const handler = buildMcpHandler({ db, blobs, appOrigin: APP, viewOrigin: VIEW, signingSecret: "s" }, { searchProvider: provider });
  app = new Hono();
  app.all("/mcp", (c) => handler(c.req.raw));

  orgId = newId(); spaceId = newId();
  ownerUserId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();

  // push_doc creates in_review versions, so reads need the unapproved scope.
  mcpTok = createToken(db, { orgId }, "mcp", ["mcp", "unapproved"]).raw;

  // A second, unrelated org — its token must never see Acme's docs/sessions.
  const orgB = newId();
  db.insert(orgs).values({ id: orgB, name: "Other", slug: "other" }).run();
  mcpTokB = createToken(db, { orgId: orgB }, "mcpB", ["mcp", "unapproved"]).raw;
});

/** Initialize a session, then call a tool. Returns the parsed CallToolResult text. */
async function callTool(
  tool: string,
  args: Record<string, unknown>,
  bearer: string,
): Promise<{ isError?: boolean; text: string; raw: any }> {
  await (await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } } }),
  })).text();
  await (await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  })).text();

  const callRes = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  expect(callRes.status).toBe(200);
  const bodyText = await callRes.text();
  const events = bodyText.split("\n\n").map((e) => e.trim()).filter(Boolean);
  let lastJson: any = null;
  for (const e of events) {
    for (const line of e.split("\n")) {
      if (line.startsWith("data: ")) {
        try { lastJson = JSON.parse(line.slice("data: ".length)); } catch { /* skip */ }
      }
    }
  }
  if (!lastJson) throw new Error(`no JSON-RPC message in response: ${bodyText.slice(0, 200)}`);
  const result = lastJson.result;
  return { isError: result?.isError, text: result?.content?.[0]?.text ?? "", raw: result };
}

const TRANSCRIPT = "USER: build the auth flow\nAGENT: done, here is the HTML\n";

describe("session provenance via MCP", () => {
  it("push_doc with a session -> get_doc WITHOUT include_session: has_session true, no session field", async () => {
    const pr = await callTool("push_doc", { space: "backend", slug: "auth-flow", html: "<h1>Auth</h1>", title: "Auth", session: TRANSCRIPT }, mcpTok);
    expect(pr.isError).toBeFalsy();

    const r = await callTool("get_doc", { space: "backend", slug: "auth-flow", include_unapproved: true }, mcpTok);
    const env = JSON.parse(r.text);
    expect(env.metadata.has_session).toBe(true);
    expect(env.session).toBeUndefined();
  });

  it("get_doc WITH include_session: returns the transcript text", async () => {
    await callTool("push_doc", { space: "backend", slug: "auth-flow", html: "<h1>Auth</h1>", title: "Auth", session: TRANSCRIPT }, mcpTok);

    const r = await callTool("get_doc", { space: "backend", slug: "auth-flow", include_unapproved: true, include_session: true }, mcpTok);
    const env = JSON.parse(r.text);
    expect(env.metadata.has_session).toBe(true);
    expect(env.session).toBe(TRANSCRIPT);
  });

  it("a version with no session reports has_session false and no session even with include_session", async () => {
    await callTool("push_doc", { space: "backend", slug: "no-sess", html: "<h1>Plain</h1>", title: "Plain" }, mcpTok);

    const r = await callTool("get_doc", { space: "backend", slug: "no-sess", include_unapproved: true, include_session: true }, mcpTok);
    const env = JSON.parse(r.text);
    expect(env.metadata.has_session).toBe(false);
    expect(env.session).toBeUndefined();
  });

  it("tenant isolation: another org cannot read the session or the doc", async () => {
    await callTool("push_doc", { space: "backend", slug: "auth-flow", html: "<h1>Auth</h1>", title: "Auth", session: TRANSCRIPT }, mcpTok);

    const r = await callTool("get_doc", { space: "backend", slug: "auth-flow", include_unapproved: true, include_session: true }, mcpTokB);
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.text);
    expect(body.error).toBe("not_found");
  });
});
