import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitProvenance {
  remoteUrl: string;
  headSha: string;
  branch: string;
  /** Derived short form like "acme/api" (best-effort). Empty if it can't be derived. */
  sourceRepo: string;
}

async function safeExec(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, cwd ? { cwd } : {});
    return stdout.toString().trim();
  } catch {
    return "";
  }
}

/** Read git provenance from the given working directory. Returns an empty sourceRepo on failure. */
export async function getProvenance(cwd: string = process.cwd()): Promise<GitProvenance> {
  const [remoteUrl, headSha, branch] = await Promise.all([
    safeExec(["config", "--get", "remote.origin.url"], cwd),
    safeExec(["rev-parse", "HEAD"], cwd),
    safeExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
  ]);
  return { remoteUrl, headSha, branch, sourceRepo: deriveSourceRepo(remoteUrl) };
}

/**
 * Convert a git remote URL to a short "owner/repo" form.
 *   git@github.com:acme/api.git        → "acme/api"
 *   https://github.com/acme/api.git    → "acme/api"
 *   ssh://git@gitlab.com/group/api.git → "group/api"
 *   (empty)                            → ""
 */
export function deriveSourceRepo(remoteUrl: string): string {
  if (!remoteUrl) return "";
  let url = remoteUrl.trim();
  if (url.endsWith(".git")) url = url.slice(0, -4);

  // SSH scp-style: user@host:owner/repo
  const scp = url.match(/^[^:/]+@[^:]+:(.+)$/);
  if (scp) return scp[1] ?? "";

  // Standard URL: scheme://host[:port]/path
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parts[0] ?? "";
  } catch {
    return "";
  }
}
