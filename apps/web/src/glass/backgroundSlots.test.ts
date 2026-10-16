import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

// IndexedDB and the effects worker aren't in jsdom: an in-memory image store,
// and effects that do nothing, are enough to test which image shows.
const images = new Map<string, Blob>();
vi.mock("./imageStore", () => ({
  readImage: async (key: string) => images.get(key) ?? null,
  writeImage: async (key: string, blob: Blob) => void images.set(key, blob),
  deleteImage: async (key: string) => void images.delete(key),
}));
vi.mock("./backgroundEffects", () => ({
  applyPreparedBackground: async () => {},
  clearPreparedBackground: () => {},
  prepareBackgroundEffect: async () => new Blob(),
  pixelEffectOf: (effect: string) => effect,
}));

const {
  flipChatBackground,
  getGlassState,
  removeChatBackgroundImage,
  setChatBackgroundImage,
  setChatBackgroundSlot,
} = await import("./glassAppearance");

beforeAll(() => {
  // The few browser pieces the background code touches.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  const classList = { toggle() {}, add() {}, remove() {}, contains: () => true };
  const style = { setProperty() {} };
  vi.stubGlobal("document", { documentElement: { classList, style } });
  let next = 0;
  URL.createObjectURL = () => `blob:test/${++next}`;
  URL.revokeObjectURL = () => {};
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder in tests")));
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("background slots", () => {
  it("steps through the slots, and keeps each one's render while flipping", async () => {
    await setChatBackgroundImage(new Blob(["one"]));
    const one = getGlassState();
    expect(one.backgroundSlot).toBe(1);

    await setChatBackgroundSlot(2);
    expect(getGlassState().imageUrl).toBeNull(); // nothing in slot 2 yet
    await setChatBackgroundImage(new Blob(["two"]));
    const two = getGlassState();
    expect(two.imageUrl).not.toBe(one.imageUrl);

    // 2 -> 3, empty so far, then 3 gets its own image
    flipChatBackground();
    await settle();
    expect(getGlassState()).toMatchObject({ backgroundSlot: 3, imageUrl: null });
    await setChatBackgroundImage(new Blob(["three"]));
    const three = getGlassState();

    // 3 -> 1 -> 2 -> 3, each showing its own image and render
    for (const expected of [one, two, three]) {
      flipChatBackground();
      await settle();
      expect(getGlassState()).toMatchObject({
        backgroundSlot: expected.backgroundSlot,
        imageUrl: expected.imageUrl,
        imageRevision: expected.imageRevision,
      });
    }
    expect(localStorage.getItem("t3code:glass-background-slot:v1")).toBe("3");
  });

  it("clears only the slot that's showing", async () => {
    await removeChatBackgroundImage();
    expect(getGlassState().imageUrl).toBeNull();
    expect(images.has("chat-background-3")).toBe(false);
    expect(images.has("chat-background-2")).toBe(true);
    expect(images.has("chat-background")).toBe(true);
  });
});
