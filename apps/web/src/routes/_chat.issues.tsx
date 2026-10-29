import { createFileRoute } from "@tanstack/react-router";

import { IssuesPage, type IssuesSearch } from "../components/issues/IssuesPage";

function IssuesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <IssuesPage
      search={{ state: search.issueState ?? "open", involvement: search.issueFilter ?? "all" }}
      onSearch={(next) =>
        void navigate({
          search: (current) => ({
            ...current,
            ...(next.state === undefined ? {} : { issueState: next.state }),
            ...(next.involvement === undefined ? {} : { issueFilter: next.involvement }),
          }),
        })
      }
    />
  );
}

// Own names: a key shared with another route's search widens both routes' types.
export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (
    raw: Record<string, unknown>,
  ): { issueState?: IssuesSearch["state"]; issueFilter?: IssuesSearch["involvement"] } => ({
    ...(raw.issueState === "closed" || raw.issueState === "all"
      ? { issueState: raw.issueState }
      : {}),
    ...(raw.issueFilter === "assigned" ||
    raw.issueFilter === "created" ||
    raw.issueFilter === "mentioned"
      ? { issueFilter: raw.issueFilter }
      : {}),
  }),
  component: IssuesRoute,
});
