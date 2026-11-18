import { useQuery } from "@tanstack/react-query";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Reads the id of the Paperclip Instance this board talks to from the
 * app-wide health query cache. CloudAccessGate owns the fetch; this observer
 * never issues its own request.
 */
export function useInstanceId(): string | null {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: false,
  });

  return healthQuery.data?.instanceId ?? null;
}
