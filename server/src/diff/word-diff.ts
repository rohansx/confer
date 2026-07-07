import { diff_match_patch, type Diff } from "diff-match-patch";
import { extractText } from "../search/extract.js";

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSegment {
  op: DiffOp;
  text: string;
  /** True for long runs of equal text that have been collapsed to a summary. */
  collapsed?: boolean;
  /** Number of source words covered when `collapsed` is true. */
  wordCount?: number;
}

const COLLAPSE_THRESHOLD = 80; // words

/**
 * Compute a word-level diff between two plain-text strings. Returns a list of
 * segments. Long runs of equal text are marked `collapsed: true` so the UI
 * can show a "… N unchanged words …" summary.
 */
export function wordDiff(a: string, b: string): DiffSegment[] {
  const dmp = new diff_match_patch();
  // Word-mode diff: each "char" is one word. We use a separator of null char
  // inserted between every word + every whitespace token, so whitespace and
  // punctuation stay attached to their words.
  const enc = (s: string) => encodeWords(s);
  const dec = (tokens: string[]) => tokens.join("");

  const aTokens = enc(a);
  const bTokens = enc(b);

  const rawDiffs = dmp.diff_main(aTokens, bTokens) as Diff[];
  dmp.diff_cleanupSemantic(rawDiffs);

  const segments: DiffSegment[] = [];
  for (const [op, text] of rawDiffs) {
    const decoded = dec(text.split("\u0001").filter((t) => t.length > 0));
    if (decoded.length === 0) continue;
    if (op === 0) {
      // 0 = equal. Collapse if long.
      const wordCount = countWords(decoded);
      if (wordCount > COLLAPSE_THRESHOLD) {
        segments.push({ op: "equal", text: " … ", collapsed: true, wordCount });
      } else {
        segments.push({ op: "equal", text: decoded });
      }
    } else if (op === 1) {
      segments.push({ op: "insert", text: decoded });
    } else if (op === -1) {
      segments.push({ op: "delete", text: decoded });
    }
  }

  // Merge adjacent equal segments (collapse-then-equal is the common case).
  const merged: DiffSegment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && last.op === s.op && !last.collapsed && !s.collapsed) {
      last.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/**
 * Word-diff of two HTML strings. Each side is first stripped to text using
 * the existing extractText() helper, so the diff is over the visible content
 * (not the raw markup). Original HTML is returned alongside for side-by-side
 * rendering.
 */
export function wordDiffHtml(aHtml: string, bHtml: string): {
  segments: DiffSegment[];
  aText: string;
  bText: string;
} {
  const aText = extractText(aHtml);
  const bText = extractText(bHtml);
  return { segments: wordDiff(aText, bText), aText, bText };
}

// ---- internals ----

/**
 * Encode a string as a sequence of "words" separated by \u0001, so diff-match-
 * patch's character-level diff becomes a word-level diff. Each whitespace
 * token is preserved as its own segment so re-joining produces readable text.
 */
function encodeWords(s: string): string {
  // Split into runs of word chars and non-word chars, keep both.
  const parts: string[] = [];
  let buf = "";
  for (const ch of s) {
    if (/\s/.test(ch) || /[^\w]/.test(ch)) {
      if (buf) { parts.push(buf); buf = ""; }
      parts.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);
  return parts.join("\u0001");
}

function countWords(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}
