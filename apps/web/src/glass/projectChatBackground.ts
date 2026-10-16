import { type CSSProperties, useEffect, useState, useSyncExternalStore } from "react";

import { prepareBackgroundEffect } from "./backgroundEffects";
import { useFocalBackgroundRef } from "./focalPoint";
import {
  type BackgroundEffect,
  type ChatBackgroundScope,
  clampBackgroundOpacity,
  getGlassState,
  isChatBackgroundScope,
  isDarkScheme,
  normalizeEffectAndHaze,
  subscribeScheme,
} from "./glassAppearance";
import { deleteImage, readImage, writeImage } from "./imageStore";

/*
 * Per-project chat backgrounds. A project with an image
 * overrides the global background on its chat panes; without one it follows
 * the global Appearance setting. Keyed by logical project key, device-local.
 */

export interface ProjectChatBackgroundSettings {
  readonly emptyOpacity: number;
  readonly sessionOpacity: number;
  readonly scope: ChatBackgroundScope;
  readonly effect: BackgroundEffect;
  readonly haze: boolean;
}

const STORAGE_KEY = "t3code:project-chat-backgrounds:v1";
const imageKey = (projectKey: string) => `project:${projectKey}`;

type ImageEntry = { readonly url: string; readonly revision: number } | "loading" | "missing";

let stored: Record<string, ProjectChatBackgroundSettings> = readStored();
const images = new Map<string, ImageEntry>();
let version = 0;
let imageRevision = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalize(raw: unknown): ProjectChatBackgroundSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const global = getGlassState().appearance;
  const { effect, haze } = normalizeEffectAndHaze(
    { effect: input.effect, haze: input.haze, hazeDither: global.backgroundEffect === "dither" },
    { effect: "none", haze: false },
  );
  return {
    emptyOpacity: clampBackgroundOpacity(input.emptyOpacity, global.backgroundEmptyOpacity),
    sessionOpacity: clampBackgroundOpacity(input.sessionOpacity, global.backgroundSessionOpacity),
    scope: isChatBackgroundScope(input.scope) ? input.scope : global.backgroundScope,
    effect,
    haze,
  };
}

function readStored(): Record<string, ProjectChatBackgroundSettings> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, ProjectChatBackgroundSettings> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const settings = normalize(value);
      if (settings) result[key] = settings;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStored(next: Record<string, ProjectChatBackgroundSettings>) {
  stored = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or quota: the change still applies for this session.
  }
  notify();
}

/** Defaults for a project that has no image yet: the global look. */
export function defaultProjectChatBackgroundSettings(): ProjectChatBackgroundSettings {
  const global = getGlassState().appearance;
  return {
    emptyOpacity: global.backgroundEmptyOpacity,
    sessionOpacity: global.backgroundSessionOpacity,
    scope: global.backgroundScope,
    effect: "none",
    haze: false,
  };
}

export function updateProjectChatBackgroundSettings(
  projectKey: string,
  patch: Partial<ProjectChatBackgroundSettings>,
) {
  const current = stored[projectKey];
  if (!current) return;
  const next = normalize({ ...current, ...patch });
  if (next) writeStored({ ...stored, [projectKey]: next });
}

export async function setProjectChatBackgroundImage(
  projectKey: string,
  file: Blob,
  settings: ProjectChatBackgroundSettings,
): Promise<void> {
  await writeImage(imageKey(projectKey), file);
  const previous = images.get(projectKey);
  if (typeof previous === "object") URL.revokeObjectURL(previous.url);
  imageRevision += 1;
  images.set(projectKey, { url: URL.createObjectURL(file), revision: imageRevision });
  writeStored({ ...stored, [projectKey]: normalize(settings) ?? settings });
}

export async function removeProjectChatBackground(projectKey: string): Promise<void> {
  await deleteImage(imageKey(projectKey));
  const previous = images.get(projectKey);
  if (typeof previous === "object") URL.revokeObjectURL(previous.url);
  images.set(projectKey, "missing");
  const { [projectKey]: _removed, ...rest } = stored;
  writeStored(rest);
}

function ensureImage(projectKey: string) {
  if (images.has(projectKey)) return;
  images.set(projectKey, "loading");
  readImage(imageKey(projectKey))
    .then((blob) => {
      if (images.get(projectKey) !== "loading") return;
      imageRevision += 1;
      images.set(
        projectKey,
        blob ? { url: URL.createObjectURL(blob), revision: imageRevision } : "missing",
      );
      notify();
    })
    .catch((error: unknown) => {
      images.set(projectKey, "missing");
      console.error("Could not load the project chat background.", error);
      notify();
    });
}

export const projectBackgroundSourceKey = (revision: number) => `project-background?v=${revision}`;

export interface ProjectChatBackground {
  readonly settings: ProjectChatBackgroundSettings;
  /** Raw image URL, before any effect. */
  readonly src: string;
  readonly revision: number;
}

/** The project's own background, or null when it follows the global one. */
export function useProjectChatBackground(
  projectKey: string | null | undefined,
): ProjectChatBackground | null {
  useSyncExternalStore(subscribe, () => version);
  if (!projectKey) return null;
  const settings = stored[projectKey];
  if (!settings) return null;
  ensureImage(projectKey);
  const image = images.get(projectKey);
  if (typeof image !== "object") return null;
  return { settings, src: image.url, revision: image.revision };
}

/**
 * Returns a pane-local image URL with the effect applied, leaving the global
 * background untouched. `sourceKey` names the source image for the effect
 * caches and must change whenever the image does.
 */
export function useBackgroundEffectUrl(
  src: string | null,
  effect: BackgroundEffect,
  sourceKey: string,
): string | null {
  const light = !useSyncExternalStore(subscribeScheme, isDarkScheme, () => true);
  const themeKey = effect === "dither" || effect === "none" ? false : light;
  const key = src ? `${sourceKey}:${effect}:${themeKey}` : null;
  const [prepared, setPrepared] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!src || effect === "none" || !key) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void prepareBackgroundEffect(sourceKey, src, effect, themeKey)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPrepared({ key, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setPrepared({ key, url: src });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceKey, src, effect, themeKey, key]);

  if (!src || effect === "none") return src;
  return prepared?.key === key ? prepared.url : null;
}

/**
 * Attributes for the chat pane that carries the background: the project's
 * own image and strengths when it has one, otherwise the global background
 * applies through the root classes.
 */
export function useChatBackgroundSurface(projectKey: string | null | undefined) {
  const background = useProjectChatBackground(projectKey);
  // The global image follows its focal point; a project's own image stays centered.
  const ref = useFocalBackgroundRef(background === null);
  const url = useBackgroundEffectUrl(
    background?.src ?? null,
    background?.settings.effect ?? "none",
    projectBackgroundSourceKey(background?.revision ?? 0),
  );
  return {
    ref,
    "data-project-chat-background": background ? "true" : "false",
    "data-project-background-haze": background?.settings.haze ? "true" : undefined,
    "data-project-background-scope": background?.settings.scope,
    style: background
      ? ({
          "--chat-background-image": url ? `url(${JSON.stringify(url)})` : "none",
          "--chat-background-empty-opacity": String(background.settings.emptyOpacity),
          "--chat-background-session-opacity": String(background.settings.sessionOpacity),
          "--chat-background-position": "center",
        } as CSSProperties)
      : undefined,
  };
}
