import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useProjects, useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { isSidebarSubagentThread } from "../Sidebar.logic";
import { queueRename } from "../tabs/ThreadTabs";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/*
 * Threads put away from the tab bar. Picking one brings it back as a tab and
 * opens it; right-click gives the same menu a tab has.
 */

const byNewestSettled = (a: EnvironmentThreadShell, b: EnvironmentThreadShell) =>
  (resolveSettledThreadTimestamp(b) ?? "").localeCompare(resolveSettledThreadTimestamp(a) ?? "");

export function SettledThreads({
  trigger,
  side = "right",
}: {
  trigger: ReactElement;
  side?: "right" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup side={side} align="start" width="md" padding="none">
        {open ? <SettledThreadList onDone={() => setOpen(false)} /> : null}
      </PopoverPopup>
    </Popover>
  );
}

function SettledThreadList({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { unsettleThread } = useThreadActions();
  const [query, setQuery] = useState("");

  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const settled = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            !isSidebarSubagentThread(thread) &&
            thread.settledOverride === "settled" &&
            serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
              true,
        )
        .toSorted(byNewestSettled),
    [serverConfigs, threads],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? settled.filter((thread) => thread.title.toLowerCase().includes(needle))
    : settled;

  const openThread = (thread: EnvironmentThreadShell) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };
  const restore = (thread: EnvironmentThreadShell) => {
    void unsettleThread(scopeThreadRef(thread.environmentId, thread.id));
    openThread(thread);
    onDone();
  };
  const { openMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: null,
    onStartRename: (threadRef) => {
      const thread = settled.find(
        (candidate) =>
          candidate.environmentId === threadRef.environmentId &&
          candidate.id === threadRef.threadId,
      );
      if (!thread) return;
      queueRename(scopedThreadKey(threadRef));
      restore(thread);
    },
  });

  return (
    <div className="flex max-h-112 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <SearchIcon className="size-3.5 shrink-0 text-foreground/50" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={`Search ${settled.length} settled`}
          aria-label="Search settled threads"
          className="min-w-0 flex-1 bg-transparent text-tab outline-none placeholder:text-foreground/40"
        />
      </div>
      <div className="min-h-0 overflow-y-auto p-1">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-tab text-muted-foreground">
            {settled.length === 0 ? "Nothing settled yet" : "No matches"}
          </p>
        ) : (
          shown.map((thread) => {
            const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
            const when = resolveSettledThreadTimestamp(thread);
            return (
              <button
                key={`${thread.environmentId}:${thread.id}`}
                type="button"
                onClick={() => restore(thread)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(
                    { x: event.clientX, y: event.clientY },
                    {
                      threadRef: scopeThreadRef(thread.environmentId, thread.id),
                      projectCwd: project?.workspaceRoot ?? null,
                    },
                  );
                }}
                className="flex w-full cursor-default flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-120 hover:bg-foreground/5"
              >
                <span className="w-full truncate text-tab text-foreground">{thread.title}</span>
                <span className="w-full truncate text-3xs text-foreground/40">
                  {[project?.title ?? "No project", when ? formatRelativeTimeLabel(when) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
