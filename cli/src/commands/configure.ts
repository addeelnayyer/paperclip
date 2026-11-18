import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import {
  backupInvalidConfig,
  readConfig,
  writeConfig,
  configExists,
  resolveConfigPath,
} from "../config/store.js";
import {
  findPaperclipConfigKeyWarnings,
  type PaperclipConfig,
} from "../config/schema.js";
import { ensureLocalSecretsKeyFile } from "../config/secrets-key.js";
import {
  readInstanceClaudeConfigDir,
  resolvePaperclipEnvFile,
  writeInstanceClaudeConfigDir,
} from "../config/env.js";
import { promptDatabase } from "../prompts/database.js";
import { promptLlm } from "../prompts/llm.js";
import { promptLogging } from "../prompts/logging.js";
import { defaultSecretsConfig, promptSecrets } from "../prompts/secrets.js";
import { defaultStorageConfig, promptStorage } from "../prompts/storage.js";
import { promptServer } from "../prompts/server.js";
import {
  expandHomePrefix,
  resolveDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir,
  resolveDefaultLogsDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";
import { applyInstanceOption } from "../config/data-dir.js";
import { printPaperclipCliBanner } from "../utils/banner.js";

type Section = "llm" | "database" | "logging" | "server" | "storage" | "secrets";

const SECTION_LABELS: Record<Section, string> = {
  llm: "LLM Provider",
  database: "Database",
  logging: "Logging",
  server: "Server",
  storage: "Storage",
  secrets: "Secrets",
};

function defaultConfig(): PaperclipConfig {
  const instanceId = resolvePaperclipInstanceId();
  return {
    $meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "configure",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: resolveDefaultEmbeddedPostgresDir(instanceId),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: resolveDefaultBackupDir(instanceId),
      },
    },
    logging: {
      mode: "file",
      logDir: resolveDefaultLogsDir(instanceId),
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      bind: "loopback",
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    telemetry: {
      enabled: true,
    },
    storage: defaultStorageConfig(),
    secrets: defaultSecretsConfig(),
  };
}

type ConfigureOptions = {
  config?: string;
  section?: string;
  instance?: string;
  claudeConfigDir?: string;
  yes?: boolean;
};

