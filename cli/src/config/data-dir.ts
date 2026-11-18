import path from "node:path";
import {
  expandHomePrefix,
  resolveDefaultConfigPath,
  resolveDefaultContextPath,
  resolvePaperclipInstanceId,
} from "./home.js";

export interface DataDirOptionLike {
  dataDir?: string;
  config?: string;
  context?: string;
  instance?: string;
}

export interface DataDirCommandSupport {
  hasConfigOption?: boolean;
  hasContextOption?: boolean;
}

export function applyDataDirOverride(
  options: DataDirOptionLike,
  support: DataDirCommandSupport = {},
): string | null {
  // An explicit --instance scopes config and Instance `.env` resolution even
  // without --data-dir; an explicit --config or PAPERCLIP_CONFIG still wins.
  if (support.hasConfigOption && options.instance?.trim()) {
    process.env.PAPERCLIP_INSTANCE_ID = resolvePaperclipInstanceId(options.instance);
  }

  const rawDataDir = options.dataDir?.trim();
  const explicitInstance = Boolean(options.instance?.trim());
  if (!rawDataDir && !explicitInstance) return null;

  const resolvedDataDir = rawDataDir ? path.resolve(expandHomePrefix(rawDataDir)) : null;
  if (resolvedDataDir) {
    process.env.PAPERCLIP_HOME = resolvedDataDir;
  }

  const instanceId = resolvePaperclipInstanceId(options.instance);
  if (explicitInstance) {
    process.env.PAPERCLIP_INSTANCE_ID = instanceId;
  }

  // An explicit data dir or instance selects that instance's own config, not one found above the cwd.
  if (support.hasConfigOption) {
    const hasConfigOverride = Boolean(options.config?.trim()) || Boolean(process.env.PAPERCLIP_CONFIG?.trim());
    if (!hasConfigOverride) {
      process.env.PAPERCLIP_INSTANCE_ID = instanceId;
      process.env.PAPERCLIP_CONFIG = resolveDefaultConfigPath(instanceId);
    }
  }

  if (resolvedDataDir && support.hasContextOption) {
    const hasContextOverride = Boolean(options.context?.trim()) || Boolean(process.env.PAPERCLIP_CONTEXT?.trim());
    if (!hasContextOverride) {
      process.env.PAPERCLIP_CONTEXT = resolveDefaultContextPath();
    }
  }

  return resolvedDataDir;
}

