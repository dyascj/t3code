import { describe, expect, it } from "vite-plus/test";

import {
  adoptDefaults,
  DEFAULT_GLASS_APPEARANCE,
  normalizeGlassAppearance,
} from "./glassAppearance";

describe("normalizeGlassAppearance", () => {
  it("falls back to defaults for missing or corrupt storage", () => {
    expect(normalizeGlassAppearance(null)).toEqual(DEFAULT_GLASS_APPEARANCE);
    expect(normalizeGlassAppearance({ hue: "red", backgroundEffect: "sparkles" })).toEqual(
      DEFAULT_GLASS_APPEARANCE,
    );
  });

  it("clamps every slider to its range and rounds the blur radius", () => {
    const normalized = normalizeGlassAppearance({
      hue: 999,
      saturation: -5,
      darkLightness: 80,
      sidebarOpacity: 0,
      blurRadius: 12.6,
      backgroundEmptyOpacity: 1,
      backgroundSessionOpacity: 0,
      backgroundFocusX: -20,
      backgroundFocusY: 33.4,
    });
    expect(normalized).toMatchObject({
      hue: 360,
      saturation: 0,
      darkLightness: 30,
      sidebarOpacity: 0.15,
      blurRadius: 13,
      backgroundEmptyOpacity: 0.65,
      backgroundSessionOpacity: 0.05,
      backgroundFocusX: 0,
      backgroundFocusY: 33,
    });
  });

  it("keeps valid choices", () => {
    expect(
      normalizeGlassAppearance({
        mainPaneGlass: false,
        backgroundEffect: "halftone",
        backgroundScope: "empty",
      }),
    ).toMatchObject({
      mainPaneGlass: false,
      backgroundEffect: "halftone",
      backgroundScope: "empty",
    });
  });
});

describe("adoptDefaults", () => {
  it("moves the adopted keys to the new defaults and keeps the rest", () => {
    const adopted = adoptDefaults({ hue: 30, sidebarOpacity: 0.9, blurRadius: 40 });
    expect(adopted).toMatchObject({
      hue: 30,
      sidebarOpacity: DEFAULT_GLASS_APPEARANCE.sidebarOpacity,
      blurRadius: DEFAULT_GLASS_APPEARANCE.blurRadius,
      backgroundEffect: "gradient-blur",
    });
  });
});
