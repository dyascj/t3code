import { useNavigate } from "@tanstack/react-router";
import {
  FolderPlusIcon,
  ListFilterIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Undo2Icon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useSidebarProjectScope } from "../../hooks/useSidebarProjectGroups";
import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { cn } from "../../lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";
import { shouldCreateNewThreadInCurrentProject } from "../Sidebar.logic";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSidebarPageLinks } from "./SidebarChrome";

/*
 * The collapsed sidebar: a 48px rail with the expanded header's entries as
 * icons, in the same order. Search, the project filter, new thread, and add
 * project, then the pages; settings and expand sit at the bottom. Threads live
 * in the title bar tabs.
 */

interface NavItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly onSelect: (event: ReactMouseEvent) => void;
}

function RailItem({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="icon"
        tooltip={item.label}
        aria-label={item.label}
        isActive={item.active ?? false}
        onClick={item.onSelect}
      >
        {item.icon}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The rail's stand-in for the expanded sidebar's undo notice. */
function RailUndoItem() {
  const notice = useThreadUndoNotice((state) => state.notice);
  if (!notice) return null;
  const label = `${notice.action} ${notice.count} thread${notice.count === 1 ? "" : "s"}, undo`;
  return <RailItem item={{ label, icon: <Undo2Icon />, onSelect: undoLatestThreadAction }} />;
}

/** The sidebar's project filter as a menu; it narrows the title bar tabs too. */
function RailProjectFilter() {
  const { groups, group } = useSidebarProjectScope();
  const setScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const label = group
    ? `Filter threads by project: ${group.displayName}`
    : "Filter threads by project";
  return (
    <SidebarMenuItem>
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <SidebarMenuButton size="icon" aria-label={label} isActive={group !== null} />
                }
              />
            }
          >
            {group ? (
              <span className="flex shrink-0">
                <ProjectFavicon project={group} className="size-4" />
              </span>
            ) : (
              <ListFilterIcon />
            )}
          </TooltipTrigger>
          <TooltipPopup side="right">{label}</TooltipPopup>
        </Tooltip>
        <MenuPopup side="right" align="start" className="max-w-72">
          <MenuRadioGroup
            value={group?.projectKey ?? "all"}
            onValueChange={(value) => setScopeKey(value === "all" ? null : String(value))}
          >
            <MenuRadioItem value="all" closeOnClick>
              All projects
            </MenuRadioItem>
            {groups.map((candidate) => (
              <MenuRadioItem key={candidate.projectKey} value={candidate.projectKey} closeOnClick>
                <span className="flex min-w-0 items-center gap-2">
                  <ProjectFavicon project={candidate} className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{candidate.displayName}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}

export function SidebarIconRail() {
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const pageLinks = useSidebarPageLinks();
  const { groups } = useSidebarProjectScope();
  const newThreadContext = useHandleNewThread();
  // Same as the expanded header's button: one project creates at once, several
  // open the picker, and Shift+click skips it for the current project.
  const startNewThread = (event: ReactMouseEvent) => {
    if (shouldCreateNewThreadInCurrentProject(event.shiftKey, groups.length)) {
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    openCommandPalette({ open: "new-thread-in" });
  };
  const actions: NavItem[] = [
    { label: "New thread", icon: <SquarePenIcon />, onSelect: startNewThread },
    {
      label: "Add project",
      icon: <FolderPlusIcon />,
      onSelect: () => openCommandPalette({ open: "add-project" }),
    },
  ];
  const footer: NavItem[] = [
    {
      label: "Settings",
      icon: <SettingsIcon />,
      onSelect: () => void navigate({ to: "/settings" }),
    },
    { label: "Expand sidebar", icon: <PanelLeftIcon />, onSelect: toggleSidebar },
  ];
  return (
    <>
      {/* The titlebar row stays clear for the window controls and back/forward. */}
      <div
        className={cn(
          "h-[var(--workspace-topbar-height)] shrink-0 border-b border-border",
          isElectron && "drag-region",
        )}
      />
      {/* The rail's edge starts below the title bar, which runs across it. */}
      <div className="flex min-h-0 flex-1 flex-col border-r border-border">
        <SidebarContent className="items-center">
          <SidebarMenu className="items-center">
            <RailItem
              item={{
                label: "Search",
                icon: <SearchIcon />,
                onSelect: () => openCommandPalette(),
              }}
            />
            <RailProjectFilter />
            {actions.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
          </SidebarMenu>
          <div aria-hidden className="my-1 h-px w-6 shrink-0 self-center bg-sidebar-border" />
          <SidebarMenu className="items-center">
            {pageLinks.map((link) => (
              <RailItem
                key={link.label}
                item={{
                  label: link.label,
                  icon: link.icon,
                  active: link.active,
                  onSelect: link.onSelect,
                }}
              />
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="items-center">
          <SidebarMenu className="items-center">
            <RailUndoItem />
            {footer.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </>
  );
}
