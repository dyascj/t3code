import { describe, expect, it } from "vite-plus/test";

import { chooseInk, hazeArtWeight, sampleLuminance, seenLuminance } from "./artInk";
import { LUMINANCE_GRID_SIZE } from "./glassAppearance";

describe("chooseInk", () => {
  const seen = (imageLuminance: number, opacity: number, dark: boolean) =>
    seenLuminance({ imageLuminance, opacity, dark });

  it("keeps light ink over dark mode art that shows faintly, and flips over strong bright art", () => {
    expect(chooseInk([seen(0.7, 0.24, true)])).toBe("light");
    expect(chooseInk([seen(0.7, 0.65, true)])).toBe("dark");
  });

  it("lets the darkest patch under a label keep it light", () => {
    expect(chooseInk([seen(0.7, 0.65, true), seen(0.01, 0.65, true)])).toBe("light");
  });

  it("flips light mode text to light ink over strong dark art", () => {
    expect(chooseInk([seen(0.02, 0.65, false)])).toBe("light");
    expect(chooseInk([seen(0.7, 0.65, false)])).toBe("dark");
  });
});

describe("hazeArtWeight", () => {
  it("shows the art fully at the top and fades it out toward the bottom", () => {
    expect(hazeArtWeight(0.05, false)).toBe(1);
    expect(hazeArtWeight(0.5, false)).toBeLessThan(0.3);
    expect(hazeArtWeight(0.95, false)).toBe(0);
    expect(hazeArtWeight(0.9, true)).toBe(0);
  });
});

describe("sampleLuminance", () => {
  it("averages only the cells under the box", () => {
    const size = LUMINANCE_GRID_SIZE;
    // Left half bright, right half dark.
    const grid = new Float32Array(size * size).map((_, cell) => (cell % size < size / 2 ? 1 : 0));
    expect(sampleLuminance(grid, { left: 0, right: 0.4, top: 0, bottom: 1 })).toBe(1);
    expect(sampleLuminance(grid, { left: 0.6, right: 1, top: 0, bottom: 1 })).toBe(0);
  });
});
