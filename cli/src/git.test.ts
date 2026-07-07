import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getProvenance, deriveSourceRepo } from "./git.js";

describe("deriveSourceRepo", () => {
  it("converts SSH scp-style URLs", () => {
    expect(deriveSourceRepo("git@github.com:acme/api.git")).toBe("acme/api");
    // GitLab supports nested groups: git@gitlab.com:group/sub/repo.git → "group/sub/repo"
    expect(deriveSourceRepo("git@gitlab.com:group/sub/repo.git")).toBe("group/sub/repo");
  });

  it("converts HTTPS URLs", () => {
    expect(deriveSourceRepo("https://github.com/acme/api.git")).toBe("acme/api");
    expect(deriveSourceRepo("https://gitlab.com/group/api")).toBe("group/api");
  });

  it("handles ssh:// scheme", () => {
    expect(deriveSourceRepo("ssh://git@gitlab.com/group/api.git")).toBe("group/api");
  });

  it("returns empty for empty or unparseable input", () => {
    expect(deriveSourceRepo("")).toBe("");
    expect(deriveSourceRepo("not a url")).toBe("");
  });
});

describe("getProvenance", () => {
  it("returns the remote URL, HEAD SHA, and branch in a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "confer-git-"));
    try {
      execFileSync("git", ["init", "-b", "main", dir], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "config", "user.email", "test@test.test"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "remote", "add", "origin", "git@github.com:acme/api.git"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-m", "x"], { stdio: "ignore" });

      const p = await getProvenance(dir);
      expect(p.remoteUrl).toBe("git@github.com:acme/api.git");
      expect(p.sourceRepo).toBe("acme/api");
      expect(p.headSha).toMatch(/^[0-9a-f]{7,}$/);
      expect(p.branch).toBe("main");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty strings outside a git repo (does not throw)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "confer-nogit-"));
    try {
      const p = await getProvenance(dir);
      expect(p.remoteUrl).toBe("");
      expect(p.headSha).toBe("");
      expect(p.branch).toBe("");
      expect(p.sourceRepo).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
