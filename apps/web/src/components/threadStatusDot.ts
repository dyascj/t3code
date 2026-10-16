import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useCallback } from "react";

import { useUiStateStore } from "../uiStateStore";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "./Sidebar.logic";

export type ThreadStatusKind =
  | "working"
  | "waiting"
  | "approval"
  | "input"
  | "failed"
  | "limited"
  | "done";

export interface ThreadStatusDot {
  readonly kind: ThreadStatusKind;
  readonly label: string;
  readonly className: string;
}

// The same hues the expanded sidebar uses for each status.
const STATUS_DOT = {
  working: { kind: "working", label: "Working", className: "bg-sky-500 animate-status-pulse" },
  waiting: { kind: "waiting", label: "Waiting", className: "bg-foreground" },
  approval: { kind: "approval", label: "Needs approval", className: "bg-amber-500" },
  input: { kind: "input", label: "Needs input", className: "bg-indigo-500" },
  failed: { kind: "failed", label: "Failed", className: "bg-red-500" },
  limited: { kind: "limited", label: "Limited", className: "bg-amber-500" },
  done: { kind: "done", label: "Done", className: "bg-emerald-500" },
} as const satisfies Record<ThreadStatusKind, ThreadStatusDot>;

/** The live status dot for a thread, as the sidebar would show it, or null when it is idle. */
export function useThreadStatusDot() {
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  return useCallback(
    (thread: EnvironmentThreadShell): ThreadStatusDot | null => {
      const status = resolveSidebarThreadStatus(thread);
      if (status !== "ready") return STATUS_DOT[status];
      const lastVisitedAt =
        lastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))];
      return hasUnseenCompletion({ ...thread, lastVisitedAt }) ? STATUS_DOT.done : null;
    },
    [lastVisitedAtById],
  );
}
