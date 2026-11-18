import { useInstanceId } from "@/hooks/useInstanceId";
import { instanceLabel } from "@/lib/instance-label";

/**
 * Names the Paperclip Instance in the company menu trigger, which every sidebar
 * shell renders, so a board user with several Instances open always knows which
 * one they are acting in. Renders nothing for the default Instance.
 */
export function SidebarInstanceLabel() {
  const instanceId = useInstanceId();
  const label = instanceLabel(instanceId);
  if (!label) return null;
  return (
    <span
      className="shrink-0 font-mono text-xs text-muted-foreground"
      title={`Paperclip Instance: ${instanceId}`}
    >
      {label}
    </span>
  );
}
