import { readFile } from "node:fs/promises";
import { loadConfig, saveConfig } from "./config.js";
import { getProvenance } from "./git.js";
import { publishVersion } from "./api.js";

export interface PushOpts {
  file: string;
  space: string;
  slug: string;
  draft?: boolean;
  /** v1: a session summary JSON file. v0: ignored. */
  session?: string;
  tool?: string;
  author?: string;
  server?: string;
  token?: string;
}

/**
 * confer push <file> --space <s> --slug <slug> [--draft]
 *
 * Reads the file, auto-detects git provenance, posts a version. Saves the
 * resulting version_id + review_url to the config so `confer open` and
 * `confer status` can use them.
 */
export async function push(opts: PushOpts): Promise<void> {
  const config = await loadConfig();
  const server = opts.server ?? config.server;
  const token = opts.token ?? config.pushToken;
  if (!server) throw new Error("no server configured — run `confer login` first");
  if (!token) throw new Error("no push token configured — run `confer login` first");

  const html = await readFile(opts.file, "utf8");
  const session = opts.session ? await readFile(opts.session, "utf8") : undefined;
  const prov = await getProvenance();

  const result = await publishVersion(server, token, {
    space: opts.space,
    slug: opts.slug,
    html,
    draft: opts.draft,
    session,
    metadata: {
      author_type: "agent",
      author: opts.author ?? process.env.USER ?? "confer-cli",
      tool: opts.tool ?? "confer-cli",
      source_repo: prov.sourceRepo || null,
      commit_sha: prov.headSha || null,
      branch: prov.branch || null,
    },
  });

  // Persist so `confer open` / `confer status` know the last push.
  await saveConfig({
    ...config,
    lastPush: {
      space: opts.space,
      slug: opts.slug,
      versionId: result.versionId,
      reviewUrl: result.reviewUrl,
      repo: prov.sourceRepo || null,
    },
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    version_id: result.versionId,
    review_url: result.reviewUrl,
    deduped: result.deduped,
    provenance: {
      source_repo: prov.sourceRepo,
      commit_sha: prov.headSha,
      branch: prov.branch,
    },
  }, null, 2) + "\n");
}
