import { useEffect, useRef, useSyncExternalStore } from "react";

import { ASCII_OCEAN_FONT, startAsciiOcean } from "./asciiOcean";
import { ASCII_BACKGROUND_SLOT, getGlassState, subscribeGlassState } from "./glassAppearance";
import fontUrl from "./thmanyahSerifTextMedium.woff2?url";

let fontAdded = false;

/** Background 0: the animated ASCII ocean, behind the chat pane while it's the one showing. */
export function AsciiOceanBackground() {
  const showing = useSyncExternalStore(
    subscribeGlassState,
    () => getGlassState().backgroundSlot === ASCII_BACKGROUND_SLOT,
    () => false,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the ASCII ocean animation on the canvas while it is the showing background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!showing || !canvas) return;
    if (!fontAdded) {
      fontAdded = true;
      document.fonts.add(new FontFace("Thmanyah Serif Text", `url(${fontUrl})`, { weight: "500" }));
    }
    return startAsciiOcean(canvas);
  }, [showing]);

  if (!showing) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="ascii-ocean-background"
      style={{ fontFamily: ASCII_OCEAN_FONT }}
    />
  );
}
