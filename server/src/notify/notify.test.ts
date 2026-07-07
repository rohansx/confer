import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs, users, spaceOwners } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createVersion } from "../versions/create.js";
import { approve } from "../review/approve.js";
import { reject } from "../review/reject.js";
import { buildApp } from "../app.js";
import { queue, notify, type Notification } from "./queue.js";
import { resetForTests, bootNotify } from "./index.js";
import { consoleTransport } from "./email.js";

let db: DB;
let blobs: DiskBlobStore;
let orgId: string;
let spaceId: string;
let docId: string;
let ownerUserId: string;
let ownerSession: string;
let pushTok: string;

const APP = "https://app";
const VIEW = "https://view";

beforeEach(() => {
  resetForTests();
});

describe("notify module", () => {
  it("captures emitted notifications", () => {
    notify({ kind: "version.approved", orgId: "o1", payload: { docSlug: "x" } });
    expect(queue.emitted).toHaveLength(1);
    expect(queue.emitted[0]?.kind).toBe("version.approved");
    expect(queue.emitted[0]?.payload.docSlug).toBe("x");
  });

  it("transports receive notifications (async, via microtask)", async () => {
    const received: Notification[] = [];
    queue.register({
      name: "test",
      send: (n) => { received.push(n); },
    });
    notify({ kind: "comment.created", orgId: "o1", payload: {} });
    // Yield to the microtask queue.
    await Promise.resolve();
    expect(received).toHaveLength(1);
  });

  it("a throwing transport does not break the others", async () => {
    const received: Notification[] = [];
    queue.register({ name: "throwing", send: () => { throw new Error("nope"); } });
    queue.register({ name: "ok", send: (n) => { received.push(n); } });
    notify({ kind: "version.pushed", orgId: "o1", payload: { x: 1 } });
    await Promise.resolve();
    expect(received).toHaveLength(1);
  });
});

describe("notifications wired into the loop", () => {
  beforeEach(async () => {
    blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-notify-")));
    db = openDb(":memory:");
    orgId = newId(); spaceId = newId(); docId = newId();
    ownerUserId = newId();
    db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
    db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
    db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
    db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
    db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();
    ownerSession = createSessionCookie("s", ownerUserId, 600).value;
    pushTok = createToken(db, orgId, "ci", ["push"]).raw;
  });

  it("emits version.pushed on a new in_review version", async () => {
    await createVersion(
      { db, blobs, appOrigin: APP },
      { orgId, spaceId, docId, html: new TextEncoder().encode("<p>hi</p>"), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
    );
    const kinds = queue.emitted.map((n) => n.kind);
    expect(kinds).toContain("version.pushed");
  });

  it("does NOT emit version.pushed for a draft", async () => {
    await createVersion(
      { db, blobs, appOrigin: APP },
      { orgId, spaceId, docId, html: new TextEncoder().encode("<p>hi</p>"), draft: true, provenance: { authorType: "agent", authorName: "ci" } },
    );
    const kinds = queue.emitted.map((n) => n.kind);
    expect(kinds).not.toContain("version.pushed");
  });

  it("emits version.approved on approve", async () => {
    const v = await createVersion(
      { db, blobs, appOrigin: APP },
      { orgId, spaceId, docId, html: new TextEncoder().encode("<p>hi</p>"), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
    );
    queue.emitted.length = 0;
    approve(db, { versionId: v.versionId, userId: ownerUserId, now: 1 });
    await Promise.resolve(); // let the queued microtask run
    const kinds = queue.emitted.map((n) => n.kind);
    expect(kinds).toContain("version.approved");
  });

  it("emits version.rejected on reject", async () => {
    const v = await createVersion(
      { db, blobs, appOrigin: APP },
      { orgId, spaceId, docId, html: new TextEncoder().encode("<p>hi</p>"), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
    );
    queue.emitted.length = 0;
    reject(db, { versionId: v.versionId, userId: ownerUserId, reason: "no", now: 1 });
    await Promise.resolve(); // let the queued microtask run
    const kinds = queue.emitted.map((n) => n.kind);
    expect(kinds).toContain("version.rejected");
  });

  it("console transport writes a NOTIFY line", async () => {
    // Manually register the console transport for this test (bootNotify
    // requires the server to be booted).
    queue.register(consoleTransport);
    const original = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as any).write = (c: any) => { captured += String(c); return true; };
    try {
      notify({ kind: "version.pushed", orgId: "o", payload: { docSlug: "x" } });
      await Promise.resolve();
    } finally {
      (process.stdout as any).write = original;
    }
    expect(captured).toMatch(/NOTIFY/);
    expect(captured).toMatch(/"kind":"version.pushed"/);
  });
});
