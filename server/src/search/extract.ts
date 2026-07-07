/**
 * Deterministic, dependency-free tag strip → searchable text.
 * A readability-grade extractor replaces this in Phase 4/6; the FTS index and
 * SearchProvider interface don't change when it does.
 */
export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
