import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDb, newId, type DB } from "../db/client.js";
import {
  orgs, spaces, docs, versions, users, spaceOwners,
} from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createVersion } from "../versions/create.js";
import { approve } from "../review/approve.js";
import { reject } from "../review/reject.js";
import { buildMcpHandler } from "./server.js";
import { Fts5Provider } from "../search/provider.js";

let db: DB;
let blobs: DiskBlobStore;
let app: Hono;
let orgId: string;
let spaceId: string;
let docA: string, docB: string;
let ownerUserId: string;
let mcpOnly: string;          // scopes: ["mcp"]
let mcpPlusUnapproved: string; // scopes: ["mcp", "unapproved"]
let pushTok: string;          // scopes: ["push"]
let readTok: string;          // scopes: ["read"]

const APP = "https://app";
const VIEW = "https://view";

async function push(docId: string, html: string, opts: { commitSha?: string; repo?: string } = {}) {
  const r = await createVersion(
    { db, blobs, appOrigin: APP },
    { orgId, spaceId, docId, html: new TextEncoder().encode(html), draft: false, provenance: { authorType: "agent", authorName: "ci", sourceRepo: opts.repo, commitSha: opts.commitSha, branch: "main" } },
  );
  return r.versionId;
}

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-mcp-")));
  db = openDb(":memory:");

  const provider = new Fts5Provider(db, blobs);
  const handler = buildMcpHandler({ db, blobs, appOrigin: APP, viewOrigin: VIEW, signingSecret: "s" }, { searchProvider: provider });
  app = new Hono();
  app.all("/mcp", (c) => handler(c.req.raw));

  orgId = newId(); spaceId = newId();
  docA = newId(); docB = newId();
  ownerUserId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docA, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();
  db.insert(docs).values({ id: docB, spaceId, slug: "deploy", title: "Deployment" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();

  mcpOnly = createToken(db, orgId, "mcp", ["mcp"]).raw;
  mcpPlusUnapproved = createToken(db, orgId, "mcp+", ["mcp", "unapproved"]).raw;
  pushTok = createToken(db, orgId, "push", ["push"]).raw;
  readTok = createToken(db, orgId, "read", ["read"]).raw;
});

/** Initialize a session, then call a tool. Returns the parsed CallToolResult text. */
async function callTool(
  tool: string,
  args: Record<string, unknown>,
  bearer: string,
): Promise<{ isError?: boolean; text: string; raw: any }> {
  // 1) initialize
  const initRes = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
  });
  expect(initRes.status).toBe(200);
  await initRes.text(); // drain

  // 2) send initialized notification
  const notifRes = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  await notifRes.text();

  // 3) call the tool
  const callRes = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  expect(callRes.status).toBe(200);
  const bodyText = await callRes.text();
  // The response is an SSE stream: "event: message\ndata: <json>\n\n" per event.
  // Extract the LAST data line from the LAST event.
  const events = bodyText.split("\n\n").map((e) => e.trim()).filter(Boolean);
  let lastJson: any = null;
  for (const e of events) {
    for (const line of e.split("\n")) {
      if (line.startsWith("data: ")) {
        try { lastJson = JSON.parse(line.slice("data: ".length)); } catch { /* skip non-JSON lines */ }
      }
    }
  }
  if (!lastJson) throw new Error(`no JSON-RPC message in response: ${bodyText.slice(0, 200)}`);
  const result = lastJson.result;
  return {
    isError: result?.isError,
    text: result?.content?.[0]?.text ?? "",
    raw: result,
  };
}

