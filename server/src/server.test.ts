import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db/client.js";
import { DiskBlobStore } from "./blob/disk.js";
import { buildServer } from "./server.js";
import { signContentUrl } from "./viewer/signed-url.js";
import { CONTENT_CSP } from "./viewer/csp.js";

const secret = "s3cr3t";
const appOrigin = "http://app.local";
const viewOrigin = "http://view.local";
let server: ReturnType<typeof buildServer>;
let hash: string;

beforeEach(async () => {
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-srv-")));
  hash = await blobs.put(new TextEncoder().encode("<h1>x</h1>"));
  server = buildServer({ db: openDb(":memory:"), blobs, appOrigin, viewOrigin, signingSecret: secret });
});

const req = (url: string, host: string) => server.request(url, { headers: { host } });

describe("host-based two-origin routing", () => {
  it("serves /health on the app host", async () => {
    expect((await req("http://app.local/health", "app.local")).status).toBe(200);
  });

  it("serves signed content on the view host with the exact CSP", async () => {
    const res = await req(signContentUrl(viewOrigin, secret, hash, "org1", 300), "view.local");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_CSP);
  });

  it("does NOT expose the app API on the view host (isolation)", async () => {
    expect((await req("http://view.local/health", "view.local")).status).toBe(404);
  });

  it("does NOT expose content on the app host (isolation)", async () => {
    const u = new URL(signContentUrl(viewOrigin, secret, hash, "org1", 300));
    const res = await req(`http://app.local${u.pathname}${u.search}`, "app.local");
    expect(res.status).toBe(404);
  });
});
