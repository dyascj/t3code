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
      backgroundFocus: [{ x: -20, y: 33.4 }, { x: 140 }],
    });
    expect(normalized).toMatchObject({
      hue: 360,
      saturation: 0,
      darkLightness: 30,
      sidebarOpacity: 0.15,
      blurRadius: 13,
      backgroundEmptyOpacity: 0.65,
      backgroundSessionOpacity: 0.05,
      backgroundFocus: [
        { x: 0, y: 33 },
        { x: 100, y: 50 },
        { x: 50, y: 50 },
      ],
    });
  });

  it("starts every slot from the old shared focal point", () => {
    expect(
      normalizeGlassAppearance({ backgroundFocusX: 20, backgroundFocusY: 70 }).backgroundFocus,
    ).toEqual([
      { x: 20, y: 70 },
      { x: 20, y: 70 },
      { x: 20, y: 70 },
    ]);
  });

  it("turns the old Haze effect into the haze switch over its art", () => {
    expect(normalizeGlassAppearance({ backgroundEffect: "gradient-blur" })).toMatchObject({
      backgroundEffect: "dither",
      haze: true,
      hazeStyle: "fade-blur",
    });
    expect(
      normalizeGlassAppearance({ backgroundEffect: "gradient-blur", hazeDither: false }),
    ).toMatchObject({ backgroundEffect: "none", haze: true });
    expect(normalizeGlassAppearance({ backgroundEffect: "ascii" })).toMatchObject({
      backgroundEffect: "ascii",
      haze: false,
    });
    expect(
      normalizeGlassAppearance({ backgroundEffect: "halftone", haze: true, hazeStyle: "blur" }),
    ).toMatchObject({ backgroundEffect: "halftone", haze: true, hazeStyle: "blur" });
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
      backgroundEffect: "dither",
      haze: true,
    });
  });
});
