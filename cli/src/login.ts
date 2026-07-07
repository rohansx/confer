import { loadConfig, saveConfig } from "./config.js";

/**
 * v0 login: prompt for server URL + a push token, save to config. Real auth
 * (device-code / magic link / GitHub OAuth) lands in v1 with the hosted cloud.
 */
export async function login(opts: { server?: string; token?: string }): Promise<void> {
  const current = await loadConfig();

  const server = opts.server
    ?? (await prompt("Server URL", current.server || "http://localhost:8787"));
  const token = opts.token
    ?? (await prompt("Push token (confer_xxx)", current.pushToken || ""));

  if (!token) {
    throw new Error("push token is required");
  }

  await saveConfig({ ...current, server, pushToken: token });
  process.stdout.write(`Logged in. Server: ${server}\n`);
  process.stdout.write(`Config: ${process.env.CONFER_CONFIG ?? "~/.config/confer/config.json"}\n`);
}

/** Minimal stdin prompt. Falls back to a default if the input is empty. */
async function prompt(question: string, fallback: string): Promise<string> {
  process.stdout.write(`${question} [${fallback}]: `);
  return new Promise<string>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        const answer = buf.trim();
        resolve(answer || fallback);
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}
