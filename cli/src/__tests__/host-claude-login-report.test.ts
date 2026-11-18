import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { onboard } from "../commands/onboard.js";
import { registerServiceCommands } from "../commands/service.js";
import { detectServiceManager, type ServiceManager } from "../services/service-manager.js";

vi.mock("../commands/run.js", () => ({ runCommand: vi.fn() }));
vi.mock("../services/service-manager.js", () => ({ detectServiceManager: vi.fn() }));

function useTempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-claude-login-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  return home;
}

function writeInstanceEnv(home: string, instanceId: string, contents: string): void {
  const instanceRoot = path.join(home, "instances", instanceId);
  fs.mkdirSync(instanceRoot, { recursive: true });
  fs.writeFileSync(path.join(instanceRoot, ".env"), contents);
}

function capturedStdout(): () => string {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  return () => write.mock.calls.map(([chunk]) => String(chunk)).join("");
}

function bannerLine(output: string): string {
  const line = output.split("\n").find((entry) => entry.includes("Local home:"));
  if (!line) throw new Error(`No banner line in output:\n${output}`);
  return line;
}

beforeEach(() => {
  vi.stubEnv("PAPERCLIP_CONFIG", undefined);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", undefined);
  vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("onboard banner Host Claude Login", () => {
  it.each([
    {
      name: "shows the Instance's Host Claude Login",
      instanceValue: "/Users/me/.claude-work",
      inherited: undefined,
      expected: "claude login: /Users/me/.claude-work",
    },
    {
      name: "says the default ~/.claude is in use when the Instance sets none",
      instanceValue: undefined,
      inherited: undefined,
      expected: "claude login: default ~/.claude",
    },
    {
      name: "says an inherited CLAUDE_CONFIG_DIR is in use when the Instance sets none",
      instanceValue: undefined,
      inherited: "/Users/me/.claude-shell",
      expected: "claude login: inherited CLAUDE_CONFIG_DIR=/Users/me/.claude-shell",
    },
    {
      name: "says when the Instance's Host Claude Login overrides an inherited one",
      instanceValue: "/Users/me/.claude-work",
      inherited: "/Users/me/.claude-shell",
      expected: "claude login: /Users/me/.claude-work (overrides inherited CLAUDE_CONFIG_DIR=/Users/me/.claude-shell)",
    },
  ])("$name", async ({ instanceValue, inherited, expected }) => {
    const home = useTempHome();
    if (instanceValue) writeInstanceEnv(home, "work", `CLAUDE_CONFIG_DIR=${instanceValue}\n`);
    if (inherited) vi.stubEnv("CLAUDE_CONFIG_DIR", inherited);
    const output = capturedStdout();

    await onboard({ instance: "work", yes: true, invokedByRun: true });

    expect(bannerLine(output())).toContain(expected);
  });
});

describe("service status Host Claude Login", () => {
  beforeEach(() => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/Users/me/.claude-shell");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    vi.mocked(detectServiceManager).mockResolvedValue({
      supported: true,
      manager: {
        status: async () => ({ serviceName: "com.paperclipai.work", installed: true, active: true }),
      } as unknown as ServiceManager,
    });
  });

  async function serviceStatus(...args: string[]): Promise<Record<string, unknown>> {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerServiceCommands(program);
    await program.parseAsync(["service", "status", ...args], { from: "user" });
    return JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
  }

  it("shows the Host Claude Login from the Instance's .env", async () => {
    const home = useTempHome();
    writeInstanceEnv(home, "work", "CLAUDE_CONFIG_DIR=/Users/me/.claude-work\n");

    const status = await serviceStatus("--instance", "work");

    expect(status).toMatchObject({ serviceName: "com.paperclipai.work", hostClaudeLogin: "/Users/me/.claude-work" });
  });

  it("says the default ~/.claude is in use when the Instance's .env sets none", async () => {
    useTempHome();

    const status = await serviceStatus("--instance", "work");

    expect(status.hostClaudeLogin).toBe("default ~/.claude");
  });

  it("reads the Instance's .env even when run inside a directory with its own config", async () => {
    const home = useTempHome();
    writeInstanceEnv(home, "work", "CLAUDE_CONFIG_DIR=/Users/me/.claude-work\n");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-claude-login-repo-"));
    fs.mkdirSync(path.join(repo, ".paperclip"));
    fs.writeFileSync(path.join(repo, ".paperclip", "config.json"), "{}\n");
    fs.writeFileSync(path.join(repo, ".paperclip", ".env"), "CLAUDE_CONFIG_DIR=/Users/me/.claude-repo\n");
    vi.spyOn(process, "cwd").mockReturnValue(repo);

    const status = await serviceStatus("--instance", "work");

    expect(status.hostClaudeLogin).toBe("/Users/me/.claude-work");
  });
});
