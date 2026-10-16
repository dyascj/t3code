import {
  applyPreparedBackground,
  clearPreparedBackground,
  pixelEffectOf,
  prepareBackgroundEffect,
  type BackgroundEffect,
} from "./backgroundEffects";
import { deleteImage, readImage, writeImage } from "./imageStore";

/*
 * Color, translucency, and chat background settings.
 * Everything here is device-local: settings live in localStorage and images
 * live in IndexedDB, so nothing crosses the wire.
 */

export type { BackgroundEffect };
export type ChatBackgroundScope = "empty" | "all";

export interface GlassAppearance {
  readonly hue: number;
  readonly saturation: number;
  readonly darkLightness: number;
  readonly sidebarOpacity: number;
  readonly blurRadius: number;
  readonly mainPaneGlass: boolean;
  readonly backgroundEffect: BackgroundEffect;
  /** Haze blurs a dithered render of the artwork instead of the original. */
  readonly hazeDither: boolean;
  readonly backgroundScope: ChatBackgroundScope;
  readonly backgroundEmptyOpacity: number;
  readonly backgroundSessionOpacity: number;
  /** The global image's focal point, in percent from its left and top edges. */
  readonly backgroundFocusX: number;
  readonly backgroundFocusY: number;
}

export const GLASS_LIMITS = {
  hue: { min: 0, max: 360 },
  saturation: { min: 0, max: 100 },
  darkLightness: { min: 0, max: 30 },
  sidebarOpacity: { min: 0.15, max: 1 },
  blurRadius: { min: 1, max: 64 },
  backgroundOpacity: { min: 0.05, max: 0.65 },
  backgroundFocus: { min: 0, max: 100 },
} as const;

export const DEFAULT_GLASS_APPEARANCE: GlassAppearance = {
  hue: 240,
  saturation: 0,
  darkLightness: 0,
  sidebarOpacity: 0.44,
  blurRadius: 23,
  mainPaneGlass: true,
  backgroundEffect: "gradient-blur",
  hazeDither: true,
  backgroundScope: "all",
  backgroundEmptyOpacity: 0.24,
  backgroundSessionOpacity: 0.24,
  backgroundFocusX: 50,
  backgroundFocusY: 50,
};

export const BACKGROUND_EFFECTS: readonly BackgroundEffect[] = [
  "none",
  "dither",
  "ascii",
  "halftone",
  "scanlines",
  "gradient-blur",
];

export const BACKGROUND_EFFECT_LABELS: Record<BackgroundEffect, string> = {
  none: "None",
  dither: "Dither",
  ascii: "ASCII",
  halftone: "Halftone",
  scanlines: "Scanlines",
  "gradient-blur": "Haze",
};

export const BACKGROUND_EFFECT_DESCRIPTIONS: Record<BackgroundEffect, string> = {
  none: "Shows the original artwork.",
  dither: "Rebuilds the artwork with a dithered color palette.",
  ascii: "Recreates the artwork with colored characters on black.",
  halftone: "Recreates the artwork with colored print dots on black.",
  scanlines: "Adds a pronounced horizontal display-line texture.",
  "gradient-blur": "Blurs and fades the artwork into the background below.",
};

export function isBackgroundEffect(value: unknown): value is BackgroundEffect {
  return BACKGROUND_EFFECTS.includes(value as BackgroundEffect);
}

export function isChatBackgroundScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

const STORAGE_KEY = "t3code:glass-appearance:v1";
/** Names the global image in the effect caches, so every reader shares one render. */
export const globalBackgroundSourceKey = (revision: number) => `chat-background?v=${revision}`;
const IMAGE_KEY = "chat-background";

/*
 * Three global backgrounds. Slot 1 is the original image, slots 2 and 3 sit
 * beside it, and Mod+B steps 1, 2, 3 and round again. An empty slot shows no
 * background at all.
 */
export const BACKGROUND_SLOTS = [1, 2, 3] as const;
export type BackgroundSlot = (typeof BACKGROUND_SLOTS)[number];
const SLOT_KEY = "t3code:glass-background-slot:v1";
const slotImageKey = (slot: BackgroundSlot) => (slot === 1 ? IMAGE_KEY : `${IMAGE_KEY}-${slot}`);
const nextSlot = (slot: BackgroundSlot): BackgroundSlot =>
  BACKGROUND_SLOTS[slot % BACKGROUND_SLOTS.length]!;

export function isBackgroundSlot(value: unknown): value is BackgroundSlot {
  return BACKGROUND_SLOTS.includes(value as BackgroundSlot);
}

