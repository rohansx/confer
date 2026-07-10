import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, users, orgMemberships, spaces } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createToken } from "../auth/tokens.js";
import { buildApp } from "../app.js";
import { buildMcpHandler } from "../mcp/server.js";
import { Fts5Provider } from "../search/provider.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
let mcpApp: Hono;
let adminSession: string, memberSession: string, outsiderSession: string;
let orgId: string, otherOrgId: string;
let mcpTok: string, otherOrgMcpTok: string;
const SECRET = "s";

const req = (path: string, init: RequestInit & { authCookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

/** Initialize an MCP session, then call a tool; return the parsed result text. */
async function callTool(tool: string, args: Record<string, unknown>, bearer: string) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` };
  await (await mcpApp.request("/mcp", { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) })).text();
  await (await mcpApp.request("/mcp", { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).text();
  const callRes = await mcpApp.request("/mcp", { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }) });
  const text = await callRes.text();
  let last: any = null;
  for (const e of text.split("\n\n").map((s) => s.trim()).filter(Boolean))
    for (const line of e.split("\n")) if (line.startsWith("data: ")) { try { last = JSON.parse(line.slice(6)); } catch { /* skip */ } }
  const r = last?.result;
  return { isError: r?.isError as boolean | undefined, text: (r?.content?.[0]?.text ?? "") as string };
}

beforeEach(() => {
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-ctx-b-")));
  db = openDb(":memory:");
  const deps = { db, blobs, appOrigin: "https://app", viewOrigin: "https://view", signingSecret: SECRET };
  app = buildApp(deps);
  const handler = buildMcpHandler(deps, { searchProvider: new Fts5Provider(db, blobs) });
  mcpApp = new Hono();
  mcpApp.all("/mcp", (c) => handler(c.req.raw));

  const adminId = newId(), memberId = newId(), outsiderId = newId();
  orgId = newId(); otherOrgId = newId();
  const spaceId = newId();
  db.insert(users).values({ id: adminId, name: "Admin", email: "a@x.test" }).run();
  db.insert(users).values({ id: memberId, name: "Member", email: "m@x.test" }).run();
  db.insert(users).values({ id: outsiderId, name: "Out", email: "o@x.test" }).run();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme", createdById: adminId }).run();
  db.insert(orgs).values({ id: otherOrgId, name: "Globex", slug: "globex", createdById: outsiderId }).run();
  db.insert(orgMemberships).values({ orgId, userId: adminId, role: "admin", createdAt: 0 }).run();
  db.insert(orgMemberships).values({ orgId, userId: memberId, role: "member", createdAt: 0 }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  adminSession = createSessionCookie(SECRET, adminId, 600).value;
  memberSession = createSessionCookie(SECRET, memberId, 600).value;
  outsiderSession = createSessionCookie(SECRET, outsiderId, 600).value;
  mcpTok = createToken(db, { orgId }, "mcp", ["mcp"]).raw;
  otherOrgMcpTok = createToken(db, { orgId: otherOrgId }, "mcp", ["mcp"]).raw;
});

describe("space context — REST", () => {
  it("admin sets context, then it reads back (with can_edit)", async () => {
    const put = await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "Be terse. Cite the doc slug." }) });
    expect(put.status).toBe(200);
    const get = await req("/api/v1/spaces/backend/context", { authCookie: adminSession });
    const body = (await get.json()) as any;
    expect(body.data.context).toBe("Be terse. Cite the doc slug.");
    expect(body.data.can_edit).toBe(true);
  });

  it("a plain org member can read but cannot edit (403, can_edit=false)", async () => {
    await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "hello" }) });
    const get = await req("/api/v1/spaces/backend/context", { authCookie: memberSession });
    expect(((await get.json()) as any).data.can_edit).toBe(false);
    const put = await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: memberSession, body: JSON.stringify({ context: "nope" }) });
    expect(put.status).toBe(403);
  });

  it("an outsider cannot see the space (404)", async () => {
    expect((await req("/api/v1/spaces/backend/context", { authCookie: outsiderSession })).status).toBe(404);
  });

  it("empty context clears it back to blank", async () => {
    await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "x" }) });
    await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "" }) });
    const body = (await (await req("/api/v1/spaces/backend/context", { authCookie: adminSession })).json()) as any;
    expect(body.data.context).toBe("");
  });
});

describe("space context — MCP get_context", () => {
  it("returns the context to an mcp token scoped to the space's org", async () => {
    await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "system prompt here" }) });
    const r = await callTool("get_context", { space: "backend" }, mcpTok);
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.text).context).toBe("system prompt here");
  });

  it("does not leak the context to a token from another org", async () => {
    await req("/api/v1/spaces/backend/context", { method: "PUT", authCookie: adminSession, body: JSON.stringify({ context: "secret framing" }) });
    const r = await callTool("get_context", { space: "backend" }, otherOrgMcpTok);
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("secret framing");
  });
});
