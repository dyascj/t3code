import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, ProjectId } from "./baseSchemas.ts";
import { PullRequestLabel } from "./pullRequest.ts";

export const IssueListState = Schema.Literals(["open", "closed", "all"]);
export type IssueListState = typeof IssueListState.Type;

export const IssueInvolvement = Schema.Literals(["all", "assigned", "created", "mentioned"]);
export type IssueInvolvement = typeof IssueInvolvement.Type;

export const IssueListInput = Schema.Struct({
  state: IssueListState,
  involvement: IssueInvolvement,
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueActor = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});
export type IssueActor = typeof IssueActor.Type;

export const IssueListEntry = Schema.Struct({
  projectId: ProjectId,
  projectTitle: Schema.String,
  workspaceRoot: Schema.String,
  host: Schema.String,
  repository: Schema.String,
  number: PositiveInt,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  /** GitHub's `completed`, `not_planned` or `reopened`; null when it gives none. */
  stateReason: Schema.NullOr(Schema.String),
  author: Schema.NullOr(IssueActor),
  assignees: Schema.Array(IssueActor),
  labels: Schema.Array(PullRequestLabel),
  comments: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IssueListEntry = typeof IssueListEntry.Type;

export const IssueListError = Schema.Struct({
  repository: Schema.String,
  message: Schema.String,
});
export type IssueListError = typeof IssueListError.Type;

export const IssueListResult = Schema.Struct({
  entries: Schema.Array(IssueListEntry),
  errors: Schema.Array(IssueListError),
});
export type IssueListResult = typeof IssueListResult.Type;

export const IssueDetailInput = Schema.Struct({
  projectId: ProjectId,
  number: PositiveInt,
});
export type IssueDetailInput = typeof IssueDetailInput.Type;

export const IssueComment = Schema.Struct({
  author: Schema.NullOr(IssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  url: Schema.String,
});
export type IssueComment = typeof IssueComment.Type;

export const IssueDetail = Schema.Struct({
  body: Schema.String,
  comments: Schema.Array(IssueComment),
});
export type IssueDetail = typeof IssueDetail.Type;
