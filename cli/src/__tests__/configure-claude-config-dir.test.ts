import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as prompts from "@clack/prompts";
import { parse as parseEnv } from "dotenv";
import { configure } from "../commands/configure.js";
import { applyDataDirOverride } from "../config/data-dir.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
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

const ORIGINAL_EXIT_CODE = process.exitCode;
let originalStdinIsTTY: boolean | undefined;
let originalStdoutIsTTY: boolean | undefined;
let root: string;
let configPath: string;
let envPath: string;

function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

function envEntries(): Record<string, string> {
  return fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
}

function loggedText(): string {
  return [
    ...vi.mocked(prompts.log.error).mock.calls,
    ...vi.mocked(prompts.log.info).mock.calls,
    ...vi.mocked(prompts.log.message).mock.calls,
    ...vi.mocked(prompts.log.success).mock.calls,
    ...vi.mocked(prompts.log.warn).mock.calls,
  ].map((call) => String(call[0])).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  originalStdinIsTTY = process.stdin.isTTY;
  originalStdoutIsTTY = process.stdout.isTTY;
  setTty(true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-configure-claude-"));
  vi.stubEnv("HOME", path.join(root, "home"));
  fs.mkdirSync(process.env.HOME!, { recursive: true });
  configPath = path.join(root, "instance", "config.json");
  envPath = path.join(root, "instance", ".env");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{}\n");
  fs.writeFileSync(envPath, "PAPERCLIP_AGENT_JWT_SECRET=keep-me\n");
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinIsTTY });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutIsTTY });
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("configure --claude-config-dir", () => {
  it("expands ~ and saves the absolute path in the Instance's .env", async () => {
    const loginDir = path.join(process.env.HOME!, ".claude-work");
    fs.mkdirSync(loginDir);

    await configure({ config: configPath, claudeConfigDir: "~/.claude-work" });

    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(envEntries()).toEqual({
      PAPERCLIP_AGENT_JWT_SECRET: "keep-me",
      CLAUDE_CONFIG_DIR: loginDir,
    });
    expect(loggedText()).toContain("next restart");
    expect(loggedText()).toContain("start fresh");
  });

  it("refuses a path that does not exist and writes nothing", async () => {
    const before = fs.readFileSync(envPath, "utf8");

    await configure({ config: configPath, claudeConfigDir: path.join(root, "missing") });

    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(envPath, "utf8")).toBe(before);
    expect(loggedText()).toContain("does not exist");
  });

  it("removes the entry when given an empty path", async () => {
    fs.writeFileSync(envPath, `PAPERCLIP_AGENT_JWT_SECRET=keep-me\nCLAUDE_CONFIG_DIR=${root}\n`);

    await configure({ config: configPath, claudeConfigDir: "", yes: true });

    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(envEntries()).toEqual({ PAPERCLIP_AGENT_JWT_SECRET: "keep-me" });
    expect(loggedText()).toContain("next restart");
  });

  it("asks before changing a different existing value and keeps it when declined", async () => {
    const oldDir = path.join(root, "old-login");
    const newDir = path.join(root, "new-login");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(newDir);
    fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${oldDir}\n`);
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);

    await configure({ config: configPath, claudeConfigDir: newDir });

    expect(prompts.confirm).toHaveBeenCalledTimes(1);
    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(oldDir);

    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);
    await configure({ config: configPath, claudeConfigDir: newDir });

    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(newDir);
  });

  it("skips the confirmation with --yes", async () => {
    const newDir = path.join(root, "new-login");
    fs.mkdirSync(newDir);
    fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${root}\n`);
    setTty(false);

    await configure({ config: configPath, claudeConfigDir: newDir, yes: true });

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(newDir);
  });

  it("stops without changing anything when non-interactive and --yes is missing", async () => {
    const newDir = path.join(root, "new-login");
    fs.mkdirSync(newDir);
    fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${root}\n`);
    setTty(false);

    await configure({ config: configPath, claudeConfigDir: newDir });

    expect(process.exitCode).toBe(1);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(envEntries().CLAUDE_CONFIG_DIR).toBe(root);
  });

  it("writes to the named Instance's .env with --instance", async () => {
    vi.stubEnv("PAPERCLIP_HOME", path.join(root, "paperclip-home"));
    vi.stubEnv("PAPERCLIP_CONFIG", undefined);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", undefined);
    // Keep config discovery away from any real .paperclip/config.json above the test's cwd.
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const instanceDir = path.join(process.env.PAPERCLIP_HOME!, "instances", "work");
    fs.mkdirSync(instanceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceDir, "config.json"), "{}\n");

    // The CLI's preAction hook applies --instance before the command runs.
    applyDataDirOverride({ instance: "work" }, { hasConfigOption: true });
    await configure({ claudeConfigDir: root });

    expect(process.exitCode).toBe(ORIGINAL_EXIT_CODE);
    expect(parseEnv(fs.readFileSync(path.join(instanceDir, ".env"), "utf8")).CLAUDE_CONFIG_DIR).toBe(root);
  });
});
