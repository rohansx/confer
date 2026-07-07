import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { homedir } from "node:os";

/**
 * Persisted CLI state. Lives at ~/.config/confer/config.json (XDG-ish) by
 * default; override via the CONFER_CONFIG env var. The file is chmod 0600 —
 * the push token is at rest.
 */
export interface ConferConfig {
  server: string;
  pushToken: string;
  lastPush?: {
    space: string;
    slug: string;
    versionId: string;
    reviewUrl: string;
    repo: string | null;
  };
}

export function defaultConfigPath(): string {
  return process.env.CONFER_CONFIG ?? join(homedir(), ".config", "confer", "config.json");
}

export function emptyConfig(): ConferConfig {
  return { server: "http://localhost:8787", pushToken: "" };
}

export async function loadConfig(path: string = defaultConfigPath()): Promise<ConferConfig> {
  try {
    const text = await readFile(path, "utf8");
    if (!text.trim()) return emptyConfig();
    const parsed = JSON.parse(text) as Partial<ConferConfig>;
    return {
      server: parsed.server ?? "http://localhost:8787",
      pushToken: parsed.pushToken ?? "",
      lastPush: parsed.lastPush,
    };
  } catch (e: any) {
    if (e?.code === "ENOENT") return emptyConfig();
    throw e;
  }
}

export async function saveConfig(config: ConferConfig, path: string = defaultConfigPath()): Promise<void> {
  const resolved = isAbsolute(path) ? path : join(process.cwd(), path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(config, null, 2), "utf8");
  // Token at rest — best-effort chmod 0600. Silently skip on platforms
  // where chmod behaves differently.
  try { await chmod(resolved, 0o600); } catch { /* ignore */ }
}

export function configDir(path: string = defaultConfigPath()): string {
  return dirname(path);
}
