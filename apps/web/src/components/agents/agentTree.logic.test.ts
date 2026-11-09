import { describe, expect, it } from "vite-plus/test";

import { buildAgentTree, type AgentTreeNode, type AgentTreeThreadInput } from "./agentTree.logic";

const thread = (
  id: string,
  parentId: string | null,
  status: string,
  createdAt: string,
  isSubagent = parentId !== null,
): AgentTreeThreadInput => ({
  id,
  parentId,
  isSubagent,
  title: id,
  model: "model",
  providerInstanceId: "claude",
  status,
  startedAt: status === "idle" ? "2026-11-09T10:00:00Z" : null,
  completedAt: null,
  createdAt,
});

const shape = (node: AgentTreeNode): unknown => ({
  [node.title]: node.status,
  ...(node.children.length > 0 ? { children: node.children.map(shape) } : {}),
});

describe("buildAgentTree", () => {
  const threads = [
    thread("orchestrator", null, "running", "1"),
    thread("coder", "orchestrator", "idle", "3"),
    thread("researcher", "orchestrator", "idle", "2"),
    thread("tester", "coder", "failed", "4"),
    // A fork is its own thread, not an agent in this tree.
    thread("fork", "orchestrator", "idle", "5", false),
  ];

  it("climbs from a nested subagent to the root and nests children by creation order", () => {
    const tree = buildAgentTree({ threads, currentThreadId: "tester", subagents: [] })!;
    expect(shape(tree.root)).toEqual({
      orchestrator: "running",
      children: [{ researcher: "done" }, { coder: "done", children: [{ tester: "failed" }] }],
    });
    expect([tree.total, tree.running, tree.failed]).toEqual([4, 1, 1]);
  });

  it("takes the task and outcome from the open thread's records and adds unloaded ones", () => {
    const tree = buildAgentTree({
      threads,
      currentThreadId: "orchestrator",
      subagents: [
        {
          id: "a",
          childThreadId: "researcher",
          title: "Researcher",
          prompt: "Compare pricing",
          model: "opus",
          providerInstanceId: "claude",
          status: "interrupted",
          startedAt: "2026-11-09T10:00:00Z",
          completedAt: "2026-11-09T10:01:00Z",
        },
        {
          id: "c",
          childThreadId: "unloaded",
          title: "Tester",
          prompt: "Run the tests",
          model: null,
          providerInstanceId: "claude",
          status: "completed",
          startedAt: "2026-11-09T10:00:00Z",
          completedAt: "2026-11-09T10:02:00Z",
        },
        {
          id: "b",
          childThreadId: null,
          title: "Writer",
          prompt: "Write copy",
          model: null,
          providerInstanceId: "claude",
          status: "running",
          startedAt: "2026-11-09T10:00:00Z",
          completedAt: null,
        },
      ],
    })!;
    const [researcher, , tester, writer] = tree.root.children;
    expect(researcher).toMatchObject({ status: "stopped", task: "Compare pricing", model: "opus" });
    expect(tester).toMatchObject({ threadId: "unloaded", title: "Tester", status: "done" });
    expect(writer).toMatchObject({ threadId: null, title: "Writer", status: "running" });
    expect([tree.total, tree.running]).toEqual([6, 2]);
  });

  it("survives a lineage cycle", () => {
    const tree = buildAgentTree({
      threads: [thread("a", "b", "idle", "1"), thread("b", "a", "idle", "2")],
      currentThreadId: "a",
      subagents: [],
    })!;
    expect(tree.total).toBe(2);
  });
});
