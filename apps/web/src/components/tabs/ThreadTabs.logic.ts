/*
 * Pure rules behind the title bar tabs. Order and motion follow MonoCode's tab
 * strip: tabs keep the place you gave them, new ones join at the end, and a
 * closing tab holds its slot while it folds away.
 */

/** Saved order first, then tabs it has not seen yet, in their default order. */
export function orderTabKeys(saved: readonly string[], present: readonly string[]): string[] {
  const presentSet = new Set(present);
  const savedSet = new Set(saved);
  return [
    ...saved.filter((key) => presentSet.has(key)),
    ...present.filter((key) => !savedSet.has(key)),
  ];
}

/**
 * Writes a reordered visible strip back into the saved order. Visible keys
 * trade places among their own slots, so tabs hidden by the project filter
 * come back where they were.
 */
export function applyVisibleOrder(saved: readonly string[], visible: readonly string[]): string[] {
  const visibleSet = new Set(visible);
  let next = 0;
  return saved.map((key) => (visibleSet.has(key) ? visible[next++]! : key));
}

/** Moves the item at `from` to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The strip to render: the current keys, plus tabs that just closed, each
 * kept right after the tab that preceded it before it closed.
 */
export function mergeClosingKeys(
  previous: readonly string[],
  current: readonly string[],
  closing: ReadonlySet<string>,
): string[] {
  const merged = [...current];
  for (const key of previous) {
    if (!closing.has(key) || merged.includes(key)) continue;
    let at = 0;
    for (let index = previous.indexOf(key) - 1; index >= 0; index -= 1) {
      const anchor = merged.indexOf(previous[index]!);
      if (anchor >= 0) {
        at = anchor + 1;
        break;
      }
    }
    merged.splice(at, 0, key);
  }
  return merged;
}

/** The tab to show after closing one: the nearest to the left, else to the right. */
export function neighborKey(keys: readonly string[], closing: string): string | null {
  const index = keys.indexOf(closing);
  if (index === -1) return null;
  return keys[index - 1] ?? keys[index + 1] ?? null;
}

/** The tabs a "Close others / to the right / to the left" action takes. */
export function tabsToClose(
  keys: readonly string[],
  key: string,
  side: "others" | "left" | "right",
): string[] {
  const index = keys.indexOf(key);
  if (index < 0) return [];
  if (side === "left") return keys.slice(0, index);
  if (side === "right") return keys.slice(index + 1);
  return keys.filter((candidate) => candidate !== key);
}

/**
 * Rename commit rule: trim, reject empty (the caller toasts), and skip the
 * mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}
