import type { ServerProvider, ServerProviderSkill } from "@t3tools/contracts";

export interface SkillCatalogEntry {
  readonly key: string;
  readonly skill: ServerProviderSkill;
  readonly provider: ServerProvider;
  readonly environmentLabel: string;
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
      const skills = [
        ...provider.skills,
        ...(provider.workspaceSnapshots ?? []).flatMap((snapshot) => snapshot.skills),
      ];
      for (const skill of skills) {
        const key = `${environment.environmentId}:${provider.instanceId}:${skill.path}`;
        if (!entries.has(key)) {
          entries.set(key, { key, skill, provider, environmentLabel: environment.label });
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
export function skillScopeLabel(scope: string | undefined) {
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
