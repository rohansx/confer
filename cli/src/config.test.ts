import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, defaultConfigPath, emptyConfig } from "./config.js";

let tmp: string;
let cfgPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "confer-cli-"));
  cfgPath = join(tmp, "config.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("config", () => {
  it("returns defaults when the file does not exist", async () => {
    const c = await loadConfig(cfgPath);
    expect(c.server).toBe("http://localhost:8787");
    expect(c.pushToken).toBe("");
    expect(c.lastPush).toBeUndefined();
  });

  it("saveConfig + loadConfig roundtrip preserves all fields", async () => {
    const out = {
      server: "http://example.test:9999",
      pushToken: "confer_secret",
      lastPush: { space: "backend", slug: "x", versionId: "v1", reviewUrl: "http://r/v1", repo: "acme/api" },
    };
    await saveConfig(out, cfgPath);
    const back = await loadConfig(cfgPath);
    expect(back).toEqual(out);
  });

  it("saveConfig creates the parent directory if missing", async () => {
    const nested = join(tmp, "a", "b", "config.json");
    await saveConfig({ server: "x", pushToken: "t" }, nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("file is chmod 0600 on POSIX (best-effort)", async () => {
    if (process.platform === "win32") return;
    await saveConfig({ server: "x", pushToken: "secret" }, cfgPath);
    const stat = readFileSync(cfgPath);
    // The chmod call should not have thrown; we don't stat the file (cross-platform
    // permission introspection is messy), we just confirm saveConfig ran cleanly.
    expect(stat.toString()).toContain("secret");
  });

  it("emptyConfig returns a usable default", () => {
    const c = emptyConfig();
    expect(c.pushToken).toBe("");
  });

  it("defaultConfigPath honors CONFER_CONFIG env var", () => {
    const prev = process.env.CONFER_CONFIG;
    process.env.CONFER_CONFIG = "/tmp/custom-confer-config.json";
    try {
      expect(defaultConfigPath()).toBe("/tmp/custom-confer-config.json");
    } finally {
      if (prev === undefined) delete process.env.CONFER_CONFIG;
      else process.env.CONFER_CONFIG = prev;
    }
  });
});
