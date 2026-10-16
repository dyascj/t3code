import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { useSidebarProjectScope } from "../../hooks/useSidebarProjectGroups";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useSupportsMultiplePullRequests } from "../../hooks/useSupportsMultiplePullRequests";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useProjects, useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  hasUnseenCompletion,
  isSidebarSubagentThread,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  sortThreadsForSidebar,
} from "../Sidebar.logic";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadPullRequestsMiniList } from "../ThreadStatusIndicators";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import {
  applyVisibleOrder,
  neighborKey,
  orderTabKeys,
  resolveRenameCommit,
  tabsToClose,
} from "./ThreadTabs.logic";
import { TabLabel, TabMotionSlot, useTabMotion, useTabReorder } from "./useTabMotion";

/*
 * The title bar is a strip of thread tabs, after MonoCode's: unsent drafts and
 * the threads the sidebar keeps open (pinned and active, not settled or
 * snoozed), each with its live status, in an order you can drag. Closing a tab
 * puts the thread away the way the sidebar does: it settles a thread and
 * discards an unsent draft. The sidebar's project filter narrows the strip.
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
      readonly ref: ScopedThreadRef;
      readonly thread: EnvironmentThreadShell;
      readonly projectKey: string;
    };

type TabStatus = {
  readonly kind: "working" | "waiting" | "approval" | "input" | "failed" | "limited" | "done";
  readonly label: string;
};

const STATUS_LABEL: Record<TabStatus["kind"], string> = {
  working: "Working",
  waiting: "Waiting",
  approval: "Needs approval",
  input: "Needs input",
  failed: "Failed",
  limited: "Usage limit reached",
  done: "Done",
};

const TAB_ORDER_STORAGE_KEY = "t3code:tab-order:v1";
const TabOrderSchema = Schema.Array(Schema.String);
// Keeps the saved order from growing forever; the oldest absent tabs go first.
const TAB_ORDER_LIMIT = 400;

// A draft becoming a thread remounts the chat view; the strip picks up where it was.
let rememberedScrollLeft = 0;

function readSavedOrder(): readonly string[] {
  try {
    return getLocalStorageItem(TAB_ORDER_STORAGE_KEY, TabOrderSchema) ?? [];
  } catch {
    return [];
  }
}

export function ThreadTabs() {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const { settleThread } = useThreadActions();
  const { group: scopedGroup } = useSidebarProjectScope();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
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
          ([environmentId, config]) => [environmentId, config.providers, config.settings] as const,
        ),
      ),
    [serverConfigs],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedGroup
        ? new Set(
            scopedGroup.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
          )
        : null,
    [scopedGroup],
  );

  // Every tab that could show, in the sidebar's default order.
  const candidates = useMemo<readonly TabItem[]>(() => {
    const drafts: TabItem[] = [];
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) continue;
      const composer = draftsByThreadKey[draftKey];
      // An empty draft only gets a tab while it is open, so you can see where you are.
      if (draftKey !== routeDraftId && (!composer || !composerDraftHasUserContent(composer))) {
        continue;
      }
      drafts.push({
        kind: "draft",
        key: `draft:${draftKey}`,
        draftId: DraftId.make(draftKey),
        projectKey: `${session.environmentId}:${session.projectId}`,
        title: composer?.prompt.trim().split("\n")[0] || "New thread",
      });
    }
    const now = new Date().toISOString();
    const open = threads.filter((thread) => {
      if (thread.archivedAt !== null) return false;
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (key === activeKey) return true;
      // Subagents live in their parent's lineage; one only gets a tab while it is open.
      if (isSidebarSubagentThread(thread)) return false;
      const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
      if (capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now })) return false;
      return !(capabilities?.threadSettlement === true && thread.settledOverride === "settled");
    });
    return [
      ...drafts,
      ...[
        ...open.filter((thread) => thread.pinnedAt != null),
        ...sortThreadsForSidebar(open.filter((thread) => thread.pinnedAt == null)),
      ].map((thread): TabItem => {
        const ref = scopeThreadRef(thread.environmentId, thread.id);
        return {
          kind: "thread",
          key: scopedThreadKey(ref),
          ref,
          thread,
          projectKey: `${thread.environmentId}:${thread.projectId}`,
        };
      }),
    ];
  }, [activeKey, draftThreadsByThreadKey, draftsByThreadKey, routeDraftId, serverConfigs, threads]);

  // Tabs keep the place you gave them; new ones join at the end.
  const [savedOrder, setSavedOrder] = useState(readSavedOrder);
  const saveOrder = useCallback((next: readonly string[]) => {
    setSavedOrder(next);
    try {
      setLocalStorageItem(TAB_ORDER_STORAGE_KEY, next, TabOrderSchema);
    } catch {
      // Order is a preference; losing it is fine.
    }
  }, []);
  const candidateKeys = useMemo(() => candidates.map((item) => item.key), [candidates]);
  useEffect(() => {
    const saved = new Set(savedOrder);
    const unseen = candidateKeys.filter((key) => !saved.has(key));
    if (unseen.length === 0) return;
    // A draft that just became a thread hands the thread its slot.
    const promotedFrom = new Map<string, string>();
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo)
        promotedFrom.set(scopedThreadKey(session.promotedTo), `draft:${draftKey}`);
    }
    let next = [...savedOrder];
    for (const key of unseen) {
      const draftAt = next.indexOf(promotedFrom.get(key) ?? "");
      if (draftAt >= 0) next[draftAt] = key;
      else next.push(key);
    }
    const present = new Set(candidateKeys);
    while (next.length > TAB_ORDER_LIMIT) {
      const stale = next.findIndex((key) => !present.has(key));
      if (stale < 0) break;
      next = next.filter((_, index) => index !== stale);
    }
    saveOrder(next);
  }, [candidateKeys, draftThreadsByThreadKey, saveOrder, savedOrder]);

  const items = useMemo(() => {
    const byKey = new Map(candidates.map((item) => [item.key, item]));
    return orderTabKeys(savedOrder, candidateKeys)
      .map((key) => byKey.get(key)!)
      .filter(
        (item) =>
          scopedProjectKeys === null ||
          item.key === activeKey ||
          scopedProjectKeys.has(item.projectKey),
      );
  }, [activeKey, candidateKeys, candidates, savedOrder, scopedProjectKeys]);
  const keys = useMemo(() => items.map((item) => item.key), [items]);

  const statusOf = (item: TabItem): TabStatus | null => {
    if (item.kind === "draft") return null;
    const status = resolveSidebarThreadStatus(item.thread);
    if (status !== "ready") return { kind: status, label: STATUS_LABEL[status] };
    const lastVisitedAt = resolveThreadLastVisitedAt(
      item.thread.lastVisitedAt,
      localLastVisitedAtById[item.key],
    );
    return item.key !== activeKey && hasUnseenCompletion({ ...item.thread, lastVisitedAt })
      ? { kind: "done", label: STATUS_LABEL.done }
      : null;
  };

  const open = (item: TabItem) => {
    if (item.key === activeKey) return;
    if (item.kind === "draft") {
      void navigate({ to: "/draft/$draftId", params: { draftId: item.draftId } });
    } else {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(item.ref) });
    }
  };

  const canClose = (item: TabItem) =>
    item.kind === "draft" ||
    serverConfigs.get(item.ref.environmentId)?.environment.capabilities.threadSettlement === true;

  const close = (closing: readonly TabItem[]) => {
    const closable = closing.filter(canClose);
    if (closable.length === 0) return;
    const closingKeys = new Set(closable.map((item) => item.key));
    if (activeKey !== null && closingKeys.has(activeKey)) {
      const remaining = keys.filter((key) => !closingKeys.has(key) || key === activeKey);
      const next = items.find((item) => item.key === neighborKey(remaining, activeKey));
      if (next) open(next);
      else void navigate({ to: "/" });
    }
    for (const item of closable) {
      if (item.kind === "draft") {
        releaseComposerDraftUploads(item.draftId);
        clearDraftThread(item.draftId);
        continue;
      }
      void settleThread(item.ref).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not close the tab",
            description: error instanceof Error ? error.message : "Settling the thread failed.",
          });
        }
      });
    }
  };

  // Inline rename, on the tab itself.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const startRename = useCallback((ref: ScopedThreadRef) => {
    if (!readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingKey(scopedThreadKey(ref));
  }, []);
  const commitRename = (item: TabItem, title: string) => {
    setRenamingKey(null);
    if (item.kind !== "thread") return;
    const resolution = resolveRenameCommit({ title, originalTitle: item.thread.title });
    if (resolution.action === "reject-empty") {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (resolution.action === "noop") return;
    void updateThreadMetadata({
      environmentId: item.ref.environmentId,
      input: { threadId: item.ref.threadId, title: resolution.title },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };

  const { openMenu: openThreadMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: null,
    onStartRename: startRename,
  });

  // A thread tab gets the sidebar row's whole menu, then the strip's close actions.
  const showMenu = (event: ReactMouseEvent, item: TabItem) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    // Batch closes put threads away but never throw out unsent drafts.
    const batch = (side: "others" | "left" | "right") =>
      tabsToClose(keys, item.key, side)
        .map((key) => items.find((candidate) => candidate.key === key)!)
        .filter((candidate) => candidate.kind === "thread");
    const tabItems = [
      {
        id: "close",
        label: item.kind === "draft" ? "Discard draft" : "Close tab",
        disabled: !canClose(item),
      },
      { id: "close-others", label: "Close other tabs", disabled: batch("others").length === 0 },
      {
        id: "close-right",
        label: "Close tabs to the right",
        disabled: batch("right").length === 0,
      },
      { id: "close-left", label: "Close tabs to the left", disabled: batch("left").length === 0 },
    ];
    const onTabAction = (action: string | null) => {
      if (action === "close") close([item]);
      if (action === "close-others") close(batch("others"));
      if (action === "close-right") close(batch("right"));
      if (action === "close-left") close(batch("left"));
    };
    const position = { x: event.clientX, y: event.clientY };
    if (item.kind === "draft") {
      void api.contextMenu.show(tabItems, position).then(onTabAction);
      return;
    }
    openThreadMenu(position, {
      threadRef: item.ref,
      projectCwd: projectByKey.get(item.projectKey)?.workspaceRoot ?? null,
      extraItems: tabItems,
      onExtra: onTabAction,
    });
  };

  const { entries, setTabNode, finishMotion } = useTabMotion(items);
  const reorder = useTabReorder(keys, (next) => saveOrder(applyVisibleOrder(savedOrder, next)));

  // Overflow: the wheel scrolls sideways and edge buttons show only toward hidden tabs.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const updateOverflow = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    rememberedScrollLeft = strip.scrollLeft;
    const max = strip.scrollWidth - strip.clientWidth;
    const next =
      max <= 1
        ? { left: false, right: false }
        : { left: strip.scrollLeft > 1, right: strip.scrollLeft < max - 1 };
    setOverflow((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = rememberedScrollLeft;
    updateOverflow();
    strip.addEventListener("scroll", updateOverflow, { passive: true });
    const stopObserving = observeResize(strip, updateOverflow);
    return () => {
      strip.removeEventListener("scroll", updateOverflow);
      stopObserving();
    };
  }, [updateOverflow]);
  useLayoutEffect(updateOverflow, [updateOverflow, items]);
  useEffect(() => {
    if (reorder.draggingKey) return;
    stripRef.current
      ?.querySelector<HTMLElement>("[data-tab-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, reorder.draggingKey]);
  const scrollStrip = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left: direction * Math.max(strip.clientWidth * 0.6, 112),
      behavior: "smooth",
    });
  };

  return (
    <div
      className="relative h-full min-w-0 flex-1 overflow-hidden"
      onWheel={(event) => {
        const strip = stripRef.current;
        if (!strip || strip.scrollWidth <= strip.clientWidth) return;
        if (event.deltaX === 0 && event.deltaY !== 0) strip.scrollLeft += event.deltaY;
      }}
    >
      {overflow.left ? <ScrollButton side="left" onClick={() => scrollStrip(-1)} /> : null}
      {overflow.right ? <ScrollButton side="right" onClick={() => scrollStrip(1)} /> : null}
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Threads"
        className="flex h-full min-w-0 cursor-default items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry) => {
          const item = entry.item;
          const moving = entry.closing || entry.opening;
          const slot = (
            <div
              ref={entry.closing ? undefined : (node) => setTabNode(entry.key, node)}
              className={cn(
                "relative flex h-full items-center [-webkit-app-region:no-drag]",
                moving ? "w-full min-w-0 overflow-hidden" : "w-56 min-w-28 shrink",
              )}
            >
              <ThreadTab
                item={item}
                project={projectByKey.get(item.projectKey) ?? null}
                provider={
                  item.kind === "thread"
                    ? (providerEntriesByEnvironment
                        .get(item.ref.environmentId)
                        ?.get(
                          item.thread.runtime?.providerInstanceId ??
                            item.thread.modelSelection.instanceId,
                        ) ?? null)
                    : null
                }
                status={statusOf(item)}
                active={!entry.closing && item.key === activeKey}
                closable={!entry.closing && canClose(item)}
                draggable={!entry.closing && keys.length > 1}
                renaming={!entry.closing && renamingKey === item.key}
                itemRef={entry.closing ? undefined : (node) => reorder.setItemRef(item.key, node)}
                onPointerDown={(event) => reorder.onItemPointerDown(item.key, event)}
                onSelect={() => {
                  if (!reorder.consumeClick()) open(item);
                }}
                onStartRename={() => {
                  if (item.kind === "thread") startRename(item.ref);
                }}
                onCommitRename={(title) => commitRename(item, title)}
                onCancelRename={() => setRenamingKey(null)}
                onClose={() => close([item])}
                onContextMenu={(event) => showMenu(event, item)}
              />
            </div>
          );
          return moving ? (
            <TabMotionSlot
              key={entry.key}
              phase={entry.closing ? "closing" : "opening"}
              width={entry.width}
              onFinish={() => finishMotion(entry.key)}
            >
              {slot}
            </TabMotionSlot>
          ) : (
            <div key={entry.key} className="contents">
              {slot}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScrollButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-40 grid size-6.5 -translate-y-1/2 place-items-center rounded-md bg-foreground/10 text-foreground/70 backdrop-blur-xl hover:bg-foreground/15 hover:text-foreground",
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
  status: TabStatus | null;
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

/** Hover card: what the sidebar row's card says, from the tab. */
function TabHoverCard({
  item,
  project,
  provider,
  status,
}: {
  item: TabItem;
  project: EnvironmentProject | null;
  provider: ProviderInstanceEntry | null;
  status: TabStatus | null;
}) {
  const thread = item.kind === "thread" ? item.thread : null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(
    thread?.environmentId ?? null,
  );
  const model = thread
    ? provider?.models.find((candidate) => candidate.slug === thread.modelSelection.model)
    : undefined;
  const modelLabel = thread
    ? model
      ? getTriggerDisplayModelLabel(model)
      : thread.modelSelection.model
    : null;
  return (
    <ThreadHoverCardPopup side="bottom" align="start" sideOffset={6}>
      <ThreadHoverCard
        title={item.kind === "draft" ? item.title : item.thread.title}
        footer={
          thread && supportsMultiplePullRequests && thread.pullRequests.length > 0 ? (
            <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
              <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
            </div>
          ) : null
        }
      >
        {project ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProjectFavicon project={project} className="size-3 shrink-0" />
            <div className="min-w-0 truncate text-foreground/75">{project.title}</div>
          </div>
        ) : null}
        {thread?.branch ? (
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">{thread.branch}</div>
          </div>
        ) : null}
        {provider && modelLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderInstanceIcon
              driverKind={provider.driverKind}
              displayName={provider.displayName}
              iconClassName="size-3 shrink-0 grayscale opacity-60"
            />
            <div className="min-w-0 truncate text-foreground/75">
              {modelLabel} · {provider.displayName}
            </div>
          </div>
        ) : null}
        {status ? (
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                status.kind === "working" && "bg-status-working",
                status.kind === "done" && "bg-status-done",
                status.kind === "approval" && "bg-status-approval",
                status.kind === "input" && "bg-status-input",
                status.kind === "failed" && "bg-status-failed",
                (status.kind === "limited" || status.kind === "waiting") && "bg-warning",
              )}
            />
            <div className="min-w-0 truncate text-foreground/75">{status.label}</div>
          </div>
        ) : null}
        {item.kind === "draft" ? <div className="text-foreground/75">Unsent draft</div> : null}
      </ThreadHoverCard>
    </ThreadHoverCardPopup>
  );
}

