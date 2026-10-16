import { useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  FolderPlusIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Undo2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";

/*
 * The collapsed sidebar: a 48px icon rail with the places the thread list
 * would otherwise lead to. Expanded, the sidebar is upstream's thread list.
 */

interface NavItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

function RailItem({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="icon"
        tooltip={item.label}
        aria-label={item.label}
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

export function SidebarIconRail() {
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const pullRequestsSupported = usePullRequestsSupported();
  const primary: NavItem[] = [
    { label: "Expand sidebar", icon: <PanelLeftIcon />, onSelect: toggleSidebar },
    {
      label: "New thread",
      icon: <SquarePenIcon />,
      onSelect: () => openCommandPalette({ open: "new-thread-in" }),
    },
    {
      label: "Add project",
      icon: <FolderPlusIcon />,
      onSelect: () => openCommandPalette({ open: "add-project" }),
    },
    { label: "Search", icon: <SearchIcon />, onSelect: () => openCommandPalette() },
  ];
  const secondary: NavItem[] = [
    ...(pullRequestsSupported
      ? [
          {
            label: "Pull Requests",
            icon: <PullRequestGlyph.pullRequest />,
            onSelect: () =>
              void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() }),
          },
        ]
      : []),
    {
      label: "Usage",
      icon: <ChartNoAxesColumnIcon />,
      onSelect: () => void navigate({ to: "/usage" }),
    },
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
            {primary.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
          </SidebarMenu>
          <div className="my-1 h-px w-6 shrink-0 bg-sidebar-border" />
          <SidebarMenu className="items-center">
            {secondary.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="items-center">
          <SidebarMenu className="items-center">
            <RailUndoItem />
            <RailItem
              item={{
                label: "Settings",
                icon: <SettingsIcon />,
                onSelect: () => void navigate({ to: "/settings" }),
              }}
            />
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </>
  );
}
