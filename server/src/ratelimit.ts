import type { Context, Next } from "hono";

interface RateLimitOpts {
  windowMs: number;
  max: number;
  keyFn: (c: Context) => string;
  message?: string;
}

/**
 * Tiny sliding-window in-memory rate limiter. Fine for a single self-hosted
 * node; for horizontal scale swap for Redis-backed. Buckets are pruned on the
 * same cadade as the window (the pruner is unref'd so it never keeps a test
 * process alive).
 */
export function rateLimit(opts: RateLimitOpts) {
  const buckets = new Map<string, number[]>();
  const pruner = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, arr] of buckets) {
      const recent = arr.filter((t) => t > cutoff);
      if (recent.length === 0) buckets.delete(k);
      else buckets.set(k, recent);
    }
  }, opts.windowMs);
  pruner.unref?.();

  return async (c: Context, next: Next) => {
    const key = opts.keyFn(c);
    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const arr = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= opts.max) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ success: false, data: null, error: opts.message ?? "rate limit exceeded" }, 429);
    }
    arr.push(now);
    buckets.set(key, arr);
    await next();
  };
}

/** Key by bearer token / cookie, falling back to the request IP. */
export function keyByAuthOrIp(c: Context): string {
  const auth = c.req.header("authorization") ?? c.req.header("cookie") ?? "";
  if (auth) return "a:" + auth.slice(0, 64);
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  return "ip:" + ip;
}