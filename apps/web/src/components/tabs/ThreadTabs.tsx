import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useThreadActions } from "../../hooks/useThreadActions";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { toastManager } from "../ui/toast";
import { useProjects, useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { isSidebarSubagentThread, sortThreadsForSidebar } from "../Sidebar.logic";
import { type ThreadStatusDot, useThreadStatusDot } from "../threadStatusDot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/*
 * The sidebar's thread list as a strip of tabs in the title bar: unsent drafts
 * first, then pinned and active threads in sidebar order, each with its
 * project and live status. Closing a tab does what the sidebar does to put a
 * thread away: it settles a thread and discards an unsent draft.
 */

type TabItem =
  | {
      readonly kind: "draft";
      readonly key: string;
      readonly draftId: DraftId;
      readonly projectKey: string;
      readonly title: string;
    }
  | {
      readonly kind: "thread";
      readonly key: string;
      readonly thread: EnvironmentThreadShell;
      readonly projectKey: string;
    };

// Matches --motion-tab-duration in index.css.
const TAB_MOTION_MS = 200;

// Renaming a background tab opens it first; the header picks the rename up on arrival.
let pendingRenameKey: string | null = null;

/** Asks the header to start renaming a thread once it becomes the active tab. */
export function queueRename(threadKey: string) {
  pendingRenameKey = threadKey;
}

/** True once, for the thread a background tab's "Rename" just opened. */
export function takePendingRename(threadKey: string): boolean {
  if (pendingRenameKey !== threadKey) return false;
  pendingRenameKey = null;
  return true;
}

/** The tab to show after closing one: the nearest to the left, else to the right. */
export function neighborKey(keys: readonly string[], closing: string): string | null {
  const index = keys.indexOf(closing);
  if (index === -1) return null;
  return keys[index - 1] ?? keys[index + 1] ?? null;
}

export function ThreadTabs({
  activeButtonRef,
  activeTitle,
  onActiveClick,
  onActiveDoubleClick,
  onRenameActive,
}: {
  /** The active tab's button, for menus anchored to it. */
  activeButtonRef?: Ref<HTMLButtonElement>;
  /** Replaces the active tab's title, for inline rename. */
  activeTitle?: ReactNode;
  onActiveClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onActiveDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Starts the inline rename on the active tab. */
  onRenameActive?: () => void;
}) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const { settleThread } = useThreadActions();
  const statusOf = useThreadStatusDot();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeDraftId = useParams({
    strict: false,
    select: (params) => ("draftId" in params ? String(params.draftId) : null),
  });
  const activeKey =
    routeDraftId !== null
      ? `draft:${routeDraftId}`
      : routeThreadRef
        ? scopedThreadKey(routeThreadRef)
        : null;

  const providerEntriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(
          ([environmentId, config]) => [environmentId, config.providers] as const,
        ),
      ),
    [serverConfigs],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const items = useMemo<readonly TabItem[]>(() => {
    const drafts: TabItem[] = [];
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) continue;
      const composer = draftsByThreadKey[draftKey];
      const isRoute = draftKey === routeDraftId;
      // An empty draft only gets a tab while it is open, so you can see where you are.
      if (!isRoute && (!composer || !composerDraftHasUserContent(composer))) continue;
      drafts.push({
        kind: "draft",
        key: `draft:${draftKey}`,
        draftId: DraftId.make(draftKey),
        projectKey: `${session.environmentId}:${session.projectId}`,
        title: composer?.prompt.trim().split("\n")[0] || "New thread",
      });
    }
    const open = threads.filter((thread) => {
      if (thread.archivedAt !== null) return false;
      // Subagents live in their parent's lineage view; one only gets a tab while it is open.
      if (
        isSidebarSubagentThread(thread) &&
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) !== activeKey
      ) {
        return false;
      }
      const settles =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement === true;
      return !(settles && thread.settledOverride === "settled");
    });
    const pinned = open.filter((thread) => thread.pinnedAt != null);
    const rest = sortThreadsForSidebar(open.filter((thread) => thread.pinnedAt == null));
    return [
      ...drafts,
      ...[...pinned, ...rest].map((thread): TabItem => ({
        kind: "thread",
        key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread,
        projectKey: `${thread.environmentId}:${thread.projectId}`,
      })),
    ];
  }, [activeKey, draftThreadsByThreadKey, draftsByThreadKey, routeDraftId, serverConfigs, threads]);

  const open = (item: TabItem) => {
    if (item.kind === "draft") {
      void navigate({ to: "/draft/$draftId", params: { draftId: item.draftId } });
    } else {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(item.thread.environmentId, item.thread.id)),
      });
    }
  };

  // Tabs that appear after the first render grow in; closing ones fold away first.
  const seenKeysRef = useRef<Set<string> | null>(null);
  seenKeysRef.current ??= new Set(items.map((item) => item.key));
  const seenKeys = seenKeysRef.current;
  useEffect(() => {
    const current = new Set(items.map((item) => item.key));
    // Forget tabs that left, so a thread restored from Settled grows back in.
    for (const key of seenKeys) if (!current.has(key)) seenKeys.delete(key);
    for (const key of current) seenKeys.add(key);
  }, [items, seenKeys]);
  const [closingKeys, setClosingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const close = (closing: readonly TabItem[]) => {
    if (closing.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void closeNow(closing);
      return;
    }
    const keys = closing.map((item) => item.key);
    setClosingKeys((current) => new Set([...current, ...keys]));
    window.setTimeout(() => {
      void closeNow(closing).finally(() =>
        setClosingKeys((current) => {
          const next = new Set(current);
          for (const key of keys) next.delete(key);
          return next;
        }),
      );
    }, TAB_MOTION_MS);
  };

  const closeNow = async (closing: readonly TabItem[]) => {
    const keys = items.map((item) => item.key);
    const closingKeys = new Set(closing.map((item) => item.key));
    if (activeKey !== null && closingKeys.has(activeKey)) {
      const remaining = keys.filter((key) => !closingKeys.has(key) || key === activeKey);
      const next = neighborKey(remaining, activeKey);
      const nextItem = items.find((item) => item.key === next);
      if (nextItem) open(nextItem);
      else void navigate({ to: "/" });
    }
    for (const item of closing) {
      if (item.kind === "draft") {
        releaseComposerDraftUploads(item.draftId);
        clearDraftThread(item.draftId);
      } else {
        const result = await settleThread(
          scopeThreadRef(item.thread.environmentId, item.thread.id),
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not close the tab",
            description: error instanceof Error ? error.message : "Settling the thread failed.",
          });
        }
      }
    }
  };

  const { openMenu: openThreadMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: null,
    onStartRename: (threadRef) => {
      const key = scopedThreadKey(threadRef);
      if (key === activeKey) {
        onRenameActive?.();
        return;
      }
      const item = items.find((candidate) => candidate.key === key);
      if (!item) return;
      queueRename(key);
      open(item);
    },
  });

  // A thread tab gets the sidebar row's whole menu, then the tab's own close actions.
  const showMenu = (event: ReactMouseEvent, index: number) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    event.stopPropagation();
    const item = items[index]!;
    // Batch closes put threads away but never throw out unsent drafts.
    const threadsOnly = (list: readonly TabItem[]) =>
      list.filter((entry) => entry.kind === "thread");
    const tabItems = [
      { id: "close", label: item.kind === "draft" ? "Discard draft" : "Close tab" },
      { id: "close-others", label: "Close other tabs" },
      { id: "close-right", label: "Close tabs to the right" },
      { id: "close-left", label: "Close tabs to the left" },
    ];
    const onTabAction = (action: string | null) => {
      if (action === "close") close([item]);
      if (action === "close-others") close(threadsOnly(items.filter((_, at) => at !== index)));
      if (action === "close-right") close(threadsOnly(items.slice(index + 1)));
      if (action === "close-left") close(threadsOnly(items.slice(0, index)));
    };
    const position = { x: event.clientX, y: event.clientY };
    if (item.kind === "draft") {
      void api.contextMenu.show(tabItems, position).then(onTabAction);
      return;
    }
    openThreadMenu(position, {
      threadRef: scopeThreadRef(item.thread.environmentId, item.thread.id),
      projectCwd: projectByKey.get(item.projectKey)?.workspaceRoot ?? null,
      extraItems: tabItems,
      onExtra: onTabAction,
    });
  };

  // Overflow: wheel scrolls sideways, edge chevrons appear only toward hidden tabs.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () =>
      setOverflow({
        left: strip.scrollLeft > 1,
        right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
      });
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => {
      strip.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [items.length]);
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[data-tab-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);
  const scrollBy = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left: direction * Math.max(strip.clientWidth * 0.6, 112),
      behavior: "smooth",
    });
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Threads"
        className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {items.map((item, index) => (
          <ThreadTab
            key={item.key}
            item={item}
            project={projectByKey.get(item.projectKey) ?? null}
            provider={
              item.kind === "thread"
                ? (providerEntriesByEnvironment
                    .get(item.thread.environmentId)
                    ?.get(item.thread.providerInstanceId) ?? null)
                : null
            }
            status={item.kind === "thread" ? statusOf(item.thread) : null}
            active={item.key === activeKey}
            activeButtonRef={activeButtonRef}
            activeTitle={activeTitle}
            onActivate={(event) => {
              if (item.key === activeKey) onActiveClick?.(event);
              else open(item);
            }}
            onDoubleClick={(event) => {
              if (item.key === activeKey) onActiveDoubleClick?.(event);
            }}
            opening={!seenKeys.has(item.key)}
            closing={closingKeys.has(item.key)}
            onClose={() => close([item])}
            onContextMenu={(event) => showMenu(event, index)}
          />
        ))}
      </div>
      {overflow.left ? <ScrollChevron side="left" onClick={() => scrollBy(-1)} /> : null}
      {overflow.right ? <ScrollChevron side="right" onClick={() => scrollBy(1)} /> : null}
    </div>
  );
}

