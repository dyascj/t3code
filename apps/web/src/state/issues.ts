import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments } from "./environments";
import { createMergedEnvironmentQuery } from "./pullRequests";

export const issueEnvironment = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issues:list",
    tag: WS_METHODS.issuesList,
    staleTimeMs: 60_000,
  }),
  detail: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:issues:detail",
    tag: WS_METHODS.issuesGet,
    staleTimeMs: 30_000,
  }),
};

/** Every capable machine's issues, one failing machine never blanking the rest. */
export const useIssueLists = createMergedEnvironmentQuery("web-issues:list", issueEnvironment.list);

export function useIssuesSupported() {
  const { environments } = useEnvironments();
  return environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.issues === true,
  );
}
