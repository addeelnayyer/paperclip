import { useQuery } from "@tanstack/react-query";
import { healthApi, type HealthStatus } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Selects a slice of the app-wide health query cache. CloudAccessGate owns the
 * fetch; this observer never issues its own request, and re-renders only when
 * the selected slice changes. `undefined` until the health response is cached.
 */
export function useHealthCache<T>(select: (health: HealthStatus) => T): T | undefined {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: false,
    select,
  });
  return healthQuery.data;
}