function ScrollChevron({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-40 flex size-6.5 -translate-y-1/2 [-webkit-app-region:no-drag] items-center justify-center rounded-md bg-foreground/10 text-foreground/70 backdrop-blur-xl hover:bg-foreground/15 hover:text-foreground",
        side === "left" ? "left-1" : "right-1",
      )}
    >
      {side === "left" ? (
        <ChevronLeftIcon className="size-3.5" strokeWidth={1.75} />
      ) : (
        <ChevronRightIcon className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

// The braille spinner a busy tab shows in place of its provider icon.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function TabSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="inline-block w-3.5 select-none text-center text-2xs leading-none text-status-working">
      {SPINNER_FRAMES[frame]}
    </span>
  );
}

/** Status takes the provider icon's place: a spinner while working, a check when done. */
function TabLeadingIcon({
  item,
  provider,
  status,
  active,
}: {
  item: TabItem;
  provider: ProviderInstanceEntry | null;
  status: ThreadStatusDot | null;
  active: boolean;
}) {
  const dim = active ? "" : "opacity-55";
  const icon =
    status?.kind === "working" ? (
      <TabSpinner />
    ) : status?.kind === "done" ? (
      <CircleCheckIcon className="size-3.5 text-status-done" strokeWidth={2} />
    ) : status?.kind === "approval" ? (
      <ShieldQuestionIcon className="size-3.5 text-status-approval" strokeWidth={2} />
    ) : status?.kind === "input" ? (
      <MessageCircleQuestionIcon className="size-3.5 text-status-input" strokeWidth={2} />
    ) : status?.kind === "failed" ? (
      <CircleAlertIcon className="size-3.5 text-status-failed" strokeWidth={2} />
    ) : status?.kind === "limited" ? (
      <CircleAlertIcon className="size-3.5 text-warning" strokeWidth={2} />
    ) : item.kind === "draft" ? (
      <SquarePenIcon className={cn("size-3.5", dim)} strokeWidth={1.75} />
    ) : provider ? (
      <span className={dim}>
        <ProviderInstanceIcon
          driverKind={provider.driverKind}
          displayName={provider.displayName}
          iconClassName="size-3.5"
        />
      </span>
    ) : (
      <TerminalIcon className={cn("size-3.5", dim)} strokeWidth={1.75} />
    );
  return <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>;
}

