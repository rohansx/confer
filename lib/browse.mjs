// Safe directory listing for Confer's in-UI file finder.
//
// The finder may only ever surface *directories* and *HTML docs*, and only
// within `root` (the $HOME boundary by default) — so a local page can't drive it
// to read arbitrary files. Every path is resolved and bounds-checked; `.git` and
// other dotfiles are hidden. This is the one security-critical module.
import { readdir, stat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DOC_RE = /\.html?$/i;

// Is `target` equal to or nested under `root`? Both must be absolute + resolved.
function within(root, target) {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Resolve `requested` to a real absolute path confined to `root`.
// Throws { code:'EOUTSIDE' } if it escapes the boundary.
async function confine(root, requested) {
  const rootReal = await realpath(path.resolve(root));
  const wanted = path.resolve(requested ?? rootReal);
  // realpath the deepest existing ancestor so symlinks can't escape the boundary
  let probe = wanted;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = path.join(await realpath(probe), path.relative(probe, wanted));
  if (!within(rootReal, real)) throw fail('EOUTSIDE', 'path is outside the allowed root');
  return { rootReal, target: real };
}

// List a directory for the finder: subdirectories + HTML docs only, confined to
// `root`. Returns { root, path, parent, entries:[{name,type,path,isGitRoot?}] }.
export async function browse(root, requested) {
  const { rootReal, target } = await confine(root, requested);
  const st = await stat(target); // ENOENT if missing
  if (!st.isDirectory()) throw fail('ENOTDIR', 'not a directory');

  const names = await readdir(target);
  const dirs = [];
  const docs = [];
  for (const name of names) {
    if (name.startsWith('.')) continue; // hide dotfiles/dirs (incl. .git, sidecars)
    const full = path.join(target, name);
    let est;
    try { est = await stat(full); } catch { continue; } // broken symlink etc.
    if (est.isDirectory()) {
      dirs.push({ name, type: 'dir', path: full, isGitRoot: existsSync(path.join(full, '.git')) });
    } else if (DOC_RE.test(name)) {
      docs.push({ name, type: 'doc', path: full });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  docs.sort((a, b) => a.name.localeCompare(b.name));

  const parentDir = path.dirname(target);
  const parent = target !== rootReal && within(rootReal, parentDir) ? parentDir : null;
  return { root: rootReal, path: target, parent, entries: [...dirs, ...docs] };
}

// Validate a path for serving as a doc: an existing .html/.htm file under root.
// Returns the resolved absolute path, or throws a coded error.
export async function resolveDoc(root, requested) {
  if (!requested) throw fail('ENODOC', 'no doc specified');
  if (!DOC_RE.test(requested)) throw fail('ENOTDOC', 'not an .html/.htm doc');
  const { target } = await confine(root, requested);
  const st = await stat(target); // ENOENT if missing
  if (!st.isFile()) throw fail('ENOTFILE', 'not a file');
  return target;
}
