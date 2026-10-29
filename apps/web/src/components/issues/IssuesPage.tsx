import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  IssueActor,
  IssueInvolvement,
  IssueListEntry,
  IssueListState,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AtSignIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  LayersIcon,
  MessageSquarePlusIcon,
  PenLineIcon,
  SearchIcon,
  UserCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { issueEnvironment, useIssueLists } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { PullRequestCompactFilterMenu } from "../pullRequest/PullRequestCompactFilterMenu";
import type { PullRequestFilterOption } from "../pullRequest/PullRequestListFilters";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import {
  PullRequestActorAvatar,
  PullRequestLabelChip,
} from "../pullRequest/pullRequestPresentation";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly involvement: IssueInvolvement;
}

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: CircleDotIcon },
  { value: "closed", label: "Closed", Icon: CircleCheckIcon },
  { value: "all", label: "All", Icon: LayersIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

const INVOLVEMENT_OPTIONS = [
  { value: "all", label: "Everyone", Icon: LayersIcon },
  { value: "assigned", label: "Assigned to me", Icon: UserCheckIcon },
  { value: "created", label: "Created by me", Icon: PenLineIcon },
  { value: "mentioned", label: "Mentioning me", Icon: AtSignIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;

type EnvironmentIssue = IssueListEntry & { readonly environmentId: EnvironmentId };

function issueStatus(issue: Pick<IssueListEntry, "state" | "stateReason">) {
  if (issue.state === "open") {
    return {
      label: "Open",
      Icon: CircleDotIcon,
      tone: "text-emerald-600 dark:text-emerald-300/90",
    };
  }
  return issue.stateReason === "not_planned"
    ? { label: "Not planned", Icon: CircleSlashIcon, tone: "text-muted-foreground" }
    : { label: "Closed", Icon: CircleCheckIcon, tone: "text-violet-600 dark:text-violet-300/90" };
}

const asActor = (actor: IssueActor | null) => (actor === null ? null : { ...actor, name: null });

function matchesQuery(issue: IssueListEntry, query: string) {
  const haystack = [
    issue.title,
    issue.repository,
    `#${issue.number}`,
    ...issue.labels.map((label) => label.name),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** The text a new thread starts with: enough for the agent to pick the issue up. */
function issuePrompt(issue: IssueListEntry, body: string | null) {
  const description = body?.trim() ? `\n\n${body.trim()}` : "";
  return `Work on ${issue.repository}#${issue.number}: ${issue.title}\n${issue.url}${description}`;
}

export function IssuesPage({
  search,
  onSearch,
}: {
  search: IssuesSearch;
  onSearch: (next: Partial<IssuesSearch>) => void;
}) {
  const { environments } = useEnvironments();
  const capable = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.issues === true,
  );
  const targets = capable
    .map((environment) => ({
      environmentId: environment.environmentId,
      input: { state: search.state, involvement: search.involvement },
    }))
    .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId));
  const lists = useIssueLists(targets);
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // The same repository can be open on two machines; keep its first copy.
  const seen = new Set<string>();
  const allIssues: EnvironmentIssue[] = lists.values
    .flatMap(([environmentId, result]) =>
      result.entries.map((entry) => ({ ...entry, environmentId })),
    )
    .filter((issue) => !seen.has(issue.url) && Boolean(seen.add(issue.url)))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const repositories = [...new Set(allIssues.map((issue) => issue.repository))].toSorted();
  const issues = allIssues.filter(
    (issue) =>
      (repository === "" || issue.repository === repository) &&
      (query.trim() === "" || matchesQuery(issue, query.trim())),
  );
  const errors = lists.values.flatMap(([, result]) => result.errors);
  const selected = issues.find((issue) => issue.url === selectedKey) ?? null;
  const repositoryOptions: ReadonlyArray<PullRequestFilterOption<string>> = [
    { value: "", label: "All repositories", Icon: FolderGit2Icon },
    ...repositories.map((name) => ({ value: name, label: name, Icon: FolderGit2Icon })),
  ];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Issues</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh issues"
            onClick={() => lists.refresh()}
            disabled={lists.isPending}
          >
            <RefreshIcon size="md" refreshing={lists.isPending} />
          </Button>
        </WorkspacePageHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 min-w-64 shrink-0 flex-col border-r border-border/60">
            <div className="flex flex-col gap-2 border-b border-border/60 p-2">
              <InputGroup className="**:[input]:h-8">
                <InputGroupAddon>
                  <SearchIcon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  placeholder="Filter issues"
                  aria-label="Filter issues"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
              <div className="flex flex-wrap items-center gap-1.5">
                <PullRequestCompactFilterMenu
                  label="Filter by state"
                  value={search.state}
                  options={STATE_OPTIONS}
                  onChange={(state) => onSearch({ state })}
                />
                <PullRequestCompactFilterMenu
                  label="Filter by involvement"
                  value={search.involvement}
                  options={INVOLVEMENT_OPTIONS}
                  onChange={(involvement) => onSearch({ involvement })}
                />
                {repositories.length > 1 ? (
                  <PullRequestCompactFilterMenu
                    label="Filter by repository"
                    value={repository}
                    options={repositoryOptions}
                    onChange={setRepository}
                  />
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {issues.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {capable.length === 0
                    ? "Issues need a machine running this build."
                    : lists.isPending && allIssues.length === 0
                      ? "Loading issues..."
                      : lists.error !== null && allIssues.length === 0
                        ? lists.error
                        : allIssues.length > 0 ||
                            search.state !== "open" ||
                            search.involvement !== "all"
                          ? "No issues match these filters."
                          : "No issues in your GitHub projects."}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {issues.map((issue) => (
                    <li key={issue.url}>
                      <IssueRow
                        issue={issue}
                        selected={issue.url === selected?.url}
                        onSelect={() => setSelectedKey(issue.url)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {errors.length > 0 ? (
                <p className="px-3 py-2 text-2xs text-muted-foreground">
                  {errors.length === 1
                    ? `${errors[0]!.repository}: ${errors[0]!.message}`
                    : `${errors.length} repositories could not be read.`}
                </p>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 flex-1 overflow-y-auto">
            {selected === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <CircleDotIcon className="size-6 opacity-40" />
                <p className="text-sm">Select an issue</p>
              </div>
            ) : (
              <IssueDetailView key={selected.url} issue={selected} />
            )}
          </section>
        </div>
      </div>
    </SidebarInset>
  );
}

function IssueRow({
  issue,
  selected,
  onSelect,
}: {
  issue: EnvironmentIssue;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = issueStatus(issue);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
        selected ? "bg-foreground/10" : "hover:bg-foreground/5",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <status.Icon aria-label={status.label} className={cn("size-3 shrink-0", status.tone)} />
        <span className="min-w-0 truncate">
          #{issue.number} · {issue.repository}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          {formatRelativeTimeLabel(issue.updatedAt)}
        </span>
      </span>
      <span className="truncate text-tab leading-4.5 font-semibold text-foreground">
        {issue.title}
      </span>
      {issue.labels.length > 0 ? (
        <span className="flex min-w-0 gap-1">
          {issue.labels.slice(0, 2).map((label) => (
            <PullRequestLabelChip key={label.name} label={label} className="max-w-28" />
          ))}
        </span>
      ) : null}
    </button>
  );
}

function IssueDetailView({ issue }: { issue: EnvironmentIssue }) {
  const detail = useEnvironmentQuery(
    issueEnvironment.detail({
      environmentId: issue.environmentId,
      input: { projectId: issue.projectId, number: issue.number },
    }),
  );
  const newThread = useNewThreadHandler();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const status = issueStatus(issue);
  const people = issue.assignees.filter((assignee) => assignee.login !== issue.author?.login);

  const startThread = async () => {
    setStarting(true);
    const session = await newThread(scopeProjectRef(issue.environmentId, issue.projectId)).catch(
      () => null,
    );
    setStarting(false);
    if (session === null) {
      toastManager.add({ type: "error", title: "Could not open a thread" });
      return;
    }
    useComposerDraftStore
      .getState()
      .setPrompt(session.draftId, issuePrompt(issue, detail.data?.body ?? null));
    void navigate({ to: "/draft/$draftId", params: { draftId: session.draftId } });
  };

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-3 px-6 pt-5 pb-10">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <status.Icon className={cn("size-3.5", status.tone)} />
        <span className={status.tone}>{status.label}</span>
        <span>·</span>
        <span className="tabular-nums">#{issue.number}</span>
        <span>·</span>
        <span className="truncate">{issue.repository}</span>
      </p>
      <h2 className="line-clamp-2 text-xl leading-6.25 font-semibold text-foreground">
        {issue.title}
      </h2>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <PullRequestActorAvatar actor={asActor(issue.author)} />
        <span className="text-foreground">{issue.author?.login ?? "ghost"}</span>
        <span>opened {formatRelativeTimeLabel(issue.createdAt)}</span>
        <span>·</span>
        <span>updated {formatRelativeTimeLabel(issue.updatedAt)}</span>
        {people.length > 0 ? (
          <>
            <span>·</span>
            {people.map((assignee) => (
              <PullRequestActorAvatar key={assignee.login} actor={asActor(assignee)} />
            ))}
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void startThread()} disabled={starting}>
          <MessageSquarePlusIcon />
          Start thread
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<a href={issue.url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Open on GitHub
        </Button>
      </div>
      {issue.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <PullRequestLabelChip key={label.name} label={label} />
          ))}
        </div>
      ) : null}

      <div className="mt-2 border-t border-border/60 pt-4">
        {detail.data === null ? (
          <p className="text-sm text-muted-foreground">
            {detail.error ?? "Loading description..."}
          </p>
        ) : detail.data.body.trim() === "" ? (
          <p className="text-sm text-muted-foreground italic">No description</p>
        ) : (
          <PullRequestMarkdown
            text={detail.data.body}
            cwd={issue.workspaceRoot}
            environmentId={issue.environmentId}
          />
        )}
      </div>

      {detail.data !== null && detail.data.comments.length > 0 ? (
        <div className="mt-2 flex flex-col gap-3 border-t border-border/60 pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            {detail.data.comments.length === 1
              ? "1 comment"
              : `${detail.data.comments.length} comments`}
          </h3>
          {detail.data.comments.map((comment) => (
            <div
              key={comment.url}
              className="rounded-md border border-border/60 bg-foreground/[0.03] px-3 py-2.5"
            >
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <PullRequestActorAvatar actor={asActor(comment.author)} className="size-5" />
                <span className="text-foreground">{comment.author?.login ?? "ghost"}</span>
                <a href={comment.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {formatRelativeTimeLabel(comment.createdAt)}
                </a>
              </p>
              <PullRequestMarkdown
                text={comment.body}
                cwd={issue.workspaceRoot}
                environmentId={issue.environmentId}
              />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
