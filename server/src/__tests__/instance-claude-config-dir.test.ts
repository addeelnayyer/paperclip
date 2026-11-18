import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  execute,
  resetClaudeCliCapabilitiesCacheForTests,
  testEnvironment,
} from "@paperclipai/adapter-claude-local/server";
import { loadInstanceEnvFile } from "../env-file-policy.js";

const RESTORED_ENV_KEYS = ["HOME", "PATH", "CLAUDE_CONFIG_DIR", "CLAUDE_TEST_CAPTURE_PATH", "ANTHROPIC_API_KEY"] as const;
let savedEnv: Partial<Record<(typeof RESTORED_ENV_KEYS)[number], string | undefined>>;

let root: string;
let envPath: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(RESTORED_ENV_KEYS.map((key) => [key, process.env[key]]));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-claude-"));
  envPath = path.join(root, ".env");
});

afterEach(() => {
  resetClaudeCliCapabilitiesCacheForTests();
  for (const key of RESTORED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** Installs a fake `claude` on PATH that records the CLAUDE_CONFIG_DIR it was spawned with. */
function installFakeClaude(): { capturePath: string } {
  const binDir = path.join(root, "bin");
  const capturePath = path.join(root, "capture.jsonl");
  fs.mkdirSync(binDir, { recursive: true });
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) { console.log("2.1.286 (Claude Code)"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("Usage: claude"); process.exit(0); }
fs.appendFileSync(process.env.CLAUDE_TEST_CAPTURE_PATH, JSON.stringify({ claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null }) + "\\n");
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-1111-4111-8111-111111111111", model: "claude-sonnet" }));
console.log(JSON.stringify({ type: "assistant", session_id: "11111111-1111-4111-8111-111111111111", message: { content: [{ type: "text", text: "hello" }] } }));
console.log(JSON.stringify({ type: "result", session_id: "11111111-1111-4111-8111-111111111111", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
`;
  fs.writeFileSync(path.join(binDir, "claude"), script, { mode: 0o755 });
  process.env.HOME = root;
  process.env.PATH = `${binDir}${path.delimiter}${savedEnv.PATH ?? ""}`;
  process.env.CLAUDE_TEST_CAPTURE_PATH = capturePath;
  delete process.env.ANTHROPIC_API_KEY;
  return { capturePath };
}

function capturedConfigDirs(capturePath: string): Array<string | null> {
  return fs.readFileSync(capturePath, "utf8").trim().split("\n").map((line) => JSON.parse(line).claudeConfigDir);
}

/** Simulates server startup: the shell or launchd already exported a different login. */
function startServerWithInstanceLogin(): { instanceLogin: string; inheritedLogin: string } {
  const instanceLogin = path.join(root, "logins", "work");
  const inheritedLogin = path.join(root, "logins", "personal");
  fs.mkdirSync(instanceLogin, { recursive: true });
  fs.mkdirSync(inheritedLogin, { recursive: true });
  fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${instanceLogin}\n`);
  process.env.CLAUDE_CONFIG_DIR = inheritedLogin;
  loadInstanceEnvFile(envPath, { log: () => {} });
  return { instanceLogin, inheritedLogin };
}

async function runClaudeLocal(config: Record<string, unknown> = {}) {
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return execute({
    runId: "run-instance-login",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Claude Coder",
      adapterType: "claude_local",
      adapterConfig: { engine: "cli" },
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { engine: "cli", command: "claude", cwd: workspace, promptTemplate: "Follow the paperclip heartbeat.", ...config },
    context: {},
    authToken: "run-jwt-token",
    onLog: async () => {},
  });
}

describe("Instance .env loading at server startup", () => {
  it("lets the Instance's CLAUDE_CONFIG_DIR beat an inherited one while other keys keep the inherited value", () => {
    fs.writeFileSync(envPath, "CLAUDE_CONFIG_DIR=/logins/work\nPAPERCLIP_PUBLIC_URL=http://from-file\nFRESH_KEY=from-file\n");
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: "/logins/personal",
      PAPERCLIP_PUBLIC_URL: "http://inherited",
    };
    const log = vi.fn();

    loadInstanceEnvFile(envPath, { env, log });

    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: "/logins/work",
      PAPERCLIP_PUBLIC_URL: "http://inherited",
      FRESH_KEY: "from-file",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("/logins/personal");
    expect(log.mock.calls[0]![0]).toContain("/logins/work");
  });

  it("does not log when nothing inherited was overridden", () => {
    fs.writeFileSync(envPath, "CLAUDE_CONFIG_DIR=/logins/work\n");
    const fresh: NodeJS.ProcessEnv = {};
    const same: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: "/logins/work" };
    const log = vi.fn();

    loadInstanceEnvFile(envPath, { env: fresh, log });
    loadInstanceEnvFile(envPath, { env: same, log });

    expect(fresh.CLAUDE_CONFIG_DIR).toBe("/logins/work");
    expect(same.CLAUDE_CONFIG_DIR).toBe("/logins/work");
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the inherited CLAUDE_CONFIG_DIR when the Instance sets none", () => {
    fs.writeFileSync(envPath, "OTHER=1\n");
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: "/logins/personal" };
    const log = vi.fn();

    loadInstanceEnvFile(envPath, { env, log });

    expect(env.CLAUDE_CONFIG_DIR).toBe("/logins/personal");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("the env a claude_local run receives", () => {
  it("runs an agent with no AI Connection under the Instance's Host Claude Login", async () => {
    const { capturePath } = installFakeClaude();
    const { instanceLogin } = startServerWithInstanceLogin();

    const result = await runClaudeLocal();

    expect(result.exitCode).toBe(0);
    expect(capturedConfigDirs(capturePath)).toEqual([instanceLogin]);
  });

  it("probes the Test environment under the Instance's Host Claude Login", async () => {
    const { capturePath } = installFakeClaude();
    const { instanceLogin } = startServerWithInstanceLogin();

    await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: { engine: "cli", command: "claude", cwd: root },
    });

    expect(capturedConfigDirs(capturePath)).toContain(instanceLogin);
    expect(new Set(capturedConfigDirs(capturePath))).toEqual(new Set([instanceLogin]));
  });

  it("still lets an agent's own adapterConfig.env.CLAUDE_CONFIG_DIR win", async () => {
    const { capturePath } = installFakeClaude();
    startServerWithInstanceLogin();
    const agentLogin = path.join(root, "logins", "agent");
    fs.mkdirSync(agentLogin, { recursive: true });

    await runClaudeLocal({ env: { CLAUDE_CONFIG_DIR: agentLogin } });

    expect(capturedConfigDirs(capturePath)).toEqual([agentLogin]);
  });

  it("leaves an agent on an AI Connection on its connection's config dir", async () => {
    const { capturePath } = installFakeClaude();
    startServerWithInstanceLogin();
    const connectionHome = path.join(root, "connections", "anthropic");
    fs.mkdirSync(connectionHome, { recursive: true });

    await runClaudeLocal({ managedAiConnection: true, env: { CLAUDE_CONFIG_DIR: connectionHome } });

    expect(capturedConfigDirs(capturePath)).toEqual([connectionHome]);
  });
});
