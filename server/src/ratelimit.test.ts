import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimit, keyByAuthOrIp } from "./ratelimit.js";

describe("rateLimit", () => {
  it("allows up to max, then 429 with Retry-After", async () => {
    const app = new Hono();
    const limiter = rateLimit({ windowMs: 1000, max: 2, keyFn: keyByAuthOrIp });
    app.get("/x", limiter, (c) => c.json({ ok: true }));

    const r1 = await app.request("/x", { headers: { authorization: "Bearer t" } });
    const r2 = await app.request("/x", { headers: { authorization: "Bearer t" } });
    const r3 = await app.request("/x", { headers: { authorization: "Bearer t" } });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBe("1");
    const j = (await r3.json()) as { error: string };
    expect(j.error).toMatch(/rate limit/);
  });

  it("counts keys independently (per token)", async () => {
    const app = new Hono();
    const limiter = rateLimit({ windowMs: 1000, max: 1, keyFn: keyByAuthOrIp });
    app.get("/x", limiter, (c) => c.json({ ok: true }));

    const a1 = await app.request("/x", { headers: { authorization: "Bearer A" } });
    const b1 = await app.request("/x", { headers: { authorization: "Bearer B" } });
    expect(a1.status).toBe(200);
    expect(b1.status).toBe(200); // different token → different bucket

    const a2 = await app.request("/x", { headers: { authorization: "Bearer A" } });
    expect(a2.status).toBe(429);
  });
});