function readSlot(): BackgroundSlot {
  try {
    const stored = Number(localStorage.getItem(SLOT_KEY));
    return isBackgroundSlot(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

export const clampNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export function clampBackgroundOpacity(value: unknown, fallback: number): number {
  const { min, max } = GLASS_LIMITS.backgroundOpacity;
  return clampNumber(value, min, max, fallback);
}

export function normalizeGlassAppearance(raw: unknown): GlassAppearance {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_GLASS_APPEARANCE;
  const L = GLASS_LIMITS;
  return {
    hue: Math.round(clampNumber(input.hue, L.hue.min, L.hue.max, d.hue)),
    saturation: Math.round(
      clampNumber(input.saturation, L.saturation.min, L.saturation.max, d.saturation),
    ),
    darkLightness: Math.round(
      clampNumber(input.darkLightness, L.darkLightness.min, L.darkLightness.max, d.darkLightness),
    ),
    sidebarOpacity: clampNumber(
      input.sidebarOpacity,
      L.sidebarOpacity.min,
      L.sidebarOpacity.max,
      d.sidebarOpacity,
    ),
    blurRadius: Math.round(
      clampNumber(input.blurRadius, L.blurRadius.min, L.blurRadius.max, d.blurRadius),
    ),
    mainPaneGlass: typeof input.mainPaneGlass === "boolean" ? input.mainPaneGlass : d.mainPaneGlass,
    backgroundEffect: isBackgroundEffect(input.backgroundEffect)
      ? input.backgroundEffect
      : d.backgroundEffect,
    hazeDither: typeof input.hazeDither === "boolean" ? input.hazeDither : d.hazeDither,
    backgroundScope: isChatBackgroundScope(input.backgroundScope)
      ? input.backgroundScope
      : d.backgroundScope,
    backgroundEmptyOpacity: clampBackgroundOpacity(
      input.backgroundEmptyOpacity,
      d.backgroundEmptyOpacity,
    ),
    backgroundSessionOpacity: clampBackgroundOpacity(
      input.backgroundSessionOpacity,
      d.backgroundSessionOpacity,
    ),
    backgroundFocusX: Math.round(
      clampNumber(
        input.backgroundFocusX,
        L.backgroundFocus.min,
        L.backgroundFocus.max,
        d.backgroundFocusX,
      ),
    ),
    backgroundFocusY: Math.round(
      clampNumber(
        input.backgroundFocusY,
        L.backgroundFocus.min,
        L.backgroundFocus.max,
        d.backgroundFocusY,
      ),
    ),
  };
}

// The defaults changed to a deeper, clearer glass with Haze on. Once per device,
// stored settings adopt the new values for those keys, so an existing install
// picks them up; anything changed after that is kept.
const ADOPTED_DEFAULTS_KEY = "t3code:glass-appearance:adopted-defaults:v2";
const ADOPTED_DEFAULTS: Partial<GlassAppearance> = {
  darkLightness: DEFAULT_GLASS_APPEARANCE.darkLightness,
  sidebarOpacity: DEFAULT_GLASS_APPEARANCE.sidebarOpacity,
  blurRadius: DEFAULT_GLASS_APPEARANCE.blurRadius,
  mainPaneGlass: DEFAULT_GLASS_APPEARANCE.mainPaneGlass,
  backgroundEffect: DEFAULT_GLASS_APPEARANCE.backgroundEffect,
};

/** Stored settings with the adopted defaults applied over them; everything else kept. */
export function adoptDefaults(stored: unknown): GlassAppearance {
  return normalizeGlassAppearance({
    ...(typeof stored === "object" && stored !== null ? stored : {}),
    ...ADOPTED_DEFAULTS,
  });
}

function readStored(): GlassAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (localStorage.getItem(ADOPTED_DEFAULTS_KEY) !== null) {
      return normalizeGlassAppearance(stored);
    }
    const adopted = adoptDefaults(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(adopted));
    localStorage.setItem(ADOPTED_DEFAULTS_KEY, "1");
    return adopted;
  } catch {
    return DEFAULT_GLASS_APPEARANCE;
  }
}

// ── store ──────────────────────────────────────────────────────────────

export interface GlassState {
  readonly appearance: GlassAppearance;
  /** Object URL of the global background image, or null when none is set. */
  readonly imageUrl: string | null;
  /** Bumps whenever the global image changes, so effect caches key on it. */
  readonly imageRevision: number;
  /** Width over height of the global image, once it has been decoded. */
  readonly imageAspect: number | null;
  /** The image's luminance on a small grid, for the adaptive ink of text drawn on it. */
  readonly imageLuminanceGrid: Float32Array | null;
  /** Which of the two global backgrounds is showing, and is edited in settings. */
  readonly backgroundSlot: BackgroundSlot;
}

let state: GlassState = {
  appearance: DEFAULT_GLASS_APPEARANCE,
  imageUrl: null,
  imageRevision: 0,
  imageAspect: null,
  imageLuminanceGrid: null,
  backgroundSlot: 1,
};
const listeners = new Set<() => void>();

export function getGlassState(): GlassState {
  return state;
}

export function subscribeGlassState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: GlassState) {
  state = next;
  for (const listener of listeners) listener();
}

