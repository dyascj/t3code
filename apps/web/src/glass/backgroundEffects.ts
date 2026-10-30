// Image effects for chat backgrounds, rendered off the main thread.
// Third-party code: see ./THIRD_PARTY_LICENSE.

import BackgroundEffectsWorker from "./backgroundEffects.worker.ts?worker";
import { pruneToRecentSources, touch } from "./recentSources";

export type BackgroundEffect = "none" | "dither" | "ascii" | "halftone" | "scanlines";

type WorkerResponse = { id: number; result?: Blob; error?: string };

let worker: Worker | null = null;
let nextRequestId = 0;
let appliedRevision = 0;
let activeObjectUrl: string | null = null;
const pending = new Map<
  number,
  { resolve: (result?: Blob) => void; reject: (error: Error) => void }
>();
const loadedSources = new Map<string, Promise<void>>();
const effectCache = new Map<string, Promise<Blob>>();

/** A transient fetch or worker error must remain retryable. */
function forgetOnReject<K>(map: Map<K, Promise<unknown>>, key: K) {
  const entry = map.get(key);
  entry?.catch(() => {
    if (map.get(key) === entry) map.delete(key);
  });
}

function backgroundWorker() {
  if (worker) return worker;
  worker = new BackgroundEffectsWorker();
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  return worker;
}

function request(message: object, transfer?: Transferable[]) {
  const id = ++nextRequestId;
  return new Promise<Blob | undefined>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    backgroundWorker().postMessage({ ...message, id }, transfer ?? []);
  });
}

async function ensureSource(sourceKey: string, src: string) {
  let loading = touch(loadedSources, sourceKey);
  if (!loading) {
    loading = fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to read the background image.");
        return response.arrayBuffer();
      })
      .then(async (bytes) => {
        await request({ kind: "load", sourceKey, bytes }, [bytes]);
      });
    loadedSources.set(sourceKey, loading);
    pruneToRecentSources(loadedSources);
    forgetOnReject(loadedSources, sourceKey);
  }
  return loading;
}

export async function prepareBackgroundEffect(
  sourceKey: string,
  src: string,
  effect: BackgroundEffect,
  light: boolean,
) {
  const themeKey = effect === "none" || effect === "dither" ? false : light;
  const cacheKey = `${sourceKey}:${effect}:${themeKey}`;
  let prepared = touch(effectCache, cacheKey);
  if (!prepared) {
    const render = async () => {
      await ensureSource(sourceKey, src);
      const result = await request({ kind: "render", sourceKey, effect, light: themeKey });
      if (!result) throw new Error("The background effect returned no image.");
      return result;
    };
    // The worker evicts sources on its own, so one this side still counts as
    // loaded may be gone there: load it again once before giving up on the effect.
    prepared = render().catch(() => {
      loadedSources.delete(sourceKey);
      return render();
    });
    effectCache.set(cacheKey, prepared);
    pruneToRecentSources(effectCache);
    forgetOnReject(effectCache, cacheKey);
  }
  return prepared;
}

export function clearPreparedBackground() {
  appliedRevision += 1;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  document.documentElement.style.removeProperty("--chat-background-image");
  document.documentElement.classList.remove("chat-background-effect-ready");
}

/** A video plays in its own element (BackgroundVideo); the CSS image stays empty. */
export function applyVideoBackground() {
  clearPreparedBackground();
  document.documentElement.classList.add("chat-background-effect-ready");
}

export async function applyPreparedBackground(
  sourceKey: string,
  src: string,
  effect: BackgroundEffect,
  light: boolean,
) {
  const revision = ++appliedRevision;
  const root = document.documentElement;
  root.classList.remove("chat-background-effect-ready");
  if (effect === "none") {
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
    root.style.setProperty("--chat-background-image", `url(${JSON.stringify(src)})`);
    requestAnimationFrame(() => {
      if (revision === appliedRevision) {
        root.classList.add("chat-background-effect-ready");
      }
    });
    return;
  }
  let blob: Blob;
  try {
    blob = await prepareBackgroundEffect(sourceKey, src, effect, light);
  } catch {
    if (revision !== appliedRevision) return;
    root.style.setProperty("--chat-background-image", `url(${JSON.stringify(src)})`);
    root.classList.add("chat-background-effect-ready");
    return;
  }
  if (revision !== appliedRevision) return;
  const objectUrl = URL.createObjectURL(blob);
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = objectUrl;
  root.style.setProperty("--chat-background-image", `url(${JSON.stringify(objectUrl)})`);
  requestAnimationFrame(() => {
    if (revision === appliedRevision) {
      root.classList.add("chat-background-effect-ready");
    }
  });
}
