import { CheckIcon, CopyIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  collectSkillCatalog,
  filterSkillCatalog,
  skillProviderName,
  skillScopeLabel,
  type SkillCatalogEntry,
} from "../../glass/skillsCatalog";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironments } from "../../state/environments";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { SettingsPageContainer } from "./settingsLayout";

/*
 * Every skill across every provider and environment, after MonoCode's Skills
 * page: a filter, then one row per skill with its scope, provider, and path.
 * Read-only; each provider owns its own skill folders and toggles.
 */
export function SkillsSettingsPanel() {
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const catalog = useMemo(
    () =>
      collectSkillCatalog(
        environments.flatMap((environment) =>
          environment.serverConfig
            ? [
                {
                  environmentId: environment.environmentId,
                  label: environment.label,
                  providers: environment.serverConfig.providers,
                },
              ]
            : [],
        ),
      ),
    [environments],
  );
  const visible = filterSkillCatalog(catalog, query);
  const showEnvironment = new Set(catalog.map((entry) => entry.environmentLabel)).size > 1;

  return (
    <SettingsPageContainer>
      <section className="space-y-3">
        <div className="flex items-center gap-3 px-3 sm:px-4">
          <h2 className="text-tab font-semibold text-foreground">Skills</h2>
          <span className="text-xs tabular-nums text-foreground/40">
            {visible.length} {visible.length === 1 ? "skill" : "skills"}
          </span>
          <label className="ms-auto flex h-7 w-52 min-w-0 items-center gap-2 rounded-md border border-foreground/10 px-2 text-foreground/45 focus-within:border-foreground/20">
            <SearchIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Filter skills"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/35"
            />
          </label>
        </div>
        <div className="overflow-hidden rounded-xl border border-foreground/10 bg-foreground/3">
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-xs text-foreground/45">
              {catalog.length === 0
                ? "No skills yet. Providers report the skills they find once they are set up."
                : "No matching skills"}
            </p>
          ) : (
            visible.map((entry) => (
              <SkillRow key={entry.key} entry={entry} showEnvironment={showEnvironment} />
            ))
          )}
        </div>
        <p className="px-3 text-xs text-foreground/40 sm:px-4">
          Each provider lists the skills it can use, from its own folders and the projects it has
          opened. Turn skills on or off in the provider itself.
        </p>
      </section>
    </SettingsPageContainer>
  );
}

function SkillRow({
  entry,
  showEnvironment,
}: {
  entry: SkillCatalogEntry;
  showEnvironment: boolean;
}) {
  const { skill, provider } = entry;
  const [copied, setCopied] = useState(false);
  const scope = skillScopeLabel(skill.scope);
  const providerName = skillProviderName(provider);
  const description = skill.shortDescription ?? skill.description;
  const copyPath = () => {
    void writeTextToClipboard(skill.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div
      className={`border-b border-foreground/5 px-3 py-2 last:border-b-0 ${skill.enabled ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-2">
        <span className="me-auto min-w-0 truncate text-xs text-foreground">
          {skill.displayName ?? skill.name}
        </span>
        {skill.enabled ? null : <SkillChip>Off</SkillChip>}
        {scope ? <SkillChip>{scope}</SkillChip> : null}
        <span className="flex w-32 shrink-0 items-center justify-end gap-1.5 text-2xs text-foreground/40">
          <ProviderInstanceIcon
            driverKind={provider.driver}
            displayName={providerName}
            accentColor={provider.accentColor}
            showBadge={false}
            iconClassName="size-3"
          />
          <span className="truncate">
            {showEnvironment ? `${providerName}, ${entry.environmentLabel}` : providerName}
          </span>
        </span>
      </div>
      {description ? (
        <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
      ) : null}
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-2xs text-foreground/35">{skill.path}</p>
        <button
          type="button"
          aria-label={`Copy path of ${skill.name}`}
          onClick={copyPath}
          className="grid size-5 shrink-0 place-items-center rounded text-foreground/40 hover:bg-foreground/10 hover:text-foreground"
        >
          {copied ? (
            <CheckIcon className="size-3" strokeWidth={1.75} />
          ) : (
            <CopyIcon className="size-3" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  );
}

function SkillChip({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-foreground/60">
      {children}
    </span>
  );
}
