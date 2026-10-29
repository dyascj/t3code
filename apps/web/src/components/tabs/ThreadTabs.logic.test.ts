import { describe, expect, it } from "vite-plus/test";
import {
  applyVisibleOrder,
  mergeClosingKeys,
  moveItem,
  neighborKey,
  orderTabKeys,
  resolveRenameCommit,
  tabsToClose,
  withNewTabKeys,
} from "./ThreadTabs.logic";

describe("orderTabKeys", () => {
  it("keeps the saved order and appends unseen tabs", () => {
    expect(orderTabKeys(["c", "a", "gone"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });
});

describe("applyVisibleOrder", () => {
  it("leaves hidden tabs in their slots", () => {
    expect(applyVisibleOrder(["a", "hidden", "b", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "hidden",
      "a",
      "b",
    ]);
  });
});

describe("moveItem", () => {
  it("moves forward and back", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

describe("mergeClosingKeys", () => {
  it("keeps a closing tab after its old left neighbor", () => {
    expect(mergeClosingKeys(["a", "b", "c"], ["a", "c"], new Set(["b"]))).toEqual(["a", "b", "c"]);
  });

  it("puts a closing first tab back at the front", () => {
    expect(mergeClosingKeys(["a", "b"], ["b"], new Set(["a"]))).toEqual(["a", "b"]);
  });

  it("ignores keys that are not closing", () => {
    expect(mergeClosingKeys(["a", "b"], ["b"], new Set())).toEqual(["b"]);
  });
});

describe("neighborKey", () => {
  it("prefers the left neighbor", () => {
    expect(neighborKey(["a", "b", "c"], "b")).toBe("a");
    expect(neighborKey(["a", "b"], "a")).toBe("b");
    expect(neighborKey(["a"], "a")).toBeNull();
  });
});

describe("tabsToClose", () => {
  it("splits around the tab", () => {
    expect(tabsToClose(["a", "b", "c"], "b", "left")).toEqual(["a"]);
    expect(tabsToClose(["a", "b", "c"], "b", "right")).toEqual(["c"]);
    expect(tabsToClose(["a", "b", "c"], "b", "others")).toEqual(["a", "c"]);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});

describe("withNewTabKeys", () => {
  it("returns the saved order itself when nothing is new", () => {
    const saved = ["a", "b"];
    expect(withNewTabKeys(saved, ["b", "a"], new Map(), 10)).toBe(saved);
  });

  it("gives a promoted draft's slot to its thread and appends the rest", () => {
    expect(
      withNewTabKeys(
        ["a", "draft:1", "b"],
        ["a", "t1", "b", "c"],
        new Map([["t1", "draft:1"]]),
        10,
      ),
    ).toEqual(["a", "t1", "b", "c"]);
  });

  it("drops the oldest stale keys past the limit", () => {
    expect(withNewTabKeys(["gone1", "a", "gone2"], ["a", "b"], new Map(), 3)).toEqual([
      "a",
      "gone2",
      "b",
    ]);
  });
});
