import type { MouseEvent as ReactMouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useSidebarProjectScope } from "../../hooks/useSidebarProjectGroups";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { shouldCreateNewThreadInCurrentProject } from "../Sidebar.logic";

/**
 * New thread, as the expanded header's button: one project creates at once,
 * several open the picker, and Shift+click skips it for the current project.
 */
export function useStartNewThread() {
  const { groups } = useSidebarProjectScope();
  const newThreadContext = useHandleNewThread();
  return (event: ReactMouseEvent) => {
    if (shouldCreateNewThreadInCurrentProject(event.shiftKey, groups.length)) {
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    openCommandPalette({ open: "new-thread-in" });
  };
}