export const isDarkScheme = () => document.documentElement.classList.contains("dark");

/** For useSyncExternalStore: fires when the root's classes change, read isDarkScheme. */
export function subscribeScheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function renderBackground() {
  const root = document.documentElement;
  root.classList.toggle("has-chat-background", state.imageUrl !== null);
  if (state.imageUrl === null) {
    clearPreparedBackground();
    return;
  }
  void applyPreparedBackground(
    globalBackgroundSourceKey(state.imageRevision),
    state.imageUrl,
    state.appearance.backgroundEffect,
    !isDarkScheme(),
    state.appearance.hazeDither,
  );
}

export const LUMINANCE_GRID_SIZE = 32;

/** Linear relative luminance of an image on a LUMINANCE_GRID_SIZE square grid. */
export function luminanceGrid(bitmap: ImageBitmap): Float32Array | null {
  const size = LUMINANCE_GRID_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const grid = new Float32Array(size * size);
  for (let cell = 0; cell < grid.length; cell += 1) {
    const offset = cell * 4;
    grid[cell] =
      0.2126 * decodeChannel(pixels[offset]! / 255) +
      0.7152 * decodeChannel(pixels[offset + 1]! / 255) +
      0.0722 * decodeChannel(pixels[offset + 2]! / 255);
  }
  return grid;
}

const decodeChannel = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

let appliedBlurRadius: number | null = null;

function applyAppearance(previous: GlassAppearance | null) {
  const a = state.appearance;
  const style = document.documentElement.style;
  style.setProperty("--theme-hue", String(a.hue));
  style.setProperty("--theme-saturation", `${a.saturation}%`);
  style.setProperty("--theme-dark-lightness", `${a.darkLightness}%`);
  style.setProperty("--sidebar-opacity", String(a.sidebarOpacity));
  style.setProperty("--chat-background-empty-opacity", String(a.backgroundEmptyOpacity));
  style.setProperty("--chat-background-session-opacity", String(a.backgroundSessionOpacity));
  style.setProperty("--chat-background-position", `${a.backgroundFocusX}% ${a.backgroundFocusY}%`);
  const root = document.documentElement;
  root.classList.toggle("glass-body", a.mainPaneGlass);
  root.classList.toggle("chat-background-empty-only", a.backgroundScope === "empty");
  if (appliedBlurRadius !== a.blurRadius) {
    appliedBlurRadius = a.blurRadius;
    void window.desktopBridge?.setWindowBlurRadius?.(a.blurRadius);
  }
  if (
    previous === null ||
    previous.backgroundEffect !== a.backgroundEffect ||
    previous.hazeDither !== a.hazeDither
  )
    renderBackground();
}

