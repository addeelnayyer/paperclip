import type { HealthStatus } from "@/api/health";
import { useHealthCache } from "./useHealthCache";

const selectInstanceId = (health: HealthStatus) => health.instanceId ?? null;

/** Id of the Paperclip Instance this board talks to, from the health cache. */
export function useInstanceId(): string | null {
  return useHealthCache(selectInstanceId) ?? null;
}
