import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * confer skill install [--dir <path>]
 *
 * Copies the bundled SKILL.md to <dir>/SKILL.md. Default dir is
 * ~/.claude/skills/confer/. Creates the directory if it doesn't exist.
 *
 * In dev (when running via tsx), the bundled SKILL.md lives at
 * <repo>/cli/SKILL.md. In a published npm install it would live next to
 * dist/index.js.
 */
export async function skillInstall(opts: { dir?: string } = {}): Promise<string> {
  const targetDir = opts.dir
    ? (isAbsolute(opts.dir) ? opts.dir : resolve(process.cwd(), opts.dir))
    : join(homedir(), ".claude", "skills", "confer");

  const targetFile = join(targetDir, "SKILL.md");
  const sourceFile = await locateSkillMd();

  const content = await readFile(sourceFile, "utf8");
  await mkdir(targetDir, { recursive: true });
  await writeFile(targetFile, content, "utf8");
  return targetFile;
}

/**
 * Resolve the bundled SKILL.md path. Handles both the dev case (file is at
 * <repo>/cli/SKILL.md) and a future published case (file is at
 * <install>/SKILL.md).
 */
async function locateSkillMd(): Promise<string> {
  // 1) dev path: cli/SKILL.md relative to this file (cli/src/skill-install.ts)
  const here = fileURLToPath(import.meta.url);
  const devPath = join(here, "..", "..", "SKILL.md"); // cli/SKILL.md
  try {
    const text = await readFile(devPath, "utf8");
    if (text.includes("name: confer")) return devPath;
  } catch { /* fall through */ }

  // 2) try via env var (publish-time path)
  if (process.env.CONFER_SKILL_MD) return process.env.CONFER_SKILL_MD;

  throw new Error(
    "SKILL.md not found. In a published install it ships next to the binary; " +
    "in dev, it's at cli/SKILL.md. Set CONFER_SKILL_MD to override.",
  );
}

export const _dirname = dirname;
