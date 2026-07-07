/**
 * Tiny MCP client: initialize a stateless streamable-HTTP session and call tools.
 * Usage: tsx scripts/mcp-call.ts <url> <bearerToken> <toolName> <argsJson>
 * Prints the result's content[0].text to stdout.
 */
const [,, url, bearer, tool, argsJson] = process.argv;
if (!url || !bearer || !tool) {
  console.error("usage: mcp-call.ts <url> <bearer> <tool> <argsJson>");
  process.exit(2);
}
const args = argsJson ? JSON.parse(argsJson) : {};

const headers = {
  "content-type": "application/json",
  "accept": "application/json, text/event-stream",
  authorization: `Bearer ${bearer}`,
};

async function post(body: unknown): Promise<string> {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return res.text();
}

const initBody = await post({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
});
await post({ jsonrpc: "2.0", method: "notifications/initialized" });

const callBody = await post({
  jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: tool, arguments: args },
});

// SSE: pull the last "data: <json>" line.
let last: any = null;
for (const e of callBody.split("\n\n").map(s => s.trim()).filter(Boolean)) {
  for (const line of e.split("\n")) {
    if (line.startsWith("data: ")) {
      try { last = JSON.parse(line.slice("data: ".length)); } catch { /* skip */ }
    }
  }
}
if (!last) { console.error("no JSON-RPC response"); console.error(callBody.slice(0, 500)); process.exit(1); }
if (last.error) { console.error("rpc error:", last.error); process.exit(1); }
process.stdout.write(last.result?.content?.[0]?.text ?? "");
