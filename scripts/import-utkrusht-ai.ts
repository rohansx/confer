// Import docs from the utkrusht-ai workspace into Confer, organized per repo.
//
// Walks each git-repo subdir's docs/ tree (plus the top-level docs/ folder),
// derives source_repo from each repo's git remote (owner/repo) — falling back
// to the folder name — captures the HEAD commit, and pushes each HTML file as
// a new in_review version into the "utkrusht" space. The seeded owner is added
// as a space_owner so they can review/approve.
//
// Runs server-side with direct DB + blob-store access (like dev/seed.ts), so it
// uses whatever blob store is configured (disk, or R2/S3 when R2 env is set).
//
// Usage:
//   npx tsx --env-file=.env scripts/import-utkrusht-ai.ts [--root dir] [--space s] [--owner userId]
//
// Defaults: root = /home/rsx/Desktop/utkrusht-ai, space = "utkrusht",
//           owner = the first user in the DB (the seeded Rohan).
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../server/src/config.js";
import { openDb, newId } from "../server/src/db/client.js";
import { createBlobStore } from "../server/src/blob/create.js";
import { orgs, spaces, docs, users, spaceOwners } from "../server/src/db/schema.js";
import { eq, and } from "drizzle-orm";
import { createVersion, type Provenance } from "../server/src/versions/create.js";

const exec = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ?? "/home/rsx/Desktop/utkrusht-ai";
const SPACE_SLUG = args.space ?? "utkrusht";
const OWNER_ID = args.owner ?? undefined;

const NOISE = ["/node_modules/", "/.git/", "/.venv/", "/.claude/", "/site-packages/", "/data/generated/", "/dist/", "/trace_ui/", "/task_builder/static/", "/grading_lab/", "/static/", "/_assets/"];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[k] = next;
        i++;
      } else out[k] = "true";
    }
  }
  return out;
}

async function safeExec(cmd: string, cargs: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, cargs, { cwd });
    return stdout.toString().trim();
  } catch {
    return "";
  }
}

function deriveSourceRepo(remoteUrl: string, fallback: string): string {
  if (!remoteUrl) return fallback;
  let url = remoteUrl.trim();
  if (url.endsWith(".git")) url = url.slice(0, -4);
  const scp = url.match(/^[^:/]+@[^:]+:(.+)$/);
  if (scp) return scp[1] ?? fallback;
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parts[0] ?? fallback;
  } catch {
    return fallback;
  }
}

