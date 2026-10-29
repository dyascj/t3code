import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { collectSkillCatalog, filterSkillCatalog } from "./skillsCatalog";

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
