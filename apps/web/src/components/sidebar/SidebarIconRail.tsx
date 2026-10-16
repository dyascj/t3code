import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  Undo2Icon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  hasUnseenCompletion,
  isSidebarSubagentThread,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  sortThreadsForSidebar,
} from "../Sidebar.logic";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";

/*
 * The collapsed sidebar: a 48px rail with Search on top, the thread list as
 * project icons in the scrolling middle, and the utility pages at the bottom.
 * Expanded, the sidebar is upstream's thread list.
 */

interface NavItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

function RailItem({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="icon"
        tooltip={item.label}
        aria-label={item.label}
        onClick={item.onSelect}
      >
        {item.icon}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The rail's stand-in for the expanded sidebar's undo notice. */
function RailUndoItem() {
  const notice = useThreadUndoNotice((state) => state.notice);
  if (!notice) return null;
  const label = `${notice.action} ${notice.count} thread${notice.count === 1 ? "" : "s"}, undo`;
  return <RailItem item={{ label, icon: <Undo2Icon />, onSelect: undoLatestThreadAction }} />;
}

// The same hues the expanded sidebar uses for each status.
const STATUS_DOT = {
  working: { label: "Working", className: "bg-sky-500 animate-status-pulse" },
  waiting: { label: "Waiting", className: "bg-foreground" },
  approval: { label: "Needs approval", className: "bg-amber-500" },
  input: { label: "Needs input", className: "bg-indigo-500" },
  failed: { label: "Failed", className: "bg-red-500" },
  limited: { label: "Limited", className: "bg-amber-500" },
  done: { label: "Done", className: "bg-emerald-500" },
} as const;

/**
 * The threads the expanded list shows in its pinned and active sections, in
 * that order. Settled and snoozed threads stay in the expanded sidebar.
 */
function RailThreads() {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const activeKey = useParams({
    strict: false,
    select: (params) => {
      const ref = resolveThreadRouteRef(params);
      return ref ? scopedThreadKey(ref) : null;
    },
  });
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const shown = useMemo(() => {
    const now = new Date().toISOString();
    const open = threads.filter((thread) => {
      if (thread.archivedAt !== null) return false;
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      // Subagents live under their parent; one only shows here while it is open.
      if (isSidebarSubagentThread(thread) && key !== activeKey) return false;
      const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
      if (capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now })) return false;
      return !(capabilities?.threadSettlement === true && thread.settledOverride === "settled");
    });
    return [
      ...open.filter((thread) => thread.pinnedAt != null),
      ...sortThreadsForSidebar(open.filter((thread) => thread.pinnedAt == null)),
    ];
  }, [activeKey, serverConfigs, threads]);

  const statusOf = (thread: EnvironmentThreadShell, key: string) => {
    const status = resolveSidebarThreadStatus(thread);
    if (status !== "ready") return STATUS_DOT[status];
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localLastVisitedAtById[key],
    );
    return hasUnseenCompletion({ ...thread, lastVisitedAt }) ? STATUS_DOT.done : null;
  };

  return (
    <SidebarMenu className="items-center">
      {shown.map((thread) => {
        const ref = scopeThreadRef(thread.environmentId, thread.id);
        const key = scopedThreadKey(ref);
        const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
        const status = statusOf(thread, key);
        const label = [thread.title, project?.title, status?.label].filter(Boolean).join(" · ");
        return (
          <SidebarMenuItem key={key}>
            <SidebarMenuButton
              size="icon"
              tooltip={label}
              aria-label={label}
              isActive={key === activeKey}
              className="relative"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(ref),
                })
              }
            >
              {project ? (
                <ProjectFavicon project={project} className="size-4" />
              ) : (
                <span className="size-4 rounded-sm bg-muted" />
              )}
              {status ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-sidebar",
                    status.className,
                  )}
                />
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function SidebarIconRail() {
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const pullRequestsSupported = usePullRequestsSupported();
  const footer: NavItem[] = [
    {
      label: "Usage",
      icon: <ChartNoAxesColumnIcon />,
      onSelect: () => void navigate({ to: "/usage" }),
    },
    ...(pullRequestsSupported
      ? [
          {
            label: "Pull Requests",
            icon: <PullRequestGlyph.pullRequest />,
            onSelect: () =>
              void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() }),
          },
        ]
      : []),
    {
      label: "Settings",
      icon: <SettingsIcon />,
      onSelect: () => void navigate({ to: "/settings" }),
    },
    { label: "Expand sidebar", icon: <PanelLeftIcon />, onSelect: toggleSidebar },
  ];
  return (
    <>
      {/* The titlebar row stays clear for the window controls and back/forward. */}
      <div
        className={cn(
          "h-[var(--workspace-topbar-height)] shrink-0 border-b border-border",
          isElectron && "drag-region",
        )}
      />
      {/* The rail's edge starts below the title bar, which runs across it. */}
      <div className="flex min-h-0 flex-1 flex-col border-r border-border">
        <SidebarContent
          className="items-center"
          fixedHeader={
            <div className="flex justify-center border-b border-sidebar-border p-2">
              <SidebarMenu className="items-center">
                <RailItem
                  item={{
                    label: "Search",
                    icon: <SearchIcon />,
                    onSelect: () => openCommandPalette(),
                  }}
                />
              </SidebarMenu>
            </div>
          }
        >
          <RailThreads />
        </SidebarContent>
        <SidebarFooter className="items-center">
          <div className="mb-1 h-px w-6 shrink-0 bg-sidebar-border" />
          <SidebarMenu className="items-center">
            <RailUndoItem />
            {footer.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </>
  );
}
