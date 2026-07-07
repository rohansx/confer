import { execFile } from "node:child_process";
import { loadConfig } from "./config.js";

/**
 * confer open [--print]
 * Prints the last push's review URL by default; with --print, prints to stdout
 * only (no browser launch). Default: opens in the default browser via the
 * platform opener.
 */
export async function openCmd(opts: { print?: boolean } = {}): Promise<void> {
  const config = await loadConfig();
  if (!config.lastPush) {
    throw new Error("no last push — run `confer push` first");
  }
  const url = config.lastPush.reviewUrl;
  if (opts.print) {
    process.stdout.write(url + "\n");
    return;
  }
  // Best-effort: launch the default browser. Skip if the platform isn't known.
  const opener = pickOpener();
  if (!opener) {
    process.stdout.write(url + "\n");
    return;
  }
  await new Promise<void>((resolve) => {
    execFile(opener, [url], () => resolve());
  });
}

function pickOpener(): string | null {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  // Linux/other: try xdg-open, fall back to nothing.
  return "xdg-open";
}
