import { expect, it } from "vite-plus/test";

import { pruneToRecentSources, touch } from "./recentSources";

it("keeps the background just loaded again, even when its image is the oldest", () => {
  const sources = new Map<string, number>();
  for (const revision of [1, 5, 6, 7]) sources.set(`chat-background?v=${revision}`, revision);
  sources.set("chat-background?v=1:dither:false", 1);
  // Flipping back to slot 1 after uploads elsewhere: its revision is the lowest.
  touch(sources, "chat-background?v=1");
  sources.set("chat-background?v=8", 8);
  pruneToRecentSources(sources, 3);
  expect([...sources.keys()].toSorted()).toEqual([
    "chat-background?v=1",
    "chat-background?v=1:dither:false",
    "chat-background?v=7",
    "chat-background?v=8",
  ]);
});

it("tells a project image from a global one with the same revision", () => {
  const sources = new Map([
    ["chat-background?v=2", 0],
    ["project-background?v=2", 0],
  ]);
  pruneToRecentSources(sources, 1);
  expect([...sources.keys()]).toEqual(["project-background?v=2"]);
});
