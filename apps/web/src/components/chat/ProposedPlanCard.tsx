import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useFindRevealRef } from "./markdownFindContext";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
} from "../../proposedPlan";
import ChatMarkdown from "../ChatMarkdown";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

const COLLAPSED_PLAN_FADE_MASK = "linear-gradient(to bottom, black calc(100% - 6rem), transparent)";
const PLAN_STEP_START_MS = 250;
const PLAN_STEP_STAGGER_MS = 170;
const PLAN_STEP_CHECK_PATH = "M3.2 6.3 5.1 8.2 8.8 4.2";

/** Plan mode flourish: numbered steps rise through a fresh plan and tick themselves off. */
function PlanStepsBurst() {
  const ref = useRef<HTMLSpanElement>(null);
  const [stepCount, setStepCount] = useState(0);
  const [embers] = useState(() =>
    Array.from({ length: 6 }, (_, index) => ({
      x: Math.min(95, Math.max(5, ((index + Math.random()) / 6) * 100)),
      size: 2.5 + Math.random() * 2,
      delay: PLAN_STEP_START_MS + Math.random() * 1150,
      duration: 1000 + Math.random() * 600,
      drift: (Math.random() - 0.5) * 20,
    })),
  );
  useLayoutEffect(() => {
    const width = ref.current?.getBoundingClientRect().width ?? 0;
    setStepCount(Math.max(2, Math.min(6, Math.floor(width / 64))));
  }, []);
  return (
    <span aria-hidden ref={ref} className="plan-steps">
      {Array.from({ length: stepCount }, (_, index) => (
        <span
          key={index}
          className="plan-step"
          style={
            {
              "--x": `${((index + 0.5) / stepCount) * 100}%`,
              "--delay": `${PLAN_STEP_START_MS + index * PLAN_STEP_STAGGER_MS}ms`,
              "--duration": "1650ms",
              "--drift": `${index % 2 === 0 ? -8 : 8}px`,
            } as CSSProperties
          }
        >
          <span className="plan-step-dot">
            <span className="plan-step-number">{index + 1}</span>
            <svg viewBox="0 0 12 12" className="plan-step-check">
              <path d={PLAN_STEP_CHECK_PATH} />
            </svg>
          </span>
        </span>
      ))}
      {stepCount > 0
        ? embers.map((ember, index) => (
            <span
              key={`ember-${index}`}
              className="plan-step-ember"
              style={
                {
                  "--x": `${ember.x}%`,
                  "--size": `${ember.size}px`,
                  "--delay": `${ember.delay}ms`,
                  "--duration": `${ember.duration}ms`,
                  "--drift": `${ember.drift}px`,
                } as CSSProperties
              }
            >
              <span className="plan-step-ember-glyph" />
            </span>
          ))
        : null}
    </span>
  );
}

export const ProposedPlanCard = memo(function ProposedPlanCard({
  celebrate = false,
  planMarkdown,
  environmentId,
  threadRef,
  cwd,
  workspaceRoot,
  findActive = false,
}: {
  /** Plays the one-shot plan flourish; the timeline sets it for a plan that just arrived. */
  celebrate?: boolean;
  planMarkdown: string;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  findActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "plan",
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy plan",
          description: error instanceof Error ? error.message : "An error occurred while copying.",
        }),
      );
    },
  });
  const savePathInputId = useId();
  const title = proposedPlanTitle(planMarkdown) ?? "Proposed plan";
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
    : null;
  const isCollapsed = canCollapse && !expanded;
  // While finding, the full plan stays mounted but clipped, so a match past the
  // preview can be counted and then opened only once it is selected.
  const showPreview = isCollapsed && !findActive;
  const revealForFind = useCallback(() => setExpanded(true), []);
  const findRevealRef = useFindRevealRef(revealForFind);
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!canWriteFiles) return;
    if (!workspaceRoot) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Workspace path is unavailable",
          description: "This thread does not have a workspace path to save into.",
        }),
      );
      return;
    }
    setSavePath((existing) => (existing.length > 0 ? existing : downloadFilename));
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = () => {
    const relativePath = savePath.trim();
    if (!workspaceRoot || !readEnvironmentScope(environmentId, AuthFilesystemWriteScope)) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: "Enter a workspace path",
      });
      return;
    }

    setIsSavingToWorkspace(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath,
          contents: saveContents,
        },
      });
      setIsSavingToWorkspace(false);
      if (result._tag === "Success") {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: "Plan saved to workspace",
          description: result.value.relativePath,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save plan",
            description: error instanceof Error ? error.message : "An error occurred while saving.",
          }),
        );
      }
    })();
  };

  return (
    <div className="relative rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4">
      {celebrate ? <PlanStepsBurst /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">Plan</Badge>
          {/* Same heading level as the message author headings in the timeline,
              so a plan's own headings nest beneath it in the outline. */}
          <h3 data-thread-find-text="true" className="truncate text-sm font-medium text-foreground">
            {title}
          </h3>
        </div>
        <Menu>
          <MenuTrigger
            render={<Button aria-label="Plan actions" size="icon-xs" variant="outline" />}
          >
            <EllipsisIcon aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={handleCopyPlan}>
              {isCopied ? "Copied!" : "Copy to clipboard"}
            </MenuItem>
            <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
            <MenuItem
              onClick={openSaveDialog}
              disabled={!canWriteFiles || !workspaceRoot || isSavingToWorkspace}
            >
              Save to workspace
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="mt-4">
        <div
          ref={findRevealRef}
          className={cn("relative", isCollapsed && "max-h-104 overflow-hidden")}
          style={
            isCollapsed
              ? { WebkitMaskImage: COLLAPSED_PLAN_FADE_MASK, maskImage: COLLAPSED_PLAN_FADE_MASK }
              : undefined
          }
          data-thread-find-text="true"
          data-thread-find-fold={isCollapsed ? "" : undefined}
        >
          {showPreview ? (
            <ChatMarkdown
              text={collapsedPreview ?? ""}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
              isStreaming={false}
              headingLevelOffset={3}
            />
          ) : (
            <ChatMarkdown
              text={displayedPlanMarkdown}
              cwd={cwd}
              environmentId={environmentId}
              threadRef={threadRef}
              isStreaming={false}
              headingLevelOffset={3}
            />
          )}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingToWorkspace) {
            setIsSaveDialogOpen(open);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Save plan to workspace</DialogTitle>
            <DialogDescription>
              Enter a path relative to <code>{workspaceRoot ?? "the workspace"}</code>.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label htmlFor={savePathInputId} className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Workspace path</span>
              <Input
                id={savePathInputId}
                value={savePath}
                onChange={(event) => setSavePath(event.target.value)}
                placeholder={downloadFilename}
                spellCheck={false}
                disabled={isSavingToWorkspace}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSavingToWorkspace}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveToWorkspace()}
              disabled={!canWriteFiles || isSavingToWorkspace}
            >
              {isSavingToWorkspace ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
});
