import { DEFAULT_PAPERCLIP_INSTANCE_ID } from "@paperclipai/shared";

/**
 * The `[id]` label that tells a board user which Instance they are in, or
 * null for the default Instance so a single-Instance board looks unchanged.
 */
export function instanceLabel(instanceId: string | null | undefined): string | null {
  const id = instanceId?.trim();
  if (!id || id === DEFAULT_PAPERCLIP_INSTANCE_ID) return null;
  return `[${id}]`;
}