export function updateGlassAppearance(patch: Partial<GlassAppearance>) {
  const previous = state.appearance;
  const appearance = normalizeGlassAppearance({ ...previous, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Private mode or quota: the change still applies for this session.
  }
  setState({ ...state, appearance });
  applyAppearance(previous);
}

export function resetGlassAppearance(keys: readonly (keyof GlassAppearance)[]) {
  const patch: Record<string, unknown> = {};
  for (const key of keys) patch[key] = DEFAULT_GLASS_APPEARANCE[key];
  updateGlassAppearance(patch as Partial<GlassAppearance>);
}

/*
 * Each slot keeps its object URL and revision while it lives, so flipping back
 * reuses the same effect render instead of redrawing it. A revision only
 * changes when that slot's image does.
 */
interface SlotImage {
  readonly url: string;
  readonly revision: number;
  aspect: number | null;
  luminanceGrid: Float32Array | null;
}
const slotImages = new Map<BackgroundSlot, SlotImage>();
const loadedSlots = new Set<BackgroundSlot>();
let lastRevision = 0;

function storeSlotImage(slot: BackgroundSlot, blob: Blob | null): SlotImage | null {
  const previous = slotImages.get(slot);
  if (previous) URL.revokeObjectURL(previous.url);
  slotImages.delete(slot);
  loadedSlots.add(slot);
  if (!blob) return null;
  const entry: SlotImage = {
    url: URL.createObjectURL(blob),
    revision: ++lastRevision,
    aspect: null,
    luminanceGrid: null,
  };
  slotImages.set(slot, entry);
  // The focal point math needs the image's shape; only the showing image updates state.
  void createImageBitmap(blob)
    .then((bitmap) => {
      entry.aspect = bitmap.width / bitmap.height;
      entry.luminanceGrid = luminanceGrid(bitmap);
      bitmap.close();
      if (state.imageRevision !== entry.revision) return;
      setState({ ...state, imageAspect: entry.aspect, imageLuminanceGrid: entry.luminanceGrid });
    })
    .catch(() => {});
  return entry;
}

function showImage(entry: SlotImage | null) {
  setState({
    ...state,
    imageUrl: entry?.url ?? null,
    imageRevision: entry?.revision ?? ++lastRevision,
    imageAspect: entry?.aspect ?? null,
    imageLuminanceGrid: entry?.luminanceGrid ?? null,
  });
  renderBackground();
}

async function loadSlot(slot: BackgroundSlot): Promise<SlotImage | null> {
  if (!loadedSlots.has(slot)) {
    const blob = await readImage(slotImageKey(slot));
    // A choice made while this read was in flight wins.
    if (!loadedSlots.has(slot)) storeSlotImage(slot, blob);
  }
  return slotImages.get(slot) ?? null;
}

/** Renders the next slot's effect ahead of time, so the next flip is instant. */
function prewarmSlot(slot: BackgroundSlot) {
  void loadSlot(slot)
    .then((entry) => {
      if (!entry) return;
      const effect = pixelEffectOf(state.appearance.backgroundEffect, state.appearance.hazeDither);
      if (effect === "none") return;
      return prepareBackgroundEffect(
        globalBackgroundSourceKey(entry.revision),
        entry.url,
        effect,
        !isDarkScheme(),
      );
    })
    .catch(() => {});
}

/** Sets the image of the slot that's showing. */
export async function setChatBackgroundImage(file: Blob): Promise<void> {
  const slot = state.backgroundSlot;
  await writeImage(slotImageKey(slot), file);
  const entry = storeSlotImage(slot, file);
  if (state.backgroundSlot === slot) showImage(entry);
}

/** Clears the image of the slot that's showing. */
export async function removeChatBackgroundImage(): Promise<void> {
  const slot = state.backgroundSlot;
  await deleteImage(slotImageKey(slot));
  storeSlotImage(slot, null);
  if (state.backgroundSlot === slot) showImage(null);
}

export async function setChatBackgroundSlot(slot: BackgroundSlot): Promise<void> {
  if (slot === state.backgroundSlot) return;
  try {
    localStorage.setItem(SLOT_KEY, String(slot));
  } catch {
    // Private mode or quota: the flip still applies for this session.
  }
  setState({ ...state, backgroundSlot: slot });
  const entry = await loadSlot(slot).catch((error: unknown) => {
    console.error("Could not load the chat background image.", error);
    return null;
  });
  if (state.backgroundSlot !== slot) return; // flipped again meanwhile
  showImage(entry);
  prewarmSlot(nextSlot(slot));
}

/** Mod+B: show the next background. */
export function flipChatBackground(): void {
  void setChatBackgroundSlot(nextSlot(state.backgroundSlot));
}

let initialized = false;

export function initGlassAppearance() {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  setState({ ...state, appearance: readStored(), backgroundSlot: readSlot() });
  applyAppearance(null);
  // Effects that draw on paper (ASCII, halftone, scanlines) follow light and
  // dark. Only a dark flip re-renders: renderBackground toggles root classes too.
  let dark = isDarkScheme();
  new MutationObserver(() => {
    if (dark === isDarkScheme()) return;
    dark = isDarkScheme();
    // Plain art and dither look the same in both schemes; re-rendering them only blinks the art.
    const pixelEffect = pixelEffectOf(
      state.appearance.backgroundEffect,
      state.appearance.hazeDither,
    );
    if (pixelEffect === "none" || pixelEffect === "dither") return;
    if (state.imageUrl !== null) renderBackground();
  }).observe(document.documentElement, { attributeFilter: ["class"] });
  const slot = state.backgroundSlot;
  loadSlot(slot)
    .then((entry) => {
      if (state.backgroundSlot !== slot) return;
      if (entry) showImage(entry);
      prewarmSlot(nextSlot(slot));
    })
    .catch((error: unknown) => {
      console.error("Could not load the chat background image.", error);
    });
}