function ThreadTab({
  opening,
  closing,
  item,
  project,
  provider,
  status,
  active,
  activeButtonRef,
  activeTitle,
  onActivate,
  onDoubleClick,
  onClose,
  onContextMenu,
}: {
  item: TabItem;
  project: EnvironmentProject | null;
  provider: ProviderInstanceEntry | null;
  status: ThreadStatusDot | null;
  active: boolean;
  activeButtonRef: Ref<HTMLButtonElement> | undefined;
  activeTitle: ReactNode;
  onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  opening: boolean;
  closing: boolean;
}) {
  const title = item.kind === "draft" ? item.title : item.thread.title;
  const closeLabel = item.kind === "draft" ? "Discard draft" : "Settle thread";
  // Keep the mark for the tab's life: the grow-in runs once, and a re-render can't cut it short.
  const [grewIn] = useState(opening);
  const leadingIcon = (
    <TabLeadingIcon item={item} provider={provider} status={status} active={active} />
  );
  return (
    <div
      className="group/tab relative flex h-full w-56 min-w-28 shrink items-center [-webkit-app-region:no-drag]"
      data-tab-active={active ? "" : undefined}
      data-tab-opening={grewIn ? "" : undefined}
      data-tab-closing={closing ? "" : undefined}
      inert={closing}
      onContextMenu={onContextMenu}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        // A middle press would otherwise start autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
    >
      {active && activeTitle ? (
        // Renaming: the input stands in for the tab button, never inside it.
        <div className="flex h-7.5 min-w-0 flex-1 items-center gap-1.5 self-center rounded-md bg-foreground/6 px-2 pr-7 text-foreground dark:bg-foreground/10">
          {leadingIcon}
          {activeTitle}
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                ref={active ? activeButtonRef : undefined}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={status ? `${title}, ${status.label}` : title}
                onClick={onActivate}
                onDoubleClick={onDoubleClick}
                className={cn(
                  "relative flex h-7.5 min-w-0 flex-1 cursor-default items-center gap-1.5 self-center rounded-md px-2 pr-7 text-left transition-colors duration-120 ease-(--motion-ease-out)",
                  active
                    ? "bg-foreground/6 text-foreground dark:bg-foreground/10"
                    : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground",
                )}
              />
            }
          >
            {leadingIcon}
            <span className="tab-label min-w-0 flex-1 truncate text-tab leading-tight">
              {title}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {project ? `${project.title} · ${title}` : title}
            {status ? ` · ${status.label}` : ""}
          </TooltipPopup>
        </Tooltip>
      )}
      <button
        type="button"
        aria-label={closeLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-foreground/50 opacity-0 transition-[background-color,color,opacity] duration-120 ease-(--motion-ease-out) hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100 motion-reduce:transition-none"
      >
        <XIcon className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
