import { expect, it, vi } from "vite-plus/test";

// A worker that, like the real one, evicts loaded sources on its own schedule.
// This one forgets them all whenever the test says so.
const workerSources = new Set<string>();
vi.mock("./backgroundEffects.worker.ts?worker", () => ({
  default: class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage(message: { id: number; kind: string; sourceKey: string }) {
      const reply = (data: object) =>
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...data } }));
      if (message.kind === "load") {
        workerSources.add(message.sourceKey);
        reply({});
      } else if (workerSources.has(message.sourceKey)) {
        reply({ result: new Blob([message.sourceKey]) });
      } else {
        reply({ error: "Background source is not loaded." });
      }
    }
  },
}));
vi.stubGlobal("fetch", async () => new Response(new Blob(["image"])));

const { prepareBackgroundEffect } = await import("./backgroundEffects");

it("reloads a source the worker evicted instead of failing the render", async () => {
  const key = "chat-background?v=1";
  await prepareBackgroundEffect(key, "blob:one", "dither", false);
  workerSources.clear(); // newer uploads pushed it out of the worker
  await expect(prepareBackgroundEffect(key, "blob:one", "ascii", false)).resolves.toBeInstanceOf(
    Blob,
  );
});
