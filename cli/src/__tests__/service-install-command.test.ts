import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerServiceCommands } from "../commands/service.js";
import { ensureServiceShim } from "../onboard-service.js";
import {
  detectServiceManager,
  renderLaunchdPlist,
  renderSystemdUnit,
  type ServiceManager,
} from "../services/service-manager.js";
import { readEnvEntries, restoreTty, setTty } from "./helpers/host-claude-login.js";

vi.mock("../onboard-service.js", () => ({ ensureServiceShim: vi.fn() }));
vi.mock("../services/service-manager.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/service-manager.js")>(),
  detectServiceManager: vi.fn(),
}));

const install = vi.fn(async () => ({ changed: true }));

function runInstall(...args: string[]) {
  const program = new Command();
  registerServiceCommands(program);
  return program.parseAsync(["service", "install", ...args], { from: "user" });
}

describe("service install command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(ensureServiceShim).mockResolvedValue({ ok: true, installedNow: false });
    vi.mocked(detectServiceManager).mockResolvedValue({
      supported: true,
      manager: {
        platform: "systemd",
        serviceName: "paperclipai.service",
        definitionPath: "/service/paperclipai.service",
        install,
      } as unknown as ServiceManager,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("checks the shim before installing and preserves JSON output and start flags", async () => {
    await runInstall("--json", "--no-start-now", "--no-start-on-login");

    expect(ensureServiceShim).toHaveBeenCalledWith({ installIfMissing: false });
    expect(vi.mocked(ensureServiceShim).mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0]!);
    expect(install).toHaveBeenCalledWith({ startNow: false, startOnLogin: false });
    expect(console.log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      installed: true,
      changed: true,
      platform: "systemd",
      serviceName: "paperclipai.service",
      definitionPath: "/service/paperclipai.service",
      lingerEnabled: false,
    }, null, 2));
  });

  it("rejects a missing shim without installing or printing success JSON", async () => {
    vi.mocked(ensureServiceShim).mockResolvedValue({ ok: false, installedNow: false, reason: "missing shim" });

    await expect(runInstall("--json")).rejects.toThrow(
      "Background service not installed: missing shim. Run `paperclipai install`, then `paperclipai service install`.",
    );
    expect(install).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("allows creating the managed shim without --json", async () => {
    await runInstall();

    expect(ensureServiceShim).toHaveBeenCalledWith({ installIfMissing: true });
    expect(install).toHaveBeenCalledWith({ startNow: true, startOnLogin: true });
  });

  describe("--claude-config-dir", () => {
    let root: string;
    let instanceDir: string;
    let envPath: string;

    const envEntries = () => readEnvEntries(envPath);

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-service-claude-"));
      vi.stubEnv("PAPERCLIP_HOME", path.join(root, "paperclip-home"));
      vi.stubEnv("PAPERCLIP_CONFIG", undefined);
      vi.stubEnv("PAPERCLIP_INSTANCE_ID", undefined);
      vi.spyOn(process, "cwd").mockReturnValue(root);
      instanceDir = path.join(process.env.PAPERCLIP_HOME!, "instances", "work");
      envPath = path.join(instanceDir, ".env");
      fs.mkdirSync(instanceDir, { recursive: true });
      fs.writeFileSync(envPath, "PAPERCLIP_AGENT_JWT_SECRET=keep-me\n");
    });

    afterEach(() => {
      restoreTty();
      process.exitCode = undefined;
      vi.unstubAllEnvs();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("saves the Host Claude Login in the Instance's .env before installing", async () => {
      let envAtInstall: Record<string, string> = {};
      install.mockImplementationOnce(async () => {
        envAtInstall = envEntries();
        return { changed: true };
      });

      await runInstall("--instance", "work", "--claude-config-dir", root);

      expect(envAtInstall).toEqual({ PAPERCLIP_AGENT_JWT_SECRET: "keep-me", CLAUDE_CONFIG_DIR: root });
      expect(install).toHaveBeenCalledWith({ startNow: true, startOnLogin: true });
    });

    it("refuses a missing path without installing", async () => {
      await runInstall("--instance", "work", "--claude-config-dir", path.join(root, "missing"));

      expect(process.exitCode).toBe(1);
      expect(envEntries()).toEqual({ PAPERCLIP_AGENT_JWT_SECRET: "keep-me" });
      expect(install).not.toHaveBeenCalled();
    });

    it("refuses to change a different login non-interactively without --yes", async () => {
      const oldDir = path.join(root, "old-login");
      fs.mkdirSync(oldDir);
      fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${oldDir}\n`);
      setTty(false);

      await runInstall("--instance", "work", "--claude-config-dir", root);

      expect(process.exitCode).toBe(1);
      expect(envEntries().CLAUDE_CONFIG_DIR).toBe(oldDir);
      expect(install).not.toHaveBeenCalled();
    });

    it("changes a different login non-interactively with --yes", async () => {
      fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${path.join(root, "old-login")}\n`);
      setTty(false);

      await runInstall("--instance", "work", "--claude-config-dir", root, "--yes");

      expect(envEntries().CLAUDE_CONFIG_DIR).toBe(root);
      expect(install).toHaveBeenCalledTimes(1);
    });

    it("keeps CLAUDE_CONFIG_DIR out of the launchd plist and systemd unit", () => {
      const unitInput = { instanceId: "work", shimPath: "/bin/paperclipai", homeDir: process.env.PAPERCLIP_HOME! };

      expect(renderLaunchdPlist({ ...unitInput, stdoutPath: "/out.log", stderrPath: "/err.log" })).not.toContain("CLAUDE_CONFIG_DIR");
      expect(renderSystemdUnit(unitInput)).not.toContain("CLAUDE_CONFIG_DIR");
    });
  });
});
