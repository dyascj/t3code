import {
  type IssueActor,
  type IssueDetail,
  type IssueDetailInput,
  type IssueListEntry,
  type IssueListInput,
  type IssueListResult,
  PullRequestOperationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";

const PAGE_SIZE = 50;

const RestUser = Schema.Struct({
  login: Schema.String,
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RestIssue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(RestUser)),
  assignees: Schema.optional(Schema.NullOr(Schema.Array(RestUser))),
  labels: Schema.Array(
    Schema.Struct({ name: Schema.String, color: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
  comments: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  /** Present only on pull requests, which the issues endpoint also returns. */
  pull_request: Schema.optional(Schema.Unknown),
});

const RestComment = Schema.Struct({
  user: Schema.optional(Schema.NullOr(RestUser)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  html_url: Schema.String,
});

const decodeUser = Schema.decodeUnknownEffect(Schema.fromJsonString(RestUser));
const decodeIssues = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(RestIssue)));
const decodeIssue = Schema.decodeUnknownEffect(Schema.fromJsonString(RestIssue));
const decodeComments = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(RestComment)));

const actor = (user: typeof RestUser.Type | null | undefined): IssueActor | null =>
  user ? { login: user.login, avatarUrl: user.avatar_url ?? null } : null;

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "GitHub could not be read.";

const failure = (operation: string, cause: unknown) =>
  new PullRequestOperationError({ operation, detail: messageOf(cause), cause });

interface IssueRepository {
  readonly project: { readonly id: string; readonly title: string; readonly workspaceRoot: string };
  readonly host: string;
  readonly repository: string;
}

/**
 * Issues for every GitHub project this server knows, read over the REST API with the same
 * credential the pull request page uses.
 */
