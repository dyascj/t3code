import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectSkillCatalog,
  filterSkillCatalog,
  groupSkills,
  skillProviderTabs,
} from "./skillsCatalog";

const skill = (name: string, path: string) => ({ name, path, enabled: true });
const provider = (instanceId: string, extra: Partial<ServerProvider>) =>
  ({ instanceId, driver: instanceId, skills: [], ...extra }) as unknown as ServerProvider;

describe("collectSkillCatalog", () => {
  it("merges global and workspace skills once per provider and path, sorted by name", () => {
    const shared = skill("review", "/home/me/.agents/skills/review/SKILL.md");
    const entries = collectSkillCatalog([
      {
        environmentId: "local",
        label: "This Mac",
        providers: [
          provider("claude", {
            skills: [shared],
            workspaceSnapshots: [
              {
                cwd: "/repo",
                checkedAt: "2026-10-13T00:00:00.000Z",
                slashCommands: [],
                skills: [shared, skill("deploy", "/repo/.agents/skills/deploy/SKILL.md")],
              },
            ],
          } as Partial<ServerProvider>),
          provider("codex", { skills: [shared] } as Partial<ServerProvider>),
        ],
      },
    ]);
    expect(entries.map((entry) => `${entry.skill.name}@${entry.provider.instanceId}`)).toEqual([
      "deploy@claude",
      "review@claude",
      "review@codex",
    ]);
    expect(filterSkillCatalog(entries, "codex")).toHaveLength(1);
    expect(filterSkillCatalog(entries, "  ")).toHaveLength(3);
  });
});

describe("groupSkills", () => {
  it("puts Personal first, then a group per project folder, then plugins and other scopes, off skills last", () => {
    const entries = collectSkillCatalog([
      {
        environmentId: "local",
        label: "This Mac",
        providers: [
          provider("claude", {
            skills: [
              { ...skill("review", "/home/.claude/skills/review"), scope: "user" },
              { ...skill("audit", "/home/.claude/skills/audit"), scope: "user", enabled: false },
              { ...skill("lint", "/home/.claude/plugins/lint"), scope: "plugin" },
              { ...skill("design:audit", "/home/.claude/plugins/design/audit"), scope: "user" },
              { ...skill("design:polish", "/home/.claude/plugins/design/polish"), scope: "user" },
              { ...skill("pdf:read", "/home/.claude/plugins/pdf/read"), scope: "user" },
            ],
            workspaceSnapshots: [
              {
                cwd: "/code/glass/",
                checkedAt: "2026-10-13T00:00:00.000Z",
                slashCommands: [],
                skills: [{ ...skill("ship", "/code/glass/.claude/skills/ship"), scope: "project" }],
              },
            ],
          } as Partial<ServerProvider>),
          provider("codex", { skills: [skill("review", "/home/.codex/skills/review")] }),
        ],
      },
    ]);
    expect(
      skillProviderTabs(entries).map((tab) => `${tab.provider.instanceId}:${tab.count}`),
    ).toEqual(["claude:7", "codex:1"]);
    const claude = entries.filter((entry) => entry.provider.instanceId === "claude");
    expect(
      groupSkills(claude).map((group) => [
        group.label,
        group.entries.map((entry) => entry.skill.name),
      ]),
    ).toEqual([
      ["Personal", ["review", "audit"]],
      ["glass", ["ship"]],
      ["design", ["design:audit", "design:polish"]],
      ["Plugin", ["lint"]],
      ["Plugins", ["pdf:read"]],
    ]);
  });
});
