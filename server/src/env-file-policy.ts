import { readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";

/**
 * Keys an Instance's `.env` sets even when the server inherited a different
 * value. `CLAUDE_CONFIG_DIR` is the Instance's Host Claude Login, so a shell or
 * launchd value must not silently move the Instance onto another subscription.
 */
const INSTANCE_OWNED_ENV_KEYS = ["CLAUDE_CONFIG_DIR"] as const;

export function shouldLoadWorkingDirectoryEnv(input: {
  cwdEnvExists: boolean;
  isPaperclipEnvFile: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  return env.PAPERCLIP_DISABLE_CWD_ENV_FILE !== "true"
    && input.cwdEnvExists
    && !input.isPaperclipEnvFile;
}

/**
 * Loads the Instance's `.env`. Inherited values win for every key except the
 * Instance-owned keys, which replace an inherited value; each replacement is
 * logged once.
 */
export function loadInstanceEnvFile(
  filePath: string,
  options: { env?: NodeJS.ProcessEnv; log?: (message: string) => void } = {},
): void {
  const env = options.env ?? process.env;
  const log = options.log ?? console.warn;

  let fileEntries: Record<string, string>;
  try {
    fileEntries = parseDotenv(readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
  const instanceOwned = new Set<string>(INSTANCE_OWNED_ENV_KEYS);
  for (const [key, rawValue] of Object.entries(fileEntries)) {
    if (!instanceOwned.has(key)) {
      if (!Object.hasOwn(env, key)) env[key] = rawValue;
      continue;
    }
    const value = rawValue.trim();
    const inherited = env[key];
    if (!value || inherited === value) continue;
    env[key] = value;
    if (inherited !== undefined) {
      log(`[paperclip] Using this Instance's ${key}=${value} from ${filePath} instead of the inherited ${key}=${inherited}.`);
    }
  }
}