export const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const identities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  // Optional so a server assembled without drivers (some test harnesses) still starts.
  const restGet = Option.flatMap(
    yield* Effect.serviceOption(SourceControlBuiltInDrivers.SourceControlDrivers),
    (drivers) =>
      Option.fromNullishOr(
        drivers.find(({ driver }) => driver.kind === "github")?.instance.restGet,
      ),
  );

  const repositories = Effect.gen(function* () {
    const shells = yield* projects
      .listShells()
      .pipe(Effect.mapError((cause) => failure("listProjects", cause)));
    const resolved = yield* Effect.forEach(
      shells,
      (project) =>
        (project.repositoryIdentity != null
          ? Effect.succeed(project.repositoryIdentity)
          : identities.resolve(project.workspaceRoot)
        ).pipe(Effect.map((identity) => ({ project, identity }))),
      { concurrency: 4 },
    );
    const seen = new Set<string>();
    const result: IssueRepository[] = [];
    for (const { project, identity } of resolved) {
      if (identity?.provider !== "github") continue;
      const repository = sourceControlDefinitions.repositorySelector(identity);
      if (repository === null) continue;
      const host = sourceControlDefinitions.changeRequestHost(identity, identity.provider);
      const key = `${host}/${repository}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ project, host, repository });
    }
    return result;
  });

  const get = (
    host: string,
    operation: string,
    path: string,
  ): Effect.Effect<string, PullRequestOperationError> =>
    Option.isNone(restGet)
      ? Effect.fail(
          new PullRequestOperationError({
            operation,
            detail: "GitHub is not available on this server.",
          }),
        )
      : restGet
          .value({ host, operation, path })
          .pipe(Effect.mapError((cause) => failure(operation, cause)));

  const viewerLogin = (host: string) =>
    get(host, "issues.viewer", "user").pipe(
      Effect.flatMap(decodeUser),
      Effect.map((user) => user.login),
    );

  const list = Effect.fn("GitHubIssues.list")(function* (input: IssueListInput) {
    const repos = yield* repositories;
    const logins = new Map<string, string | null>();
    if (input.involvement !== "all") {
      for (const host of new Set(repos.map((repo) => repo.host))) {
        logins.set(host, yield* viewerLogin(host).pipe(Effect.orElseSucceed(() => null)));
      }
    }
    const involvementParam = { assigned: "assignee", created: "creator", mentioned: "mentioned" };

    const perRepo = yield* Effect.forEach(
      repos,
      (repo) => {
        const params = new URLSearchParams({
          state: input.state,
          sort: "updated",
          per_page: String(PAGE_SIZE),
        });
        if (input.involvement !== "all") {
          const login = logins.get(repo.host);
          if (!login) {
            return Effect.succeed({
              entries: [] as IssueListEntry[],
              error: { repository: repo.repository, message: "Could not tell who you are." },
            });
          }
          params.set(involvementParam[input.involvement], login);
        }
        return get(repo.host, "issues.list", `repos/${repo.repository}/issues?${params}`).pipe(
          Effect.flatMap(decodeIssues),
          Effect.map((issues) => ({
            entries: issues.flatMap((issue): IssueListEntry[] =>
              issue.pull_request !== undefined || issue.number < 1
                ? []
                : [
                    {
                      projectId: repo.project.id as IssueListEntry["projectId"],
                      projectTitle: repo.project.title,
                      workspaceRoot: repo.project.workspaceRoot,
                      host: repo.host,
                      repository: repo.repository,
                      number: issue.number,
                      title: issue.title,
                      url: issue.html_url,
                      state: issue.state === "closed" ? "closed" : "open",
                      stateReason: issue.state_reason ?? null,
                      author: actor(issue.user),
                      assignees: (issue.assignees ?? []).map((user) => actor(user)!),
                      labels: issue.labels.flatMap((label) =>
                        label.name.trim() === ""
                          ? []
                          : [{ name: label.name.trim(), color: label.color ?? null }],
                      ),
                      comments: Math.max(0, issue.comments),
                      createdAt: issue.created_at,
                      updatedAt: issue.updated_at,
                    },
                  ],
            ),
            error: null,
          })),
          // A repository with issues turned off (most forks) answers 410; it simply has none.
          Effect.catch((cause) =>
            Effect.succeed({
              entries: [] as IssueListEntry[],
              error:
                (cause as { cause?: { status?: number } }).cause?.status === 410
                  ? null
                  : { repository: repo.repository, message: messageOf(cause) },
            }),
          ),
        );
      },
      { concurrency: 4 },
    );

    return {
      entries: perRepo
        .flatMap((repo) => repo.entries)
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      errors: perRepo.flatMap((repo) => (repo.error === null ? [] : [repo.error])),
    } satisfies IssueListResult;
  });

  const detail = Effect.fn("GitHubIssues.detail")(function* (input: IssueDetailInput) {
    const repo = (yield* repositories).find(
      (candidate) => candidate.project.id === input.projectId,
    );
    if (repo === undefined) {
      return yield* new PullRequestOperationError({
        operation: "issues.get",
        detail: "This project is not a GitHub repository.",
        reason: "not-found",
      });
    }
    const base = `repos/${repo.repository}/issues/${input.number}`;
    // ponytail: first 100 comments only; page through `Link` headers if long threads matter.
    const [issue, comments] = yield* Effect.all(
      [
        get(repo.host, "issues.get", base).pipe(Effect.flatMap(decodeIssue)),
        get(repo.host, "issues.comments", `${base}/comments?per_page=100`).pipe(
          Effect.flatMap(decodeComments),
        ),
      ],
      { concurrency: 2 },
    ).pipe(Effect.mapError((cause) => failure("issues.get", cause)));
    return {
      body: issue.body ?? "",
      comments: comments.map((comment) => ({
        author: actor(comment.user),
        body: comment.body ?? "",
        createdAt: comment.created_at,
        url: comment.html_url,
      })),
    } satisfies IssueDetail;
  });

  return {
    list: (input: IssueListInput) => list(input),
    detail: (input: IssueDetailInput) => detail(input),
  };
});
