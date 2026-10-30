import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

// IndexedDB and the effects worker aren't in jsdom: an in-memory image store,
// and effects that do nothing, are enough to test which image shows.
const images = new Map<string, Blob>();
vi.mock("./imageStore", async (importActual) => ({
  mediaKind: (await importActual<typeof import("./imageStore")>()).mediaKind,
  decodeFirstFrame: () => Promise.reject(new Error("no decoder in tests")),
  readImage: async (key: string) => images.get(key) ?? null,
  writeImage: async (key: string, blob: Blob) => void images.set(key, blob),
  deleteImage: async (key: string) => void images.delete(key),
}));
// The effect each render asked for, or "video" for a video background.
const applied: string[] = [];
vi.mock("./backgroundEffects", () => ({
  applyPreparedBackground: async (_key: string, _src: string, effect: string) =>
    void applied.push(effect),
  applyVideoBackground: () => void applied.push("video"),
  clearPreparedBackground: () => {},
  prepareBackgroundEffect: async () => new Blob(),
}));

const {
  addChatBackground,
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
  vi.stubGlobal("document", { documentElement: { classList, style, dataset: {} } });
  vi.stubGlobal("window", {});
  let next = 0;
  URL.createObjectURL = () => `blob:test/${++next}`;
  URL.revokeObjectURL = () => {};
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder in tests")));
});

let shownThree: ReturnType<typeof getGlassState>;

describe("background slots", () => {
  it("starts on the ASCII scene, which takes no image", async () => {
    expect(getGlassState()).toMatchObject({ backgroundSlot: 0, imageUrl: null });
    await setChatBackgroundImage(new Blob(["ignored"]));
    await removeChatBackgroundImage();
    expect(getGlassState()).toMatchObject({
      backgroundSlot: 0,
      backgroundCount: 3,
      imageUrl: null,
    });
    expect(images.size).toBe(0);
  });

  it("steps through the slots, and keeps each one's render while flipping", async () => {
    await setChatBackgroundSlot(1);
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
    await vi.waitFor(() =>
      expect(getGlassState()).toMatchObject({ backgroundSlot: 3, imageUrl: null }),
    );
    await setChatBackgroundImage(new Blob(["three"]));
    const three = getGlassState();
    shownThree = three;

    // 3 -> ASCII, then 1 -> 2 -> 3, each showing its own image and render
    flipChatBackground();
    await vi.waitFor(() =>
      expect(getGlassState()).toMatchObject({ backgroundSlot: 0, imageUrl: null }),
    );
    for (const expected of [one, two, three]) {
      flipChatBackground();
      await vi.waitFor(() =>
        expect(getGlassState()).toMatchObject({
          backgroundSlot: expected.backgroundSlot,
          imageUrl: expected.imageUrl,
          imageRevision: expected.imageRevision,
        }),
      );
    }
    expect(localStorage.getItem("t3code:glass-background-slot:v2")).toBe("3");
  });

  it("removes the background that's showing, and later ones move down", async () => {
    await setChatBackgroundSlot(2);
    await removeChatBackgroundImage();
    expect(getGlassState()).toMatchObject({
      backgroundCount: 2,
      backgroundSlot: 2,
      imageUrl: shownThree.imageUrl,
      imageRevision: shownThree.imageRevision,
    });
    expect(await images.get("chat-background-2")?.text()).toBe("three");
    expect(images.has("chat-background-3")).toBe(false);
  });

  it("adds a background at the end with +, and flips round through it", async () => {
    await addChatBackground(new Blob(["four"]));
    const four = getGlassState();
    expect(four).toMatchObject({ backgroundCount: 3, backgroundSlot: 3 });
    expect(four.imageUrl).not.toBeNull();
    expect(await images.get("chat-background-3")?.text()).toBe("four");
    expect(localStorage.getItem("t3code:glass-background-count:v1")).toBe("3");
    flipChatBackground();
    await vi.waitFor(() => expect(getGlassState().backgroundSlot).toBe(0));
    await setChatBackgroundSlot(1);
  });

  it("only clears the image of the last background left", async () => {
    await removeChatBackgroundImage(); // 1
    await removeChatBackgroundImage(); // what was 2
    await removeChatBackgroundImage(); // the last one
    expect(getGlassState()).toMatchObject({
      backgroundCount: 1,
      backgroundSlot: 1,
      imageUrl: null,
    });
    expect(images.size).toBe(0);
  });

  it("plays a GIF or a video as it is, without the effect", async () => {
    await setChatBackgroundSlot(1);
    applied.length = 0;
    await setChatBackgroundImage(new Blob(["gif"], { type: "image/gif" }));
    await setChatBackgroundImage(new Blob(["mp4"], { type: "video/mp4" }));
    expect(applied).toEqual(["none", "video"]);
    expect(getGlassState().imageKind).toBe("video");
  });
});
