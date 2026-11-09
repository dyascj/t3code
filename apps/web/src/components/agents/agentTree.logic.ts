// The agent tree in the right panel: a thread and its subagents, built from
// thread shells already in memory plus the open thread's subagent records.

export type AgentTreeStatus =
  | "running"
  | "queued"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "idle";

export interface AgentTreeThreadInput {
  readonly id: string;
  readonly parentId: string | null;
  readonly isSubagent: boolean;
  readonly title: string;
  readonly model: string;
  readonly providerInstanceId: string;
  /** The live run status when there is one, else the thread's status. */
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/** A subagent record on the open thread; one whose thread is not loaded is a leaf under it. */
export interface AgentTreeSubagentInput {
  readonly id: string;
  readonly childThreadId: string | null;
  readonly title: string | null;
  readonly prompt: string;
  readonly model: string | null;
  readonly providerInstanceId: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface AgentTreeNode {
  readonly key: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly task: string | null;
  readonly model: string | null;
  readonly providerInstanceId: string;
  readonly status: AgentTreeStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly children: ReadonlyArray<AgentTreeNode>;
}

export interface AgentTree {
  readonly root: AgentTreeNode;
  readonly total: number;
  readonly running: number;
  readonly failed: number;
}

function agentTreeStatus(status: string, hasRun: boolean): AgentTreeStatus {
  switch (status) {
    case "preparing":
    case "starting":
    case "running":
    case "in_progress":
      return "running";
    case "queued":
    case "pending":
      return "queued";
    case "waiting":
    case "blocked":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "interrupted":
    case "rolled_back":
      return "stopped";
    default:
      // A subagent thread goes idle once its run ends.
      return hasRun ? "done" : "idle";
  }
}

const isLive = (status: AgentTreeStatus) =>
  status === "running" || status === "queued" || status === "waiting";

export function buildAgentTree(input: {
  readonly threads: ReadonlyArray<AgentTreeThreadInput>;
  readonly currentThreadId: string;
  readonly subagents: ReadonlyArray<AgentTreeSubagentInput>;
}): AgentTree | null {
  const byId = new Map(input.threads.map((thread) => [thread.id, thread]));
  const current = byId.get(input.currentThreadId);
  if (!current) return null;

  // Climb subagent edges to the agent that started it all; a cycle stops the climb.
  let root = current;
  const climbed = new Set([root.id]);
  while (root.isSubagent && root.parentId !== null) {
    const parent = byId.get(root.parentId);
    if (!parent || climbed.has(parent.id)) break;
    climbed.add(parent.id);
    root = parent;
  }

  const childrenByParent = new Map<string, AgentTreeThreadInput[]>();
  for (const thread of input.threads) {
    if (!thread.isSubagent || thread.parentId === null) continue;
    const siblings = childrenByParent.get(thread.parentId) ?? [];
    siblings.push(thread);
    childrenByParent.set(thread.parentId, siblings);
  }
  const recordByThread = new Map(
    input.subagents.flatMap((agent) =>
      agent.childThreadId === null ? [] : [[agent.childThreadId, agent] as const],
    ),
  );

  let total = 0;
  let running = 0;
  let failed = 0;
  const count = (status: AgentTreeStatus) => {
    total += 1;
    if (isLive(status)) running += 1;
    if (status === "failed") failed += 1;
  };

  const visited = new Set<string>();
  const build = (thread: AgentTreeThreadInput): AgentTreeNode => {
    visited.add(thread.id);
    const record = recordByThread.get(thread.id);
    const threadStatus = agentTreeStatus(thread.status, thread.startedAt !== null);
    // A live thread run is fresher than the record; otherwise the record knows how it ended.
    const status =
      record && !isLive(threadStatus)
        ? agentTreeStatus(record.status, record.startedAt !== null)
        : threadStatus;
    count(status);
    const children = (childrenByParent.get(thread.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(build);
    const pending =
      thread.id === input.currentThreadId
        ? input.subagents
            // Idle children can be left out of the shells; their records still place them.
            .filter((agent) => agent.childThreadId === null || !byId.has(agent.childThreadId))
            .map((agent): AgentTreeNode => {
              const agentStatus = agentTreeStatus(agent.status, agent.startedAt !== null);
              count(agentStatus);
              return {
                key: `subagent:${agent.id}`,
                threadId: agent.childThreadId,
                title: agent.title ?? "Subagent",
                task: agent.prompt || null,
                model: agent.model,
                providerInstanceId: agent.providerInstanceId,
                status: agentStatus,
                startedAt: agent.startedAt,
                completedAt: agent.completedAt,
                children: [],
              };
            })
        : [];
    return {
      key: `thread:${thread.id}`,
      threadId: thread.id,
      title: thread.title,
      task: record?.prompt || null,
      model: record?.model ?? thread.model,
      providerInstanceId: thread.providerInstanceId,
      status,
      startedAt: isLive(threadStatus) || !record ? thread.startedAt : record.startedAt,
      completedAt: isLive(threadStatus) || !record ? thread.completedAt : record.completedAt,
      children: [...children, ...pending],
    };
  };

  return { root: build(root), total, running, failed };
}
