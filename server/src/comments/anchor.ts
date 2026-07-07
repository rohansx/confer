/**
 * Text-quote anchor resolution. A comment carries an exact `quote` plus optional
 * `prefix`/`suffix` context. Given a target text (typically the latest version's
 * extracted text), `resolveAnchor` finds the matching character offsets.
 *
 * Resolution rules:
 *   1) If `quote` is empty/missing, return { lost: true, start: -1, end: -1 }.
 *   2) Find every exact occurrence of `quote` in the target.
 *   3) If only one match: return it.
 *   4) If multiple: prefer the one whose immediately-preceding text matches
 *      `prefix` (longest match wins) and whose immediately-following text
 *      matches `suffix`. If still tied, pick the first.
 *   5) If no matches: { lost: true, start: -1, end: -1 }.
 *
 * The offsets are into the *extracted text* (after HTML stripping). They are
 * stable across versions whose content text didn't materially change.
 */

export interface Anchor {
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
  selector?: string | null;
}

export interface ResolvedAnchor {
  start: number;
  end: number;
  lost: boolean;
  /** Number of candidates considered (for the UI's "anchor weak" hint). */
  ambiguous?: boolean;
}

const CONTEXT_CHARS = 32; // how many chars of prefix/suffix we compare

export function resolveAnchor(anchor: Anchor, text: string): ResolvedAnchor {
  if (!anchor.quote) return { start: -1, end: -1, lost: true };
  const quote = anchor.quote;
  const matches: Array<{ start: number; end: number; score: number }> = [];
  let i = 0;
  while (i <= text.length) {
    const found = text.indexOf(quote, i);
    if (found === -1) break;
    let score = 0;
    if (anchor.prefix) {
      const prefixStart = Math.max(0, found - anchor.prefix.length);
      const before = text.slice(prefixStart, found);
      // Count how many trailing chars of `before` match the tail of `prefix`.
      const n = commonSuffixLength(before, anchor.prefix);
      score += n;
    }
    if (anchor.suffix) {
      const afterStart = found + quote.length;
      const after = text.slice(afterStart, afterStart + anchor.suffix.length);
      const n = commonPrefixLength(after, anchor.suffix);
      score += n;
    }
    matches.push({ start: found, end: found + quote.length, score });
    i = found + 1;
  }
  if (matches.length === 0) return { start: -1, end: -1, lost: true };
  // Sort by score desc; pick the first (deterministic).
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0]!;
  // We say "ambiguous" if multiple candidates tied on the *top* score.
  const topScore = best.score;
  const tied = matches.filter((m) => m.score === topScore);
  return { start: best.start, end: best.end, lost: false, ambiguous: tied.length > 1 };
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  const lim = Math.min(a.length, b.length);
  while (n < lim && a.charCodeAt(n) === b.charCodeAt(n)) n++;
  return n;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  const lim = Math.min(a.length, b.length);
  while (n < lim && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++;
  return n;
}

/**
 * Given a selection in some text, return the anchor payload (quote + a small
 * prefix and suffix window).
 */
export function makeAnchor(text: string, start: number, end: number): Anchor {
  const quote = text.slice(start, end);
  const prefix = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const suffix = text.slice(end, Math.min(text.length, end + CONTEXT_CHARS));
  return { quote, prefix, suffix };
}
