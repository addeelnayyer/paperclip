import * as p from "@clack/prompts";
import fs from "node:fs";
import pc from "picocolors";
import { readInstanceClaudeConfigDir, writeInstanceClaudeConfigDir } from "../config/env.js";
import { resolveHomeAwarePath } from "../config/home.js";

export async function applyHostClaudeLoginOption(rawValue: string, envFilePath: string, yes: boolean): Promise<boolean> {
  const trimmed = rawValue.trim();
  const next = trimmed ? resolveHomeAwarePath(trimmed) : null;

  if (next !== null) {
    const stat = fs.statSync(next, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      p.log.error(
        stat
          ? `Claude config dir ${next} is not a directory. Nothing was changed.`
          : `Claude config dir ${next} does not exist. Create it (or sign in with Claude Code using it) and rerun. Nothing was changed.`,
      );
      process.exitCode = 1;
      return false;
    }
  }

  const current = readInstanceClaudeConfigDir(envFilePath);
  if (current === next) {
    p.log.message(
      pc.dim(next === null ? "No Host Claude Login is set for this Instance. Nothing changed." : `Host Claude Login is already ${next}. Nothing changed.`),
    );
    return true;
  }

  if (current !== null && !yes) {
    const change = next === null ? `remove the Host Claude Login ${current}` : `change the Host Claude Login from ${current} to ${next}`;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      p.log.error(`Refusing to ${change} without confirmation. Rerun with --yes to confirm. Nothing was changed.`);
      process.exitCode = 1;
      return false;
    }
    const confirmed = await p.confirm({
      message: `This will ${change}. Continue?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Host Claude Login left unchanged.");
      return false;
    }
  }

  writeInstanceClaudeConfigDir(next, envFilePath);
  p.log.success(
    next === null
      ? `Removed the Host Claude Login from ${pc.dim(envFilePath)}. Agents will use the inherited CLAUDE_CONFIG_DIR, else ~/.claude.`
      : `Host Claude Login set to ${next} in ${pc.dim(envFilePath)}.`,
  );
  p.log.warn(
    "The change applies at the next restart of this Instance. Claude sessions saved under the old login will start fresh.",
  );
  return true;
}
