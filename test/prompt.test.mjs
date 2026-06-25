import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, SYSTEM_PROMPT } from '../lib/prompt.mjs';

test('first turn embeds the workspace, doc, passage and question', () => {
  const out = buildPrompt({
    includeContext: true,
    question: 'What does this mean?',
    anchor: { quote: 'the highlighted bit', sectionId: 'intro' },
    docName: 'design.html',
    workspace: '/home/u/repo',
    mdPath: '/home/u/repo/docs/design.md',
    htmlPath: '/home/u/repo/docs/design.html',
  });
  assert.match(out, /\/home\/u\/repo/);
  assert.match(out, /design\.html/);
  assert.match(out, /section "intro"/);
  assert.match(out, /the highlighted bit/);
  assert.match(out, /What does this mean\?/);
});

test('first turn is generic — no project-specific repo names baked in', () => {
  const out = buildPrompt({
    includeContext: true, question: 'q', anchor: { quote: 'x' },
    docName: 'd.html', workspace: '/w', mdPath: null, htmlPath: '/w/d.html',
  });
  assert.doesNotMatch(out, /Utkrushta|recruiter-utkrusht/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /Utkrushta/i);
});

test('follow-up turns send only the bare question', () => {
  const out = buildPrompt({ includeContext: false, question: 'and now?' });
  assert.equal(out, 'and now?');
});
