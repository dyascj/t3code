import { useCallback, useEffect, useState } from "react";

import {
  getGlassState,
  isDarkScheme,
  LUMINANCE_GRID_SIZE,
  subscribeGlassState,
  subscribeScheme,
} from "./glassAppearance";

/*
 * Adaptive ink, the way Apple's adaptive text works: each element drawn on the
 * global artwork samples the art actually behind it and flips to dark or light
 * ink when the theme's own ink would not read. The image is reduced once to a
 * small luminance grid; sampling maps an element's box through the same cover
 * and focal framing the CSS uses.
 */

const encode = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
const decode = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

/** Mean luminance of the grid over a box in image fractions (0 to 1). */
export function sampleLuminance(
  grid: Float32Array,
  box: { left: number; top: number; right: number; bottom: number },
): number {
  const size = LUMINANCE_GRID_SIZE;
  const toCell = (value: number) => Math.min(size - 1, Math.max(0, Math.floor(value * size)));
  let total = 0;
  let count = 0;
  for (let y = toCell(box.top); y <= toCell(box.bottom); y += 1) {
    for (let x = toCell(box.left); x <= toCell(box.right); x += 1) {
      total += grid[y * size + x]!;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

/** Piecewise-linear lookup over [position, value] stops, positions ascending. */
function interpolate(stops: ReadonlyArray<readonly [number, number]>, at: number) {
  if (at <= stops[0]![0]) return stops[0]![1];
  for (let index = 1; index < stops.length; index += 1) {
    const [position, value] = stops[index]!;
    const [previousPosition, previousValue] = stops[index - 1]!;
    if (at <= position) {
      return (
        previousValue +
        ((value - previousValue) * (at - previousPosition)) / (position - previousPosition)
      );
    }
  }
  return stops.at(-1)![1];
}

/**
 * How much of the artwork shows at a height in the Haze frame (0 top, 1 bottom):
 * the layer's mask times what its darkening overlay leaves. Mirrors the
 * .gradient-blur-background stops in index.css.
 */
export function hazeArtWeight(at: number, session: boolean): number {
  const mask = session
    ? interpolate(
        [
          [0.18, 1],
          [0.76, 0],
        ],
        at,
      )
    : interpolate(
        [
          [0.19, 1],
          [0.3, 0.94],
          [0.42, 0.72],
          [0.54, 0.42],
          [0.66, 0.16],
          [0.78, 0.04],
          [0.9, 0],
        ],
        at,
      );
  const overlay = session
    ? interpolate(
        [
          [0.15, 0],
          [0.76, 0.7],
        ],
        at,
      )
    : interpolate(
        [
          [0.16, 0],
          [0.38, 0.26],
          [0.55, 0.55],
          [0.75, 0.78],
        ],
        at,
      );
  return mask * (1 - overlay);
}

/** The luminance actually seen where art of a luminance shows at a strength over the canvas. */
export function seenLuminance(input: {
  imageLuminance: number;
  opacity: number;
  dark: boolean;
}): number {
  // Compositing blends sRGB-encoded values, so blend there and decode after.
  const canvas = encode(input.dark ? 0.01 : 0.9);
  return decode(canvas + (encode(input.imageLuminance) - canvas) * input.opacity);
}

const DARK_INK = 0.025;
const LIGHT_INK = 0.93;
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The ink whose worst spot reads best across what is seen behind an element,
 * so one bright or dark patch under part of a label decides for the whole.
 */
export function chooseInk(seen: readonly number[]): "dark" | "light" {
  const worst = (ink: number) => Math.min(...seen.map((value) => contrast(ink, value)));
  return worst(DARK_INK) > worst(LIGHT_INK) ? "dark" : "light";
}

/** The chat pane carrying the artwork, for elements drawn over it. */
export const findChatPane = () => document.querySelector<HTMLElement>(".chat-pane-background");

/** The art frame for a chat pane: the pane itself, which both art layers cover. */
const artFrameRect = (pane: HTMLElement) => pane.getBoundingClientRect();

const INK_SLICES = 6;

/** The ink for an element over the global artwork in a chat pane, or null with no art behind it. */
function resolveInk(element: HTMLElement, pane: HTMLElement | null): "dark" | "light" | null {
  const { imageLuminanceGrid, imageAspect, appearance, imageUrl } = getGlassState();
  if (!pane || !imageUrl || !imageLuminanceGrid || !imageAspect) return null;
  // A project's own image is not the one sampled here.
  if (pane.dataset.projectChatBackground === "true") return null;
  const session = pane.dataset.sessionEmpty === "false";
  const opacity = session ? appearance.backgroundSessionOpacity : appearance.backgroundEmptyOpacity;
  if (session && appearance.backgroundScope === "empty") return null;
  const frame = artFrameRect(pane);
  const box = element.getBoundingClientRect();
  if (frame.width === 0 || frame.height === 0 || box.width === 0) return null;

  // Map the element's box into image fractions through the cover framing.
  const imageWidth = Math.max(frame.width, frame.height * imageAspect);
  const imageHeight = imageWidth / imageAspect;
  const [positionX, positionY] = getComputedStyle(pane)
    .getPropertyValue("--chat-background-position")
    .trim()
    .split(/\s+/)
    .map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : 0.5));
  const imageLeft = frame.left + (frame.width - imageWidth) * (positionX ?? 0.5);
  const imageTop = frame.top + (frame.height - imageHeight) * (positionY ?? 0.5);
  const middle = (box.top + box.height / 2 - frame.top) / frame.height;
  // Blur keeps the art at full strength; the fading styles take it away down the frame.
  const weight =
    appearance.haze && appearance.hazeStyle !== "blur" ? hazeArtWeight(middle, session) : 1;
  const dark = isDarkScheme();
  // Slices across the element, so a label over a dark patch is not averaged away.
  const seen = Array.from({ length: INK_SLICES }, (_, slice) => {
    const left = box.left + (box.width * slice) / INK_SLICES;
    const right = box.left + (box.width * (slice + 1)) / INK_SLICES;
    const imageLuminance = sampleLuminance(imageLuminanceGrid, {
      left: (left - imageLeft) / imageWidth,
      right: (right - imageLeft) / imageWidth,
      top: (box.top - imageTop) / imageHeight,
      bottom: (box.bottom - imageTop) / imageHeight,
    });
    return seenLuminance({ imageLuminance, opacity: opacity * weight, dark });
  });
  return chooseInk(seen);
}

/**
 * A callback ref that keeps data-art-ink on an element drawn over a chat pane's
 * artwork. `pane` finds the pane at update time; `dependency` re-runs it when
 * the layout behind the element changes (a route, the draft state).
 */
export function useArtInkRef(pane: () => HTMLElement | null, dependency: unknown) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    let frameRequest = 0;
    const update = () => {
      cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(() => {
        const ink = resolveInk(element, pane());
        if (ink) element.dataset.artInk = ink;
        else delete element.dataset.artInk;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const paneElement = pane();
    if (paneElement) observer.observe(paneElement);
    const unsubscribeGlass = subscribeGlassState(update);
    const unsubscribeScheme = subscribeScheme(update);
    return () => {
      cancelAnimationFrame(frameRequest);
      observer.disconnect();
      unsubscribeGlass();
      unsubscribeScheme();
      delete element.dataset.artInk;
    };
    // `pane` is read fresh on every update; `dependency` marks when to re-run.
  }, [element, pane, dependency]);
  return useCallback((node: HTMLElement | null) => setElement(node), []);
}