function slugFor(repoSlug: string, relFromDocs: string): string {
  // relFromDocs is the path relative to the repo's docs/ folder, e.g. "prompt-generator/agent.html"
  const base = relFromDocs.replace(/\.html?$/i, "").replace(/\//g, "-");
  const slug = `${repoSlug}--${base}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || "doc";
}

async function walkHtml(dir: string, acc: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const relToRoot = relative(ROOT, full);
    if (NOISE.some((n) => `/${relToRoot}/`.includes(n) || relToRoot.includes(n))) continue;
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) await walkHtml(full, acc);
    else if (/\.html?$/i.test(e)) acc.push(full);
  }
  return acc;
}

async function main() {
  const cfg = loadConfig(process.env);
  const db = openDb(cfg.dbPath);
  const blobs = createBlobStore(cfg);

  // Ensure org + space + owner exist.
  let org = db.select().from(orgs).all()[0];
  if (!org) {
    const orgId = newId();
    db.insert(orgs).values({ id: orgId, name: "Utkrusht", slug: "utkrusht-ai", createdAt: Date.now() }).run();
    org = db.select().from(orgs).all()[0]!;
  }
  const orgId = org.id;

  let space = db.select().from(spaces).where(and(eq(spaces.orgId, orgId), eq(spaces.slug, SPACE_SLUG))).get();
  if (!space) {
    const spaceId = newId();
    db.insert(spaces).values({ id: spaceId, orgId, slug: SPACE_SLUG, name: "Utkrusht AI", requiredApprovals: 1 }).run();
    space = db.select().from(spaces).where(eq(spaces.id, spaceId)).get()!;
  }

  // Owner = explicit arg, else the seeded/first user.
  let owner = OWNER_ID ? db.select().from(users).where(eq(users.id, OWNER_ID)).get() : db.select().from(users).all()[0];
  if (!owner && OWNER_ID) {
    db.insert(users).values({ id: OWNER_ID, name: "owner", createdAt: Date.now() }).run();
    owner = db.select().from(users).where(eq(users.id, OWNER_ID)).get();
  }
  if (owner && !db.select().from(spaceOwners).where(and(eq(spaceOwners.spaceId, space.id), eq(spaceOwners.userId, owner.id))).get()) {
    db.insert(spaceOwners).values({ spaceId: space.id, userId: owner.id }).run();
  }
  const ownerId = owner?.id ?? null;

  // Discover top-level git-repo subdirs + the top-level docs/ folder.
  const top = await readdir(ROOT);
  const repoRoots: { dir: string; kind: "topdocs" | "git" | "folder" }[] = [];
  for (const e of top) {
    const full = join(ROOT, e);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    if (e === "docs") {
      repoRoots.push({ dir: full, kind: "topdocs" });
      continue;
    }
    let isGit = false;
    try {
      await stat(join(full, ".git"));
      isGit = true;
    } catch {
      /* not a git repo */
    }
    if (isGit) {
      repoRoots.push({ dir: full, kind: "git" });
      continue;
    }
    // non-git subdir: include only if it has a docs/ folder
    try {
      await stat(join(full, "docs"));
      repoRoots.push({ dir: full, kind: "folder" });
    } catch {
      /* skip */
    }
  }

  const perRepo = new Map<string, { slug: string; title: string; path: string }[]>();
  let total = 0;

  for (const r of repoRoots) {
    const docsDir = r.kind === "topdocs" ? r.dir : join(r.dir, "docs");
    let exists = true;
    try {
      await stat(docsDir);
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const repoSlug =
      r.kind === "git"
        ? deriveSourceRepo(await safeExec("git", ["config", "--get", "remote.origin.url"], r.dir), basename(r.dir))
        : r.kind === "topdocs"
          ? "utkrusht-ai"
          : basename(r.dir);
    const headSha = r.kind === "git" ? await safeExec("git", ["rev-parse", "HEAD"], r.dir) : "";
    const branch = r.kind === "git" ? await safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], r.dir) : "";

    const htmlFiles = (await walkHtml(docsDir)).filter((f) => f.startsWith(docsDir));
    if (htmlFiles.length === 0) continue;

    const bucket: { slug: string; title: string; path: string }[] = [];
    for (const file of htmlFiles) {
      const relFromDocs = relative(docsDir, file).replace(/\\/g, "/");
      const slug = slugFor(repoSlug, relFromDocs);
      const html = await readFile(file, "utf8");
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || basename(file).replace(/\.html?$/i, "");

      let doc = db.select().from(docs).where(and(eq(docs.spaceId, space.id), eq(docs.slug, slug))).get();
      if (!doc) {
        const id = newId();
        db.insert(docs).values({ id, spaceId: space.id, slug, title, createdAt: Date.now() }).run();
        doc = db.select().from(docs).where(eq(docs.id, id)).get()!;
      }

      const provenance: Provenance = {
        authorType: "agent",
        authorName: "utkrusht-ai/import",
        tool: "import-utkrusht-ai",
        sourceRepo: repoSlug,
        commitSha: headSha || null,
        branch: branch || null,
      };

      await createVersion(
        { db, blobs, appOrigin: cfg.appOrigin },
        { orgId, spaceId: space.id, docId: doc.id, html: new TextEncoder().encode(html), draft: false, provenance },
      );
      bucket.push({ slug, title, path: relative(ROOT, file) });
      total++;
    }
    const existing = perRepo.get(repoSlug) ?? [];
    existing.push(...bucket);
    perRepo.set(repoSlug, existing);
  }

  console.log("\n=== Import summary ===");
  for (const [repo, ds] of [...perRepo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${repo}  — ${ds.length} doc${ds.length === 1 ? "" : "s"}`);
    for (const d of ds) console.log(`      • ${d.slug}`);
  }
  console.log(`\nTotal: ${total} docs across ${perRepo.size} repos → space "${SPACE_SLUG}"${ownerId ? ` (owner ${ownerId})` : ""}`);
  console.log(`Open: ${cfg.appOrigin.replace(/\/$/, "")}/#/repos`);
}

main().catch((e) => {
  console.error("import failed:", e);
  process.exit(1);
});