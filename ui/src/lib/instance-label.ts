// Mirrors DEFAULT_PAPERCLIP_INSTANCE_ID in @paperclipai/shared/home-paths,
// which is Node-only and cannot be imported into the UI bundle.
const DEFAULT_INSTANCE_ID = "default";

/**
 * The `[id]` label that tells a board user which Instance they are in, or
 * null for the default Instance so a single-Instance board looks unchanged.
 */
export function instanceLabel(instanceId: string | null | undefined): string | null {
  const id = instanceId?.trim();
  if (!id || id === DEFAULT_INSTANCE_ID) return null;
  return `[${id}]`;
}
