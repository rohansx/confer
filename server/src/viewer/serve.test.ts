import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDb } from "../db/client.js";
import { DiskBlobStore } from "../blob/disk.js";
import { viewerRoutes } from "./serve.js";
import { signContentUrl } from "./signed-url.js";
import { CONTENT_CSP } from "./csp.js";

const secret = "s3cr3t";
const view = "http://view.local";
let app: Hono;
let blobs: DiskBlobStore;
let hash: string;

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-view-")));
  hash = await blobs.put(new TextEncoder().encode("<h1>hello</h1>"));
  const deps = {
    db: openDb(":memory:"),
    blobs,
    appOrigin: "http://app.local",
    viewOrigin: view,
    signingSecret: secret,
  };
  app = new Hono();
  app.route("/", viewerRoutes(deps));
});

const rel = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

describe("viewer content serving", () => {
  it("serves signed content with the EXACT CSP and no cookies", async () => {
    const res = await app.request(rel(signContentUrl(view, secret, hash, "org1", 300)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("<h1>hello</h1>");
  });

  it("rejects an unsigned request (403)", async () => {
    expect((await app.request(`/c/${hash}`)).status).toBe(403);
  });

  it("rejects a tampered signature (403)", async () => {
    const p = rel(signContentUrl(view, secret, hash, "org1", 300)).replace(/s=[^&]+/, "s=bad");
    expect((await app.request(p)).status).toBe(403);
  });

  it("returns 404 for a valid signature over an absent blob", async () => {
    const res = await app.request(rel(signContentUrl(view, secret, "0".repeat(64), "org1", 300)));
    expect(res.status).toBe(404);
  });
});
