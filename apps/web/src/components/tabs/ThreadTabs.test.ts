import { describe, expect, it } from "vite-plus/test";

import { neighborKey } from "./ThreadTabs";

describe("neighborKey", () => {
  it("prefers the tab to the left, then the right", () => {
    expect(neighborKey(["a", "b", "c"], "b")).toBe("a");
    expect(neighborKey(["a", "b", "c"], "a")).toBe("b");
    expect(neighborKey(["a"], "a")).toBeNull();
    expect(neighborKey(["a"], "z")).toBeNull();
  });
});
