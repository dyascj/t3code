import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveRestoreIcon,
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
import { useEnvironments } from "../../state/environments";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { SettledThreads } from "./SettledThreads";
import { SidebarChromeHeader } from "./SidebarChrome";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";

/*
 * Threads live in the title bar tabs, so the sidebar is navigation only: a
 * 48px icon rail when collapsed, the same places with labels when expanded.
 */

interface NavItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

const SETTLED_LABEL = "Settled";
const settledIcon = <ArchiveRestoreIcon />;

function useNavItems() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  // One connected server offering pull requests is enough for the page to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const primary: NavItem[] = [
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
  const settings: NavItem = {
    label: "Settings",
    icon: <SettingsIcon />,
    onSelect: () => void navigate({ to: "/settings" }),
  };
  return { primary, secondary, settings };
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

/** The rail's stand-in for the expanded sidebar's undo notice, after a tab close settles a thread. */
function RailUndoItem() {
  const notice = useThreadUndoNotice((state) => state.notice);
  if (!notice) return null;
  const label = `${notice.action} ${notice.count} thread${notice.count === 1 ? "" : "s"}, undo`;
  return <RailItem item={{ label, icon: <Undo2Icon />, onSelect: undoLatestThreadAction }} />;
}

/** The collapsed sidebar: an icon rail under the title bar. */
export function SidebarIconRail() {
  const { toggleSidebar } = useSidebar();
  const { primary, secondary, settings } = useNavItems();
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
              item={{ label: "Expand sidebar", icon: <PanelLeftIcon />, onSelect: toggleSidebar }}
            />
            {primary.map((item) => (
              <RailItem key={item.label} item={item} />
            ))}
            <SidebarMenuItem>
              <SettledThreads
                trigger={
                  <SidebarMenuButton size="icon" tooltip={SETTLED_LABEL} aria-label={SETTLED_LABEL}>
                    {settledIcon}
                  </SidebarMenuButton>
                }
              />
            </SidebarMenuItem>
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
            <RailItem item={settings} />
          </SidebarMenu>
        </SidebarFooter>
      </div>
    </>
  );
}

/** The expanded sidebar: the rail's places with labels, and the usual footer. */
export function SidebarNavPanel() {
  const { primary, secondary, settings } = useNavItems();
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {primary.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton onClick={item.onSelect}>
                  {item.icon}
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            <SidebarMenuItem>
              <SettledThreads
                trigger={
                  <SidebarMenuButton>
                    {settledIcon}
                    <span>{SETTLED_LABEL}</span>
                  </SidebarMenuButton>
                }
              />
            </SidebarMenuItem>
            {secondary.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton onClick={item.onSelect}>
                  {item.icon}
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarThreadUndoNotice />
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
        <SidebarUpdatePill />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={settings.onSelect}>
              {settings.icon}
              <span>{settings.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
