import type { HealthStatus } from "@/api/health";
import { useHealthCache } from "./useHealthCache";

const selectCloud = (health: HealthStatus) => health.cloud ?? null;

/**
 * Reads Paperclip Cloud metadata from the app-wide health query cache without
 * adding another health request when consumers mount.
 */
export function useCloudInstance() {
  return useHealthCache(selectCloud) ?? null;
}
