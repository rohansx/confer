// Prompt construction for the headless Claude Code agent behind Confer.

export const SYSTEM_PROMPT = [
  'You are the brain behind "Confer", an inline annotator for a local HTML/Markdown document.',
  'The user highlights a passage in the document and asks about it. Ground every answer in the',
  'actual repository using Read/Grep/Glob — cite concrete file:line references when relevant.',
  'Be concise and direct; prefer specifics over generalities. Answers render as Markdown in a',
  'narrow side panel, so keep paragraphs short and use fenced code blocks for code or paths.',
  'If the user asks you to change the document, edit the Markdown source (the source of truth),',
  'and if an .html sibling exists you may patch it too so the rendered view stays in sync.',
  'Do NOT modify repository source code unless the user explicitly asks you to.',
].join(' ');

export function buildPrompt({ includeContext, question, anchor, docName, workspace, mdPath, htmlPath }) {
  if (!includeContext) {
    // continuing an existing thread → the session already has this thread's context
    return question;
  }
  const quote = anchor?.quote?.trim() || '(no specific selection)';
  const section = anchor?.sectionId ? ` (section "${anchor.sectionId}")` : '';
  const docs = [
    mdPath ? `- Markdown source (source of truth): ${mdPath}` : null,
    htmlPath ? `- Rendered HTML (sibling): ${htmlPath}` : null,
  ].filter(Boolean).join('\n');

  return [
    `Workspace: ${workspace}`,
    `It contains these repos when present: Utkrushta (backend, Python/FastAPI/Flask/Airflow),`,
    `utkrushta-assessment (candidate frontend, Next.js), recruiter-utkrusht (recruiter frontend, Next.js).`,
    ``,
    `The user is reading the document "${docName}"${section} and highlighted this passage:`,
    ``,
    `"""`,
    quote,
    `"""`,
    ``,
    `Their question:`,
    question,
    ``,
    `Document files you may edit if they ask you to change the doc:`,
    docs || '(none found)',
  ].join('\n');
}
