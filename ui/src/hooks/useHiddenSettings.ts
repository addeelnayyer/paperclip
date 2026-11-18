import { useMemo } from "react";
import type { HealthStatus } from "@/api/health";
import { useHealthCache } from "./useHealthCache";

const selectHiddenSettings = (health: HealthStatus) => health.hiddenSettings ?? [];

/**
 * Settings surfaces hidden by the hosting operator, from the app-wide health
 * query cache (keys from the shared settings-visibility registry, e.g.
 * "instance.plugins" or "instance.experimental.enableSmokeLab").
 *
 * `loaded` is false until the health response is in the cache — gates should
 * render nothing rather than flash a surface that may turn out to be hidden.
 */
export function useHiddenSettings(): { hidden: ReadonlySet<string>; loaded: boolean } {
  const hiddenSettings = useHealthCache(selectHiddenSettings);
  return useMemo(
    () => ({ hidden: new Set(hiddenSettings ?? []), loaded: hiddenSettings !== undefined }),
    [hiddenSettings],
  );
}