// ===========================================================================
//   AUTH
// ===========================================================================
describe("MCP auth", () => {
  it("rejects requests with no token", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token without mcp scope (push-only)", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pushTok}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown token", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer confer_invalid`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
//   THE PRODUCT INVARIANT
//   No MCP read path returns unapproved content unless explicitly opted in
//   AND the token scope allows it.
// ===========================================================================
describe("THE PRODUCT INVARIANT: approved-only by default", () => {
  beforeEach(async () => {
    // Build a rich test corpus:
    //   docA (auth-flow): v1 approved, v2 in_review, v3 rejected
    //   docB (deploy):   v1 in_review (no approved version)
    const a1 = await push(docA, "<h1>Auth flow production</h1>");
    approve(db, { versionId: a1, userId: ownerUserId, now: 1 });
    const a2 = await push(docA, "<h1>Auth flow draft two</h1>");
    // v2 stays in_review
    const a3 = await push(docA, "<h1>Auth flow rejected three</h1>");
    reject(db, { versionId: a3, userId: ownerUserId, reason: "out of scope", now: 3 });
    const b1 = await push(docB, "<h1>Deployment runbook</h1>");
    // b1 stays in_review
  });

  it("search_docs with mcp-only token returns ONLY approved hits, even with include_unapproved=true", async () => {
    const r = await callTool("search_docs", { query: "auth" }, mcpOnly);
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.text);
    expect(body.included_unapproved).toBe(false);
    expect(body.count).toBe(1);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].state).toBe("approved");
    expect(body.hits[0].approved_by).toBe(ownerUserId);
  });

  it("search_docs with mcp-only token: include_unapproved=true is silently ignored", async () => {
    const r = await callTool("search_docs", { query: "auth", include_unapproved: true }, mcpOnly);
    const body = JSON.parse(r.text);
    expect(body.included_unapproved).toBe(false);
    expect(body.count).toBe(1);
    expect(body.hits.every((h: any) => h.state === "approved")).toBe(true);
  });

  it("search_docs with mcp+unapproved token: include_unapproved=true surfaces everything", async () => {
    const r = await callTool("search_docs", { query: "auth", include_unapproved: true }, mcpPlusUnapproved);
    const body = JSON.parse(r.text);
    expect(body.included_unapproved).toBe(true);
    // v1 approved, v2 in_review, v3 rejected — all 3 contain "auth"
    expect(body.count).toBe(3);
    const states = new Set(body.hits.map((h: any) => h.state));
    expect(states).toEqual(new Set(["approved", "in_review", "rejected"]));
  });

  it("get_doc with mcp-only token: returns null for an in_review-only doc", async () => {
    const r = await callTool("get_doc", { space: "backend", slug: "deploy" }, mcpOnly);
    expect(r.isError).toBe(true);
    const body = JSON.parse(r.text);
    expect(body.error).toBe("not_found");
  });

  it("get_doc with mcp-only token: returns the approved version (NOT the in_review newer one) for auth-flow", async () => {
    const r = await callTool("get_doc", { space: "backend", slug: "auth-flow" }, mcpOnly);
    const env = JSON.parse(r.text);
    expect(env.type).toBe("confer_doc");
    expect(env.metadata.state).toBe("approved");
    expect(env.metadata.version_number).toBe(1);
    expect(env.content).toContain("Auth flow production");
    // The note is the data-envelope marker.
    expect(env.note).toMatch(/data/);
  });

  it("get_doc with mcp+unapproved token: returns the latest in_review version of deploy", async () => {
    const r = await callTool("get_doc", { space: "backend", slug: "deploy", include_unapproved: true }, mcpPlusUnapproved);
    const env = JSON.parse(r.text);
    expect(env.metadata.state).toBe("in_review");
    expect(env.content).toContain("Deployment runbook");
  });

  it("list_docs with mcp-only token: returns ONLY docs whose latest allowed-state version is approved", async () => {
    const r = await callTool("list_docs", {}, mcpOnly);
    const body = JSON.parse(r.text);
    expect(body.included_unapproved).toBe(false);
    // auth-flow has an approved v1 (so it appears); deploy has only in_review (so it doesn't).
    const slugs = body.docs.map((d: any) => d.slug);
    expect(slugs).toContain("auth-flow");
    expect(slugs).not.toContain("deploy");
  });

  it("list_docs with mcp+unapproved token: returns everything (in_review, rejected, approved)", async () => {
    const r = await callTool("list_docs", { include_unapproved: true }, mcpPlusUnapproved);
    const body = JSON.parse(r.text);
    expect(body.included_unapproved).toBe(true);
    const slugs = body.docs.map((d: any) => d.slug);
    expect(slugs).toContain("auth-flow");
    expect(slugs).toContain("deploy");
  });
});

// ===========================================================================
//   push_doc
// ===========================================================================
describe("push_doc", () => {
  it("creates an in_review version — never approved (the other half of the invariant)", async () => {
    const r = await callTool(
      "push_doc",
      { space: "backend", slug: "fresh-doc", html: "<h1>Fresh</h1>", title: "Fresh", metadata: { commit_sha: "freshsha" } },
      mcpOnly,
    );
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.text);
    expect(body.state).toBe("in_review");
    expect(body.version_id).toBeTruthy();
    expect(body.review_url).toContain(body.version_id);
    expect(body.deduped).toBe(false);
  });

  it("a second push with identical content is deduped (returns the same version_id)", async () => {
    const r1 = await callTool("push_doc", { space: "backend", slug: "fresh-doc", html: "<h1>Fresh</h1>" }, mcpOnly);
    const v1 = JSON.parse(r1.text).version_id;
    const r2 = await callTool("push_doc", { space: "backend", slug: "fresh-doc", html: "<h1>Fresh</h1>" }, mcpOnly);
    const v2 = JSON.parse(r2.text).version_id;
    expect(v1).toBe(v2);
  });

  it("a push token cannot call push_doc (mcp scope required)", async () => {
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pushTok}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(403);
  });
});

// ===========================================================================
//   search filter coverage (province of the SearchProvider, but tested
//   through the MCP layer for integration confidence).
// ===========================================================================
describe("search filter coverage via MCP", () => {
  it("repo filter narrows the hits", async () => {
    const a = await push(docA, "<h1>alpha content</h1>", { repo: "acme/api" });
    approve(db, { versionId: a, userId: ownerUserId, now: 1 });
    const b = await push(docB, "<h1>beta content</h1>", { repo: "acme/web" });
    approve(db, { versionId: b, userId: ownerUserId, now: 1 });

    const r = await callTool("search_docs", { query: "content", repo: "acme/api" }, mcpOnly);
    const body = JSON.parse(r.text);
    expect(body.count).toBe(1);
    expect(body.hits[0].source_repo).toBe("acme/api");
  });
});
