// Background images and videos are device-local Blobs in IndexedDB, keyed "chat-background"
// for the global image and "project:<logical project key>" per project.

const DB_NAME = "t3code-glass";
const DB_STORE = "images";

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function imageDbRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openImageDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function readImage(key: string): Promise<Blob | null> {
  const stored = await imageDbRequest<unknown>("readonly", (store) => store.get(key));
  return stored instanceof Blob ? stored : null;
}

/** Effects redraw one still frame, so only still images take them; a GIF or video plays as is. */
export type MediaKind = "image" | "animated" | "video";

export const mediaKind = (blob: Blob): MediaKind =>
  blob.type.startsWith("video/") ? "video" : blob.type === "image/gif" ? "animated" : "image";

/** The first frame, for the focal point math and adaptive ink. Rejects unreadable files. */
export async function decodeFirstFrame(blob: Blob): Promise<ImageBitmap> {
  if (mediaKind(blob) !== "video") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Unreadable video."));
      video.src = url;
    });
    return await createImageBitmap(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Decodes first so an unreadable file fails here, not silently in the effects worker. */
export async function writeImage(key: string, file: Blob): Promise<void> {
  const bitmap = await decodeFirstFrame(file).catch(() => {
    throw new Error("That file is not an image or video this app can read.");
  });
  bitmap.close();
  await imageDbRequest("readwrite", (store) => store.put(file, key));
}

export async function deleteImage(key: string): Promise<void> {
  await imageDbRequest("readwrite", (store) => store.delete(key));
}

export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime";
