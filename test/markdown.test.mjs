import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, slugify } from '../lib/markdown.mjs';

test('slugify makes url-safe heading ids', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  Spaces  & symbols  '), 'spaces-symbols');
  assert.equal(slugify('!!!'), 'section');
});

test('headings render with slug ids (so anchoring can target a section)', () => {
  const html = renderMarkdown('# Title\n\n## Sub Heading');
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h2 id="sub-heading">Sub Heading<\/h2>/);
});

test('duplicate headings get unique ids', () => {
  const html = renderMarkdown('# Intro\n\n# Intro');
  assert.match(html, /id="intro"/);
  assert.match(html, /id="intro-2"/);
});

test('fenced code is escaped and not treated as markdown', () => {
  const html = renderMarkdown('```\n<b>&amp;</b> **not bold**\n```');
  assert.match(html, /<pre><code>&lt;b&gt;&amp;amp;&lt;\/b&gt; \*\*not bold\*\*<\/code><\/pre>/);
});

test('fenced code with language tag gets a language-* class', () => {
  const html = renderMarkdown('```js\nconsole.log(1)\n```');
  assert.match(html, /<pre><code class="language-js">/);
});

test('GFM table renders thead, tbody, and alignment', () => {
  const md = '| Name | Score |\n|:-----|------:|\n| Alice | 99 |\n| Bob | 87 |';
  const html = renderMarkdown(md);
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<th style="text-align:left">Name<\/th>/);
  assert.match(html, /<th style="text-align:right">Score<\/th>/);
  assert.match(html, /<td style="text-align:left">Alice<\/td>/);
  assert.match(html, /<td style="text-align:right">99<\/td>/);
});

test('table without alignment separator renders plain cells', () => {
  const md = '| A | B |\n|---|---|\n| 1 | 2 |';
  const html = renderMarkdown(md);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('inline formatting: bold, code, links', () => {
  const html = renderMarkdown('A **bold** word, `code`, and a [link](https://x.com).');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/x\.com" target="_blank" rel="noopener">link<\/a>/);
});

test('lists and blockquotes render', () => {
  assert.match(renderMarkdown('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(renderMarkdown('1. a\n2. b'), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(renderMarkdown('> quoted'), /<blockquote>[\s\S]*quoted[\s\S]*<\/blockquote>/);
});

test('raw HTML in paragraphs is escaped (no injection)', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
