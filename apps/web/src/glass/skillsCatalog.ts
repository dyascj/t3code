import type { ServerProvider, ServerProviderSkill } from "@t3tools/contracts";

export interface SkillCatalogEntry {
  readonly key: string;
  readonly skill: ServerProviderSkill;
  readonly provider: ServerProvider;
  /** One provider instance on one environment, the page's tabs. */
  readonly providerKey: string;
  readonly environmentLabel: string;
  /** The project folder that reported it, when it came from a workspace scan. */
  readonly workspace: string | null;
}

/**
 * Every skill each provider reports, its global list plus every workspace it
 * has scanned, one row per provider and path. Sorted by name, then provider.
 */
export function collectSkillCatalog(
  environments: ReadonlyArray<{
    readonly environmentId: string;
    readonly label: string;
    readonly providers: ReadonlyArray<ServerProvider>;
  }>,
): SkillCatalogEntry[] {
  const entries = new Map<string, SkillCatalogEntry>();
  for (const environment of environments) {
    for (const provider of environment.providers) {
      const providerKey = `${environment.environmentId}:${provider.instanceId}`;
      const sources = [
        { workspace: null, skills: provider.skills },
        ...(provider.workspaceSnapshots ?? []).map((snapshot) => ({
          workspace: snapshot.cwd,
          skills: snapshot.skills,
        })),
      ];
      for (const { workspace, skills } of sources) {
        for (const skill of skills) {
          const key = `${providerKey}:${skill.path}`;
          if (!entries.has(key)) {
            entries.set(key, {
              key,
              skill,
              provider,
              providerKey,
              environmentLabel: environment.label,
              workspace,
            });
          }
        }
      }
    }
  }
  return [...entries.values()].toSorted(
    (a, b) =>
      a.skill.name.localeCompare(b.skill.name) ||
      skillProviderName(a.provider).localeCompare(skillProviderName(b.provider)),
  );
}

export function skillProviderName(provider: ServerProvider) {
  return provider.displayName ?? provider.driver;
}

/** MonoCode's scope chip: Personal for user skills, Project for workspace ones. */
function skillScopeLabel(scope: string | undefined) {
  if (!scope) return null;
  if (scope === "user" || scope === "personal" || scope === "global") return "Personal";
  if (scope === "project" || scope === "repo" || scope === "workspace") return "Project";
  return scope.slice(0, 1).toUpperCase() + scope.slice(1);
}

export function filterSkillCatalog(entries: ReadonlyArray<SkillCatalogEntry>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(({ skill, provider }) =>
    [
      skill.name,
      skill.displayName,
      skill.description,
      skill.path,
      skillProviderName(provider),
    ].some((value) => value?.toLowerCase().includes(needle)),
  );
}

export interface SkillProviderTab {
  readonly key: string;
  readonly provider: ServerProvider;
  readonly environmentLabel: string;
  readonly count: number;
}

/** One tab per provider instance that reports skills, by name. */
export function skillProviderTabs(entries: ReadonlyArray<SkillCatalogEntry>): SkillProviderTab[] {
  const tabs = new Map<string, SkillProviderTab>();
  for (const entry of entries) {
    const tab = tabs.get(entry.providerKey);
    tabs.set(entry.providerKey, {
      key: entry.providerKey,
      provider: entry.provider,
      environmentLabel: entry.environmentLabel,
      count: (tab?.count ?? 0) + 1,
    });
  }
  return [...tabs.values()].toSorted(
    (a, b) =>
      skillProviderName(a.provider).localeCompare(skillProviderName(b.provider)) ||
      a.environmentLabel.localeCompare(b.environmentLabel),
  );
}

export interface SkillGroup {
  readonly key: string;
  readonly label: string;
  /** The folder a project group stands for, or "Plugin". */
  readonly detail: string | null;
  /** A plugin group's "plugin:" prefix, which its rows can leave off. */
  readonly namePrefix: string | null;
  readonly entries: ReadonlyArray<SkillCatalogEntry>;
}

const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u)
    .pop() || path;

interface GroupDraft {
  label: string;
  detail: string | null;
  plugin: string | null;
  rank: number;
  entries: SkillCatalogEntry[];
}

/**
 * Where a provider's skills come from: Personal first, then one group per
 * project folder, then one per plugin with several skills, one "Plugins" group
 * for the single-skill ones, and the other scopes. Off skills sink in each group.
 */
export function groupSkills(entries: ReadonlyArray<SkillCatalogEntry>): SkillGroup[] {
  const groups = new Map<string, GroupDraft>();
  const add = (key: string, entry: SkillCatalogEntry, draft: Omit<GroupDraft, "entries">) => {
    const group = groups.get(key) ?? { ...draft, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  };
  for (const entry of entries) {
    const scope = skillScopeLabel(entry.skill.scope);
    const fromProject = entry.workspace !== null && scope !== "Personal";
    // Plugin skills are named plugin:skill.
    const plugin = fromProject ? undefined : /^([^:\s]+):\S/u.exec(entry.skill.name)?.[1];
    if (fromProject) {
      add(`project:${entry.workspace}`, entry, {
        label: folderName(entry.workspace!),
        detail: entry.workspace,
        plugin: null,
        rank: 1,
      });
    } else if (plugin) {
      add(`plugin:${plugin}`, entry, { label: plugin, detail: "Plugin", plugin, rank: 2 });
    } else {
      add(`scope:${scope ?? "Other"}`, entry, {
        label: scope ?? "Other",
        detail: null,
        plugin: null,
        rank: scope === "Personal" ? 0 : 2,
      });
    }
  }
  // A plugin with one skill is a whole section for one row; those share one.
  for (const [key, group] of groups) {
    if (group.plugin === null || group.entries.length > 1) continue;
    groups.delete(key);
    for (const entry of group.entries) {
      add("plugins", entry, { label: "Plugins", detail: null, plugin: null, rank: 2 });
    }
  }
  return [...groups.entries()]
    .toSorted(([, a], [, b]) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(([key, group]) => ({
      key,
      label: group.label,
      detail: group.detail,
      namePrefix: group.plugin === null ? null : `${group.plugin}:`,
      entries: group.entries.toSorted(
        (a, b) =>
          Number(b.skill.enabled) - Number(a.skill.enabled) ||
          (a.skill.displayName ?? a.skill.name).localeCompare(b.skill.displayName ?? b.skill.name),
      ),
    }));
}