function ThreadTab({
  item,
  project,
  provider,
  status,
  active,
  closable,
  draggable,
  renaming,
  itemRef,
  onPointerDown,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onClose,
  onContextMenu,
}: {
  item: TabItem;
  project: EnvironmentProject | null;
  provider: ProviderInstanceEntry | null;
  status: TabStatus | null;
  active: boolean;
  closable: boolean;
  draggable: boolean;
  renaming: boolean;
  itemRef: ((node: HTMLDivElement | null) => void) | undefined;
  onPointerDown: (event: ReactPointerEvent) => void;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const title = item.kind === "draft" ? item.title : item.thread.title;
  // Wide tabs carry a second line, like MonoCode's: the project, then the status.
  const meta = [project?.title, status?.label].filter(Boolean).join(" · ");
  const leadingIcon = (
    <TabLeadingIcon item={item} provider={provider} status={status} active={active} />
  );
  const committedRef = useRef(false);
  const onRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      committedRef.current = true;
      onCommitRename(event.currentTarget.value);
    } else if (event.key === "Escape") {
      committedRef.current = true;
      onCancelRename();
    }
  };
  return (
    <div
      ref={itemRef}
      className="reorder-item tab-motion group/tab @container relative flex h-full w-full min-w-0 touch-none items-center"
      data-tab-active={active || undefined}
      onContextMenu={onContextMenu}
      onMouseDown={(event) => {
        // A middle press would otherwise start autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !closable) return;
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || renaming || !draggable) return;
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        onPointerDown(event);
      }}
    >
      {renaming ? (
        <div className="flex h-7.5 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-foreground/6 px-2 pr-7 dark:bg-foreground/10">
          {leadingIcon}
          <input
            autoFocus
            aria-label="Thread title"
            data-no-drag
            className="min-w-0 flex-1 bg-transparent text-tab text-foreground outline-none"
            defaultValue={title}
            onFocus={(event) => {
              committedRef.current = false;
              event.currentTarget.select();
            }}
            onKeyDown={onRenameKeyDown}
            onBlur={(event) => {
              if (!committedRef.current) onCommitRename(event.currentTarget.value);
            }}
          />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={status ? `${title}, ${status.label}` : title}
                onClick={onSelect}
                onDoubleClick={() => {
                  if (item.kind === "thread") onStartRename();
                }}
                className={cn(
                  "relative flex h-7.5 min-w-0 flex-1 cursor-default items-center gap-1.5 rounded-md px-2 text-left",
                  closable ? "pr-7" : "pr-2.5",
                  active
                    ? "bg-foreground/6 text-foreground dark:bg-foreground/10"
                    : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground",
                )}
              />
            }
          >
            {leadingIcon}
            <span className="flex min-w-0 flex-1 flex-col justify-center">
              <TabLabel
                className={cn(
                  "leading-tight",
                  item.kind === "draft" && "italic",
                  meta ? "text-tab @min-[11rem]:text-2xs @min-[11rem]:font-medium" : "text-tab",
                )}
              >
                {title}
              </TabLabel>
              {meta ? (
                <TabLabel className="hidden text-3xs leading-tight text-foreground/45 @min-[11rem]:block">
                  {meta}
                </TabLabel>
              ) : null}
            </span>
          </TooltipTrigger>
          <TabHoverCard item={item} project={project} provider={provider} status={status} />
        </Tooltip>
      )}
      {closable ? (
        <button
          type="button"
          aria-label={item.kind === "draft" ? "Discard draft" : `Close ${title}`}
          data-no-drag
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-foreground/50 opacity-0 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
        >
          <XIcon className="size-3" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
