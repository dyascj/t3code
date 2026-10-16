/**
 * The sidebar header, top to bottom: search, the project filter, new thread,
 * add project, then the pages the sidebar opens. The collapsed rail shows the
 * same entries as icons, in the same order.
 *
 * The scope picker itself is passed in: its combobox state lives with the rest
 * of the sidebar's scope logic. `searchFieldRef` lands on the search field so
 * the picker's popup can anchor to that width.
 */
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { useSidebarPageLinks } from "./SidebarChrome";

export interface SidebarThreadHeaderProps {
  /** Lands on the search field so a popup can anchor to its width. */
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  /** The project scope combobox, rendered as the row under search. */
  projectScope: ReactNode;
  onNewProject: () => void;
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  searchFieldRef,
  projectScope,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const pageLinks = useSidebarPageLinks();

  return (
    <div className="flex flex-col gap-px">
      <div
        ref={searchFieldRef}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search"
          aria-label="Search threads"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label="Clear thread search"
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      {projectScope}
      <SidebarHeaderRow
        label="New thread"
        trailing={newThreadShortcutLabel}
        title={
          showNewThreadInProjectHint
            ? `Shift+click: new thread in the current project${newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}`
            : undefined
        }
        disabled={newThreadDisabled}
        onClick={onNewThread}
      >
        <SquarePenIcon />
      </SidebarHeaderRow>
      <SidebarHeaderRow label="Add project" onClick={onNewProject}>
        <FolderPlusIcon />
      </SidebarHeaderRow>
      <div aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />
      {pageLinks.map((link) => (
        <SidebarHeaderRow
          key={link.label}
          label={link.label}
          isActive={link.active}
          onClick={link.onSelect}
        >
          {link.icon}
        </SidebarHeaderRow>
      ))}
    </div>
  );
}

/**
 * One labeled row of the header. Spreads unknown props through so it can
 * serve as a popup trigger's render target; children are the leading icon.
 */
export function SidebarHeaderRow({
  label,
  trailing,
  children,
  ...rest
}: {
  label: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentProps<typeof SidebarMenuButton>, "children" | "className" | "tooltip">) {
  return (
    <SidebarMenuButton type="button" {...rest}>
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? (
        <span className="shrink-0 text-2xs text-muted-foreground/70">{trailing}</span>
      ) : null}
    </SidebarMenuButton>
  );
}
