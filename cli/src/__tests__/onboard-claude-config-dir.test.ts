import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as prompts from "@clack/prompts";
import { parse as parseEnv } from "dotenv";
import { onboard } from "../commands/onboard.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("../commands/run.js", () => ({ runCommand: vi.fn() }));

const ORIGINAL_EXIT_CODE = process.exitCode;
let originalStdinIsTTY: boolean | undefined;
let originalStdoutIsTTY: boolean | undefined;
let root: string;
let instanceDir: string;

function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

function envEntries(): Record<string, string> {
  const envPath = path.join(instanceDir, ".env");
  return fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
}

function loggedText(): string {
  return [
    ...vi.mocked(prompts.log.error).mock.calls,
    ...vi.mocked(prompts.log.success).mock.calls,
    ...vi.mocked(prompts.log.warn).mock.calls,
  ].map((call) => String(call[0])).join("\n");
}

function onboardWork(claudeConfigDir: string, extra: { yes?: boolean } = {}) {
  return onboard({ instance: "work", claudeConfigDir, invokedByRun: true, installService: false, yes: true, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  originalStdinIsTTY = process.stdin.isTTY;
  originalStdoutIsTTY = process.stdout.isTTY;
  setTty(true);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-onboard-claude-"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("PAPERCLIP_HOME", path.join(root, "paperclip-home"));
  vi.stubEnv("PAPERCLIP_CONFIG", undefined);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", undefined);
  vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", undefined);
  vi.stubEnv("PAPERCLIP_TOOL_ACTION_SIGNING_SECRET", undefined);
  vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
  fs.mkdirSync(process.env.HOME!, { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(root);
  instanceDir = path.join(process.env.PAPERCLIP_HOME!, "instances", "work");
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinIsTTY });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutIsTTY });
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("onboard --claude-config-dir", () => {
  it("saves the expanded absolute path in the new Instance's .env", async () => {
    const loginDir = path.join(process.env.HOME!, ".claude-work");
    fs.mkdirSync(loginDir);

    await onboardWork("~/.claude-work");

    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(fs.existsSync(path.join(instanceDir, "config.json"))).toBe(true);
    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(loginDir);
    expect(envEntries().PAPERCLIP_AGENT_JWT_SECRET).toBeTruthy();
    expect(loggedText()).toContain("next restart");
  });

  it("refuses a missing path before writing any config", async () => {
    await onboardWork(path.join(root, "missing"));

    expect(process.exitCode).toBe(1);
    expect(loggedText()).toContain("does not exist");
    expect(fs.existsSync(path.join(instanceDir, "config.json"))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, ".env"))).toBe(false);
  });

  it("stops without changing anything when a different login is set, non-interactive and --yes is missing", async () => {
    const oldDir = path.join(root, "old-login");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceDir, ".env"), `CLAUDE_CONFIG_DIR=${oldDir}\n`);
    setTty(false);

    await onboardWork(root, { yes: false });

    expect(process.exitCode).toBe(1);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(envEntries()).toEqual({ CLAUDE_CONFIG_DIR: oldDir });
    expect(fs.existsSync(path.join(instanceDir, "config.json"))).toBe(false);
  });

  it("asks before changing a different existing login and keeps it when declined", async () => {
    const oldDir = path.join(root, "old-login");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceDir, ".env"), `CLAUDE_CONFIG_DIR=${oldDir}\n`);
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);

    await onboardWork(root, { yes: false });

    expect(prompts.confirm).toHaveBeenCalledTimes(1);
    expect(envEntries()).toEqual({ CLAUDE_CONFIG_DIR: oldDir });
    expect(fs.existsSync(path.join(instanceDir, "config.json"))).toBe(false);
  });

  it("changes an existing login without asking when --yes is passed", async () => {
    const oldDir = path.join(root, "old-login");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceDir, ".env"), `CLAUDE_CONFIG_DIR=${oldDir}\n`);
    setTty(false);

    await onboardWork(root);

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(root);
  });

  it("removes the login when given an empty path", async () => {
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceDir, ".env"), `CLAUDE_CONFIG_DIR=${root}\n`);

    await onboardWork("");

    expect(envEntries().CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(fs.existsSync(path.join(instanceDir, "config.json"))).toBe(true);
  });
});
