import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as prompts from "@clack/prompts";
import { onboard } from "../commands/onboard.js";
import { loggedText, readEnvEntries, restoreTty, setTty } from "./helpers/host-claude-login.js";

vi.mock("@clack/prompts", async () => (await import("./helpers/host-claude-login.js")).clackPromptsMock());
vi.mock("../commands/run.js", () => ({ runCommand: vi.fn() }));

const ORIGINAL_EXIT_CODE = process.exitCode;
let root: string;
let instanceDir: string;
let envPath: string;
let configPath: string;

function seedLogin(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${dir}\n`);
}

function onboardWork(claudeConfigDir: string, extra: { yes?: boolean } = {}) {
  return onboard({ instance: "work", claudeConfigDir, invokedByRun: true, installService: false, yes: true, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
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
  envPath = path.join(instanceDir, ".env");
  configPath = path.join(instanceDir, "config.json");
});

afterEach(() => {
  restoreTty();
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
    expect(fs.existsSync(configPath)).toBe(true);
    expect(readEnvEntries(envPath).CLAUDE_CONFIG_DIR).toBe(loginDir);
    expect(readEnvEntries(envPath).PAPERCLIP_AGENT_JWT_SECRET).toBeTruthy();
    expect(loggedText(prompts.log)).toContain("next restart");
  });

  it("refuses a missing path before writing any config", async () => {
    await onboardWork(path.join(root, "missing"));

    expect(process.exitCode).toBe(1);
    expect(loggedText(prompts.log)).toContain("does not exist");
    expect(fs.existsSync(configPath)).toBe(false);
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it("stops without changing anything when a different login is set, non-interactive and --yes is missing", async () => {
    const oldDir = path.join(root, "old-login");
    seedLogin(oldDir);
    setTty(false);

    await onboardWork(root, { yes: false });

    expect(process.exitCode).toBe(1);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(readEnvEntries(envPath)).toEqual({ CLAUDE_CONFIG_DIR: oldDir });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("asks before changing a different existing login and keeps it when declined", async () => {
    const oldDir = path.join(root, "old-login");
    seedLogin(oldDir);
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);

    await onboardWork(root, { yes: false });

    expect(prompts.confirm).toHaveBeenCalledTimes(1);
    expect(readEnvEntries(envPath)).toEqual({ CLAUDE_CONFIG_DIR: oldDir });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("changes an existing login without asking when --yes is passed", async () => {
    seedLogin(path.join(root, "old-login"));
    setTty(false);

    await onboardWork(root);

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(readEnvEntries(envPath).CLAUDE_CONFIG_DIR).toBe(root);
  });

  it("removes the login when given an empty path", async () => {
    seedLogin(root);

    await onboardWork("");

    expect(readEnvEntries(envPath).CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(fs.existsSync(configPath)).toBe(true);
  });
});
