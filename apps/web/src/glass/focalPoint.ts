import { useCallback, useEffect, useState } from "react";

import { getGlassState, showingBackgroundFocus, subscribeGlassState } from "./glassAppearance";

/**
 * The cover background-position that brings a focal point (percent of the
 * image) as close to the frame's center as the image allows. Plain percentages
 * would line the image's 80% point up with the frame's 80% point instead, so
 * the chosen spot never moves toward the middle.
 */
export function focalBackgroundPosition(
  focus: { readonly x: number; readonly y: number },
  imageAspect: number,
  frameWidth: number,
  frameHeight: number,
): string {
  const frameAspect = frameWidth / frameHeight;
  // How much wider (or taller) the covering image is than the frame.
  const overflowX = Math.max(1, imageAspect / frameAspect);
  const overflowY = Math.max(1, frameAspect / imageAspect);
  const axis = (focusPercent: number, overflow: number) => {
    if (overflow <= 1.0001) return 50;
    const offset = ((focusPercent / 100) * overflow - 0.5) / (overflow - 1);
    return Math.round(Math.min(1, Math.max(0, offset)) * 1000) / 10;
  };
  return `${axis(focus.x, overflowX)}% ${axis(focus.y, overflowY)}%`;
}

/**
 * A callback ref for an element that shows the global background. It keeps the
 * element's --chat-background-position on the focal point as the element
 * resizes. Disabled elements keep whatever position they inherit.
 */
export function useFocalBackgroundRef(enabled = true) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element || !enabled) return;
    let written: string | null = null;
    const update = () => {
      const glass = getGlassState();
      const { imageAspect } = glass;
      const { width, height } = element.getBoundingClientRect();
      if (imageAspect === null || width === 0 || height === 0) return;
      written = focalBackgroundPosition(showingBackgroundFocus(glass), imageAspect, width, height);
      element.style.setProperty("--chat-background-position", written);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const unsubscribe = subscribeGlassState(update);
    return () => {
      observer.disconnect();
      unsubscribe();
      // React may have written its own position (a project image's center) since.
      if (element.style.getPropertyValue("--chat-background-position") === written) {
        element.style.removeProperty("--chat-background-position");
      }
    };
  }, [element, enabled]);
  return useCallback((node: HTMLElement | null) => setElement(node), []);
}
