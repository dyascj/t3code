import type * as Electron from "electron";
import type { DataType as FfiDataType } from "ffi-rs";

// Window glass: the window is transparent and WindowServer blurs the
// desktop behind it through the private CGSSetWindowBackgroundBlurRadius call.
// Unlike NSVisualEffectView vibrancy this adds no material tint, so the
// renderer's own tint is the only color on top of the blur.

const MAC_WINDOW_BLUR_RADIUS_MIN = 1;
const MAC_WINDOW_BLUR_RADIUS_MAX = 64;
export const MAC_WINDOW_BLUR_RADIUS_DEFAULT = 23;

const CORE_GRAPHICS = "t3-core-graphics";
const OBJC = "t3-objc";

let setBlurRadiusPromise: Promise<(windowNumber: number, radius: number) => void> | undefined;

function loadSetBlurRadius() {
  setBlurRadiusPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    open({
      library: CORE_GRAPHICS,
      path: "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
    });
    const connection = load({
      library: CORE_GRAPHICS,
      funcName: "CGSMainConnectionID",
      retType: DataType.I32,
      paramsType: [],
      paramsValue: [],
    });
    return (windowNumber, radius) => {
      load({
        library: CORE_GRAPHICS,
        funcName: "CGSSetWindowBackgroundBlurRadius",
        retType: DataType.I32,
        paramsType: [DataType.I32, DataType.I32, DataType.I32],
        paramsValue: [connection, windowNumber, radius],
      });
    };
  });
  return setBlurRadiusPromise;
}

function clampMacWindowBlurRadius(radius: number): number {
  if (!Number.isFinite(radius)) return MAC_WINDOW_BLUR_RADIUS_DEFAULT;
  return Math.round(
    Math.min(MAC_WINDOW_BLUR_RADIUS_MAX, Math.max(MAC_WINDOW_BLUR_RADIUS_MIN, radius)),
  );
}

/** getMediaSourceId is "window:<CGWindowID>:0", and the CGWindowID is the window number. */
function parseMacWindowNumber(mediaSourceId: string): number | null {
  const windowNumber = Number(mediaSourceId.split(":")[1]);
  return Number.isInteger(windowNumber) && windowNumber > 0 ? windowNumber : null;
}

let keepCornersPromise: Promise<(view: bigint) => void> | undefined;

// A fully clear NSWindow leaves an unblurred gap at its rounded corners; a 1%
// alpha background makes AppKit fill the window's shape so blur and corners
// line up. Electron's setBackgroundColor does not reach the NSWindow of a
// transparent window, so this goes through the Objective-C runtime.
function loadKeepCorners() {
  keepCornersPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    open({ library: OBJC, path: "/usr/lib/libobjc.A.dylib" });
    // NSColor lives in AppKit, which Electron has already loaded.
    const send = (retType: FfiDataType, paramsType: FfiDataType[], paramsValue: unknown[]) =>
      load({ library: OBJC, funcName: "objc_msgSend", retType, paramsType, paramsValue }) as bigint;
    const selector = (name: string) =>
      load({
        library: OBJC,
        funcName: "sel_registerName",
        retType: DataType.BigInt,
        paramsType: [DataType.String],
        paramsValue: [name],
      }) as bigint;
    const nsColor = load({
      library: OBJC,
      funcName: "objc_getClass",
      retType: DataType.BigInt,
      paramsType: [DataType.String],
      paramsValue: ["NSColor"],
    }) as bigint;
    // BigInt, not a number: tagged pointers such as NSColor's do not fit a double.
    const P = DataType.BigInt;
    return (view) => {
      const window = send(P, [P, P], [view, selector("window")]);
      if (window === 0n) return;
      const color = send(
        P,
        [P, P, DataType.Double, DataType.Double, DataType.Double, DataType.Double],
        [nsColor, selector("colorWithSRGBRed:green:blue:alpha:"), 0, 0, 0, 0.01],
      );
      send(DataType.Void, [P, P, P], [window, selector("setBackgroundColor:"), color]);
      send(DataType.Void, [P, P], [window, selector("invalidateShadow")]);
    };
  });
  return keepCornersPromise;
}

/** macOS only; run again after anything resets the window background. */
export async function keepMacWindowCorners(window: Electron.BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  const keepCorners = await loadKeepCorners();
  if (window.isDestroyed()) return;
  keepCorners(window.getNativeWindowHandle().readBigUInt64LE(0));
}

/** macOS only; callers gate on the platform. */
export async function setMacWindowBlurRadius(
  window: Electron.BrowserWindow,
  radius: number,
): Promise<void> {
  // Test doubles lack getMediaSourceId; with no window number there is nothing to blur.
  if (window.isDestroyed() || typeof window.getMediaSourceId !== "function") return;
  const windowNumber = parseMacWindowNumber(window.getMediaSourceId());
  if (windowNumber === null) return;
  const setBlurRadius = await loadSetBlurRadius();
  if (window.isDestroyed()) return;
  setBlurRadius(windowNumber, clampMacWindowBlurRadius(radius));
  await keepMacWindowCorners(window);
}
