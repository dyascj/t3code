import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  formatSubagentDisplayTitle,
  resolveSubagentMetadata,
} from "@t3tools/client-runtime/state/subagent-display";
import type { ScopedThreadRef, ServerProvider, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  SparklesIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useThreadProjection } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { environmentThreadShells } from "~/state/threads";
import { AgentElapsed } from "../chat/AgentElapsed";
import { ThreadRelationshipIcon } from "../chat/ThreadRelationshipIcon";
import { Spinner } from "../ui/spinner";
import {
  buildAgentTree,
  type AgentTreeNode,
  type AgentTreeStatus,
  type AgentTreeThreadInput,
} from "./agentTree.logic";

const iso = (value: DateTime.Utc | null | undefined) => (value ? DateTime.formatIso(value) : null);

const STATUS: Record<
  AgentTreeStatus,
  { readonly label: string; readonly className: string; readonly icon: React.ReactNode }
> = {
  running: {
    label: "Running",
    className: "bg-activity/15 text-activity",
    icon: <Spinner className="size-3" />,
  },
  queued: {
    label: "Queued",
    className: "bg-warning/12 text-warning",
    icon: <ClockIcon className="size-3" />,
  },
  waiting: {
    label: "Waiting",
    className: "bg-warning/12 text-warning",
    icon: <ClockIcon className="size-3" />,
  },
  done: {
    label: "Done",
    className: "bg-success/12 text-success",
    icon: <CheckIcon className="size-3" />,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/12 text-destructive",
    icon: <TriangleAlertIcon className="size-3" />,
  },
  stopped: {
    label: "Stopped",
    className: "bg-foreground/8 text-muted-foreground",
    icon: <SquareIcon className="size-2.5" />,
  },
  idle: {
    label: "Idle",
    className: "bg-foreground/8 text-muted-foreground",
    icon: null,
  },
};

