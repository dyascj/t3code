// The effect caches, here and in the worker, key entries `${sourceKey}:${effect}:${theme}`
// or by the bare sourceKey. They keep the sources used most recently: a revision number
// says nothing about use, and the background being flipped back to is often the oldest.

/** Sources kept: three backgrounds plus a project's own, so flipping among them is instant. */
const MAX_RECENT_SOURCES = 4;

const sourceOf = (key: string) => key.split(":")[0]!;

/** Reads an entry and marks it as just used. */
export function touch<V>(map: Map<string, V>, key: string): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

/** Drops every entry of all but the most recently used sources; a Map iterates oldest first. */
export function pruneToRecentSources(map: Map<string, unknown>, max = MAX_RECENT_SOURCES) {
  const keep = new Set<string>();
  for (const key of [...map.keys()].reverse()) {
    if (keep.size === max) break;
    keep.add(sourceOf(key));
  }
  for (const key of map.keys()) {
    if (!keep.has(sourceOf(key))) map.delete(key);
  }
}
