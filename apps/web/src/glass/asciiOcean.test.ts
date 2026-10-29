import { describe, expect, it } from "vite-plus/test";

import { World } from "./asciiOcean";

describe("ASCII ocean", () => {
  it("stretches the scene to fill a pane that grows after it started", () => {
    const world = new World([{ kind: "classic", size: 1 }], 120);
    world.resize(400, 300, 8, 12);
    for (let i = 0; i < 120; i++) world.step(1 / 60);
    const [shark] = world.sharks;
    const orbit = shark!.orbitRadius;

    world.resize(1600, 1200, 13, 19);
    expect(shark!.orbitRadius).toBeCloseTo(orbit * 4);
    expect(shark!.length).toBe(430); // the cap, at 0.44 of the short side
    // The fish spread over the new area instead of staying in the old corner.
    expect(Math.max(...world.fish.map((f) => f.x))).toBeGreaterThan(400);
    expect(Math.max(...world.fish.map((f) => f.y))).toBeGreaterThan(300);
  });
});
