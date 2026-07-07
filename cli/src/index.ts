#!/usr/bin/env node
import { login } from "./login.js";
import { push } from "./push.js";
import { openCmd } from "./open.js";
import { status } from "./status.js";
import { skillInstall } from "./skill-install.js";

const HELP = `confer — GitHub PRs for docs.

Usage:
  confer login [--server <url>] [--token <push_token>]
  confer push <file> --space <s> --slug <slug> [--draft] [--session <f.json>]
  confer open [--print]
  confer status [--space <s>] [--repo <r>]
  confer skill install [--dir <path>]

Approval is human-only. There is no \`confer approve\`.`;

function parseArgs(argv: string[]): { command: string | null; positional: string[]; flags: Record<string, string | boolean> } {
  const [, , ...rest] = argv;
  if (rest.length === 0) return { command: null, positional: [], flags: {} };
  const command = rest[0]!;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--print") flags.print = true;
    else if (a === "--draft") flags.draft = true;
    else if (a === "-h" || a === "--help") flags.help = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const next = rest[i + 1];
        if (next && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; }
        else flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);
  if (!command || flags.help) {
    process.stdout.write(HELP + "\n");
    return;
  }

  try {
    switch (command) {
      case "login":
        await login({
          server: flags.server as string | undefined,
          token: flags.token as string | undefined,
        });
        return;
      case "push": {
        const file = positional[0];
        if (!file) throw new Error("usage: confer push <file> --space <s> --slug <slug> [--draft]");
        if (!flags.space || !flags.slug) {
          throw new Error("--space and --slug are required");
        }
        await push({
          file,
          space: String(flags.space),
          slug: String(flags.slug),
          draft: Boolean(flags.draft),
          session: flags.session as string | undefined,
          tool: flags.tool as string | undefined,
          author: flags.author as string | undefined,
          server: flags.server as string | undefined,
          token: flags.token as string | undefined,
        });
        return;
      }
      case "open":
        await openCmd({ print: Boolean(flags.print) });
        return;
      case "status":
        await status({
          space: flags.space as string | undefined,
          repo: flags.repo as string | undefined,
        });
        return;
      case "skill":
        if (positional[0] !== "install") throw new Error("usage: confer skill install [--dir <path>]");
        await skillInstall({ dir: flags.dir as string | undefined });
        const target = (flags.dir as string | undefined) ?? "~/.claude/skills/confer/";
        process.stdout.write(`Installed SKILL.md to ${target}SKILL.md\n`);
        return;
      case "help":
        process.stdout.write(HELP + "\n");
        return;
      default:
        process.stderr.write(`unknown command: ${command}\n\n${HELP}\n`);
        process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

main();
