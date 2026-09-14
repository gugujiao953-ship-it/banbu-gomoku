import { cloneElement, type ReactElement, type ReactNode } from "react";
import { ACTION_LABELS, type ActionId } from "./action-layout";

// Move the original element, including its handlers, disabled state and ARIA metadata.
export function WorkspaceAction({ id, element, label = false }: { id: ActionId; element: ReactElement; label?: boolean }) {
  const node = element as ReactElement<{ children?: ReactNode; className?: string; title?: string; "aria-label"?: string; "data-action-id"?: string }>;
  return cloneElement(node, {
    "data-action-id": id,
    className: `${node.props.className || ""} workspace-action`,
    title: node.props.title || ACTION_LABELS[id],
    "aria-label": node.props["aria-label"] || ACTION_LABELS[id],
    children: <>{node.props.children}{label && <span className="action-label">{ACTION_LABELS[id]}</span>}</>,
  });
}