function StatusPill({ status }: { readonly status: AgentTreeStatus }) {
  const { label, className, icon } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 font-medium text-xs",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

interface BranchContext {
  readonly currentThreadId: ThreadId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onOpen: (threadId: string) => void;
}

function AgentCard(props: {
  readonly node: AgentTreeNode;
  readonly context: BranchContext;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { node, context } = props;
  const provider = context.providers.find(
    (candidate) => candidate.instanceId === node.providerInstanceId,
  );
  const { modelLabel } = resolveSubagentMetadata({ model: node.model, provider });
  const isCurrent = node.threadId === context.currentThreadId;
  const openable = node.threadId !== null && !isCurrent;
  const title = formatSubagentDisplayTitle(node.title) || "Untitled agent";
  const task = node.task ? plainTask(node.task) : "";
  return (
    <div
      data-agent-card
      data-current={isCurrent || undefined}
      className={cn(
        "glass-card relative flex w-full min-w-0 flex-col gap-2.5 p-3.5 text-left",
        openable && "cursor-pointer",
      )}
    >
      {/* The whole card opens the thread; the toggle sits above this layer. */}
      {openable ? (
        <button
          type="button"
          aria-label={`Open ${title}`}
          onClick={() => context.onOpen(node.threadId!)}
          className="absolute inset-0 rounded-[inherit] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        />
      ) : null}
      <div className="pointer-events-none flex min-w-0 items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/6">
          <ThreadRelationshipIcon
            driver={provider?.driver}
            provider={provider}
            fallbackIcon={BotIcon}
            status={null}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground text-sm leading-5">{title}</div>
          <div className="truncate text-muted-foreground text-xs leading-4">{modelLabel}</div>
        </div>
        <StatusPill status={node.status} />
      </div>
      {task ? (
        <p className="pointer-events-none line-clamp-2 text-foreground/80 text-sm leading-5">
          {task}
        </p>
      ) : null}
      <div className="flex min-h-5 items-center gap-2 text-muted-foreground text-xs">
        <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 truncate">
          {isCurrent ? <span className="text-activity">This thread</span> : null}
          <AgentElapsed agent={elapsedOf(node)} />
        </span>
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-expanded={props.expanded}
            aria-label={`${props.expanded ? "Hide" : "Show"} ${node.children.length} subagents`}
            onClick={props.onToggle}
            className="relative z-10 -me-1 inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 tabular-nums transition-colors hover:bg-(--glass-row-hover) hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {node.children.length}
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", !props.expanded && "-rotate-90")}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Prompts can open with harness markup such as <task-notification>; the card shows words. */
function plainTask(task: string): string {
  return task
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** AgentElapsed speaks the subagent record's status words. */
function elapsedOf(node: AgentTreeNode) {
  const status =
    node.status === "done"
      ? "completed"
      : node.status === "stopped"
        ? "interrupted"
        : node.status === "queued"
          ? "pending"
          : node.status;
  return { status, startedAt: node.startedAt, completedAt: node.completedAt } as const;
}

function AgentBranch(props: {
  readonly node: AgentTreeNode;
  readonly context: BranchContext;
  readonly root?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const { node } = props;
  return (
    <>
      <div className={props.root ? "agent-tree-root-card" : undefined}>
        <AgentCard
          node={node}
          context={props.context}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      </div>
      {expanded && node.children.length > 0 ? (
        <ul
          className={cn("agent-tree-children", props.root && "agent-tree-root-children")}
          data-fan={(props.root && node.children.length <= 4) || undefined}
        >
          {node.children.map((child) => (
            <li key={child.key}>
              <AgentBranch node={child} context={props.context} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function AgentTreePanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shells = useAtomValue(
    environmentThreadShells.environmentThreadsAtom(threadRef.environmentId),
  );
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const subagents = projection?.subagents ?? [];
  const providers = useEnvironmentProviders().get(threadRef.environmentId) ?? [];

  const threads = shells.map((shell): AgentTreeThreadInput => ({
    id: shell.id,
    parentId: shell.lineage.parentThreadId,
    isSubagent: shell.lineage.relationshipToParent === "subagent",
    title: shell.title,
    model: shell.modelSelection.model,
    providerInstanceId: shell.providerInstanceId,
    status: shell.activityRunStatus ?? shell.status,
    startedAt: iso(shell.activityRunStatus ? shell.activityRunStartedAt : shell.latestRunStartedAt),
    completedAt: shell.activityRunStatus ? null : iso(shell.latestRunCompletedAt),
    createdAt: iso(shell.createdAt) ?? "",
  }));
  // An archived thread is not in the live shells; its own record still roots the tree.
  const openThread = projection?.thread;
  if (openThread && !shells.some((shell) => shell.id === openThread.id)) {
    threads.push({
      id: openThread.id,
      parentId: openThread.lineage.parentThreadId,
      isSubagent: openThread.lineage.relationshipToParent === "subagent",
      title: openThread.title,
      model: openThread.modelSelection.model,
      providerInstanceId: openThread.providerInstanceId,
      status: "idle",
      startedAt: null,
      completedAt: null,
      createdAt: iso(openThread.createdAt) ?? "",
    });
  }
  const tree = buildAgentTree({
    threads,
    currentThreadId: threadRef.threadId,
    subagents: subagents
      // Tasks on a linked environment have no thread here.
      .filter((agent) => agent.remoteChild === undefined)
      .map((agent) => ({
        id: agent.id,
        childThreadId: agent.childThreadId,
        title: agent.title,
        prompt: agent.prompt,
        model: agent.model,
        providerInstanceId: agent.providerInstanceId,
        status: agent.status,
        startedAt: iso(agent.startedAt),
        completedAt: iso(agent.completedAt),
      })),
  });

  const context: BranchContext = {
    currentThreadId: threadRef.threadId,
    providers,
    onOpen: (threadId) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(threadRef.environmentId, threadId as ThreadId),
        ),
      }),
  };

  return (
    <div className="@container/agent-tree h-full min-h-0 scrollbar-gutter-both overflow-y-auto overscroll-contain">
      <div className="flex min-h-full flex-col gap-5 p-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SparklesIcon className="size-4 text-activity" aria-hidden />
          <h2 className="font-medium text-foreground text-sm">Agents</h2>
          {tree && tree.total > 1 ? (
            <div className="ms-auto flex items-center gap-2.5 text-xs tabular-nums">
              <span className="text-muted-foreground">{tree.total} agents</span>
              {tree.running > 0 ? (
                <span className="text-activity">{tree.running} running</span>
              ) : null}
              {tree.failed > 0 ? (
                <span className="rounded-md bg-destructive/12 px-1.5 py-0.5 text-destructive">
                  {tree.failed} failed
                </span>
              ) : null}
            </div>
          ) : null}
        </header>
        {tree && tree.root.children.length > 0 ? (
          <div className="agent-tree">
            <AgentBranch node={tree.root} context={context} root />
          </div>
        ) : (
          <div className="m-auto flex max-w-64 flex-col items-center gap-1.5 text-center">
            <BotIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="font-medium text-foreground text-sm">No subagents yet</p>
            <p className="text-muted-foreground text-xs">
              When this thread starts subagents, they show up here as a tree you can follow live.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
