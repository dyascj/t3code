import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, CopyIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import {
  collectSkillCatalog,
  filterSkillCatalog,
  groupSkills,
  skillProviderName,
  skillProviderTabs,
  type SkillCatalogEntry,
  type SkillGroup,
} from "../../glass/skillsCatalog";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useEnvironments } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const GROUP_PREVIEW = 8;

/*
 * The skills each provider can use, one provider at a time: a tab per provider,
 * then its skills grouped by where they come from (Personal, each project,
 * plugins), one line per skill. Read-only; each provider owns its own skill
 * folders and toggles.
 */
export function SkillsSettingsPanel() {
  const { environments } = useEnvironments();
  // Environments carry their config without providers; the full configs hold them.
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const catalog = collectSkillCatalog(
    environments.flatMap((environment) => {
      const config = serverConfigs.get(environment.environmentId);
      return config
        ? [
            {
              environmentId: environment.environmentId,
              label: environment.label,
              providers: config.providers,
            },
          ]
        : [];
    }),
  );
  const tabs = skillProviderTabs(catalog);
  const showEnvironment = new Set(tabs.map((tab) => tab.environmentLabel)).size > 1;
  const selected = tabs.find((tab) => tab.key === selectedKey) ?? tabs[0] ?? null;
  const providerEntries = selected
    ? catalog.filter((entry) => entry.providerKey === selected.key)
    : [];
  const visible = filterSkillCatalog(providerEntries, query);
  const groups = groupSkills(visible);
  const filtering = query.trim().length > 0;

  return (
    <SettingsPageContainer>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 px-3 sm:px-4">
          <h2 className="text-tab font-semibold text-foreground">Skills</h2>
          <label className="ms-auto flex h-7 w-52 min-w-0 items-center gap-2 rounded-md border border-foreground/10 px-2 text-foreground/45 focus-within:border-foreground/20">
            <SearchIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={selected ? `Filter ${skillProviderName(selected.provider)}` : "Filter"}
              aria-label="Filter skills"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/35"
            />
          </label>
        </div>
        {tabs.length > 1 ? (
          <div className="overflow-x-auto px-3 sm:px-4">
            <ToggleGroup
              aria-label="Provider"
              variant="segmented"
              value={selected ? [selected.key] : []}
              onValueChange={(next) => {
                if (next[0]) setSelectedKey(next[0]);
              }}
            >
              {tabs.map((tab) => {
                const name = skillProviderName(tab.provider);
                return (
                  <Toggle key={tab.key} value={tab.key}>
                    <ProviderInstanceIcon
                      driverKind={tab.provider.driver}
                      displayName={name}
                      accentColor={tab.provider.accentColor}
                      showBadge={false}
                      iconClassName="size-3.5"
                    />
                    {showEnvironment ? `${name}, ${tab.environmentLabel}` : name}
                    <span className="text-foreground/40 tabular-nums">{tab.count}</span>
                  </Toggle>
                );
              })}
            </ToggleGroup>
          </div>
        ) : null}
      </div>

      {catalog.length === 0 ? (
        <p className="px-3 text-xs text-foreground/45 sm:px-4">
          No skills yet. Providers report the skills they find once they are set up.
        </p>
      ) : groups.length === 0 ? (
        <p className="px-3 text-xs text-foreground/45 sm:px-4">No matching skills.</p>
      ) : (
        groups.map((group) => (
          // Filtering shows every match; otherwise long groups start folded.
          <SkillGroupSection
            key={`${selected?.key}:${group.key}:${filtering}`}
            group={group}
            expanded={filtering}
          />
        ))
      )}

      <p className="-mt-4 px-3 text-xs text-foreground/40 sm:px-4">
        Each provider lists the skills it can use, from its own folders and the projects it has
        opened. Turn skills on or off in the provider itself.
      </p>
    </SettingsPageContainer>
  );
}

function SkillGroupSection({
  group,
  expanded: startExpanded,
}: {
  group: SkillGroup;
  expanded: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  const shown = expanded ? group.entries : group.entries.slice(0, GROUP_PREVIEW);
  const hidden = group.entries.length - shown.length;
  return (
    <SettingsSection
      title={group.label}
      titleAction={
        <span className="ms-1 text-xs font-normal tabular-nums text-foreground/40">
          {group.entries.length}
        </span>
      }
      description={group.detail ?? undefined}
    >
      {shown.map((entry) => (
        <SkillRow key={entry.key} entry={entry} namePrefix={group.namePrefix} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-9 w-full items-center px-3 text-xs text-foreground/50 transition-colors hover:text-foreground sm:px-4"
        >
          Show all {group.entries.length}
        </button>
      ) : null}
    </SettingsSection>
  );
}

function SkillRow({ entry, namePrefix }: { entry: SkillCatalogEntry; namePrefix: string | null }) {
  const { skill } = entry;
  const [copied, setCopied] = useState(false);
  const fullName = skill.displayName ?? skill.name;
  // Under its plugin's heading the "plugin:" prefix only repeats it.
  const name =
    namePrefix && fullName.startsWith(namePrefix) ? fullName.slice(namePrefix.length) : fullName;
  const description = skill.shortDescription ?? skill.description;
  const copyPath = () => {
    void writeTextToClipboard(skill.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div
      className={`group/skill flex min-h-10 items-center gap-3 px-3 py-2 sm:px-4 ${skill.enabled ? "" : "opacity-50"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="shrink-0 truncate text-xs font-medium text-foreground sm:w-44">
          {name}
        </span>
        {description ? (
          <Tooltip>
            <TooltipTrigger
              delay={400}
              render={<span className="min-w-0 flex-1 truncate text-xs text-foreground/55" />}
            >
              {description}
            </TooltipTrigger>
            <TooltipPopup side="top" className="max-w-sm">
              {description}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {skill.enabled ? null : (
        <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-foreground/60">
          Off
        </span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Copy path of ${skill.name}`}
              onClick={copyPath}
              className="grid size-6 shrink-0 place-items-center rounded text-foreground/40 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/skill:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          {copied ? (
            <CheckIcon className="size-3.5" strokeWidth={1.75} />
          ) : (
            <CopyIcon className="size-3.5" strokeWidth={1.75} />
          )}
        </TooltipTrigger>
        <TooltipPopup side="left" className="max-w-md break-all">
          {copied ? "Copied" : skill.path}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