async function configureClaudeConfigDir(rawValue: string, envFilePath: string, yes: boolean): Promise<void> {
  const trimmed = rawValue.trim();
  const next = trimmed ? path.resolve(expandHomePrefix(trimmed)) : null;

  if (next !== null) {
    const stat = fs.statSync(next, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      p.log.error(
        stat
          ? `Claude config dir ${next} is not a directory. Nothing was changed.`
          : `Claude config dir ${next} does not exist. Create it (or sign in with Claude Code using it) and rerun. Nothing was changed.`,
      );
      p.outro("");
      process.exitCode = 1;
      return;
    }
  }

  const current = readInstanceClaudeConfigDir(envFilePath);
  if (current === next) {
    p.log.message(
      pc.dim(next === null ? "No Host Claude Login is set for this Instance. Nothing changed." : `Host Claude Login is already ${next}. Nothing changed.`),
    );
    p.outro("");
    return;
  }

  if (current !== null && !yes) {
    const change = next === null ? `remove the Host Claude Login ${current}` : `change the Host Claude Login from ${current} to ${next}`;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      p.log.error(`Refusing to ${change} without confirmation. Rerun with --yes to confirm. Nothing was changed.`);
      p.outro("");
      process.exitCode = 1;
      return;
    }
    const confirmed = await p.confirm({
      message: `This will ${change}. Continue?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Host Claude Login left unchanged.");
      return;
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
  p.outro("");
}

export async function configure(opts: ConfigureOptions): Promise<void> {
  printPaperclipCliBanner();
  p.intro(pc.bgCyan(pc.black(" paperclip configure ")));
  applyInstanceOption(opts);
  const configPath = resolveConfigPath(opts.config);

  if (!configExists(opts.config)) {
    p.log.error("No config file found. Run `paperclipai onboard` first.");
    p.outro("");
    process.exitCode = 1;
    return;
  }

  if (opts.claudeConfigDir !== undefined) {
    await configureClaudeConfigDir(opts.claudeConfigDir, resolvePaperclipEnvFile(configPath), Boolean(opts.yes));
    return;
  }

  let config: PaperclipConfig;
  let invalidBackupPath: string | undefined;
  try {
    config = readConfig(opts.config) ?? defaultConfig();
    for (const warning of findPaperclipConfigKeyWarnings(config)) {
      p.log.warn(`Unknown config key ${warning.path}; did you mean ${warning.suggestion}? It will be preserved.`);
    }
  } catch (err) {
    const backupPath = backupInvalidConfig(opts.config);
    p.log.warn(
      `Existing config is invalid. Preserved the original bytes at ${backupPath}.\n${err instanceof Error ? err.message : String(err)}`,
    );

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      p.log.error(
        `Refusing to replace ${configPath} without confirmation. Rerun interactively to repair from defaults; the original and ${backupPath} are unchanged.`,
      );
      p.outro("");
      process.exitCode = 1;
      return;
    }

    const repair = await p.confirm({
      message: `Repair from defaults? The invalid original is backed up at ${backupPath}.`,
      initialValue: false,
    });
    if (p.isCancel(repair) || !repair) {
      p.cancel(`Configuration left unchanged. Invalid backup: ${backupPath}`);
      process.exitCode = 1;
      return;
    }

    config = defaultConfig();
    invalidBackupPath = backupPath;
  }

  let section: Section | undefined = opts.section as Section | undefined;

  if (section && !SECTION_LABELS[section]) {
    p.log.error(`Unknown section: ${section}. Choose from: ${Object.keys(SECTION_LABELS).join(", ")}`);
    p.outro("");
    process.exitCode = 1;
    return;
  }

  // Section selection loop
  let continueLoop = true;
  while (continueLoop) {
    if (!section) {
      const choice = await p.select({
        message: "Which section do you want to configure?",
        options: Object.entries(SECTION_LABELS).map(([value, label]) => ({
          value: value as Section,
          label,
        })),
      });

      if (p.isCancel(choice)) {
        p.cancel("Configuration cancelled.");
        return;
      }

      section = choice;
    }

    p.log.step(pc.bold(SECTION_LABELS[section]));

    switch (section) {
      case "database":
        config.database = await promptDatabase(config.database);
        break;
      case "llm": {
        const llm = await promptLlm();
        if (llm) {
          config.llm = llm;
        } else {
          delete config.llm;
        }
        break;
      }
      case "logging":
        config.logging = await promptLogging();
        break;
      case "server":
        {
          const { server, auth } = await promptServer({
            currentServer: config.server,
            currentAuth: config.auth,
          });
          config.server = server;
          config.auth = auth;
        }
        break;
      case "storage":
        config.storage = await promptStorage(config.storage);
        break;
      case "secrets":
        config.secrets = await promptSecrets(config.secrets);
        {
          const keyResult = ensureLocalSecretsKeyFile(config, configPath);
          if (keyResult.status === "created") {
            p.log.success(`Created local secrets key file at ${pc.dim(keyResult.path)}`);
          } else if (keyResult.status === "existing") {
            p.log.message(pc.dim(`Using existing local secrets key file at ${keyResult.path}`));
          } else if (keyResult.status === "skipped_provider") {
            p.log.message(pc.dim("Skipping local key file management for non-local provider"));
          } else {
            p.log.message(pc.dim("Skipping local key file management because PAPERCLIP_SECRETS_MASTER_KEY is set"));
          }
        }
        break;
    }

    config.$meta.updatedAt = new Date().toISOString();
    config.$meta.source = "configure";

    const written = writeConfig(config, opts.config, {
      invalidBackupPath,
    });
    invalidBackupPath = undefined;
    if (written) {
      p.log.success(`${SECTION_LABELS[section]} configuration updated.`);
    } else {
      p.log.message(pc.dim(`${SECTION_LABELS[section]} configuration unchanged.`));
    }

    // If section was provided via CLI flag, don't loop
    if (opts.section) {
      continueLoop = false;
    } else {
      const another = await p.confirm({
        message: "Configure another section?",
        initialValue: false,
      });

      if (p.isCancel(another) || !another) {
        continueLoop = false;
      } else {
        section = undefined; // Reset to show picker again
      }
    }
  }

  p.outro("Configuration saved.");
}
