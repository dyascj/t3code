/*
 * Tab strip motion, after MonoCode's title bar. A closed tab stays in the strip
 * at its measured width and folds to zero; a new tab grows in from zero. Drag
 * reorder is FLIP on transforms: neighbors slide into their new slots while the
 * dragged tab follows the pointer, then the order commits once it settles.
 */
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { observeResize } from "../../lib/observeResize";
import { mergeClosingKeys, moveItem } from "./ThreadTabs.logic";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readDurationMs(property: string, fallback: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  const parsed = Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface TabMotionEntry<T> {
  readonly key: string;
  readonly item: T;
  readonly closing: boolean;
  readonly opening: boolean;
}

function settled<T extends { key: string }>(item: T): TabMotionEntry<T> {
  return { key: item.key, item, closing: false, opening: false };
}

/**
 * The strip's entries once `items` replaces what `entries` showed: tabs that
 * left fold away from where they were, and tabs that arrived grow in.
 */
function nextEntries<T extends { key: string }>(
  entries: readonly TabMotionEntry<T>[],
  items: readonly T[],
): TabMotionEntry<T>[] {
  const keys = items.map((item) => item.key);
  const current = new Set(keys);
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const live = entries.filter((entry) => !entry.closing);
  const liveKeys = live.map((entry) => entry.key);
  // A whole new set of tabs (first load, a new window of threads) just appears.
  const replaced =
    liveKeys.length > 0 && keys.length > 0 && liveKeys.every((key) => !current.has(key));
  if (replaced || prefersReducedMotion()) return items.map(settled);
  const closing = entries.filter((entry) => entry.closing && !current.has(entry.key));
  for (const entry of live) {
    if (current.has(entry.key)) continue;
    closing.push({ ...entry, closing: true, opening: false });
  }
  const closingByKey = new Map(closing.map((entry) => [entry.key, entry]));
  const liveByKey = new Map(live.map((entry) => [entry.key, entry]));
  return mergeClosingKeys(
    entries.map((entry) => entry.key),
    keys,
    new Set(closingByKey.keys()),
  ).flatMap((key): TabMotionEntry<T>[] => {
    const item = itemByKey.get(key);
    if (!item) {
      const entry = closingByKey.get(key);
      return entry ? [entry] : [];
    }
    const previous = liveByKey.get(key);
    return [
      { key, item, closing: false, opening: previous ? previous.opening : liveKeys.length > 0 },
    ];
  });
}

/*
 * The strip remounts with the chat view whenever the route moves to another
 * thread or draft, which is exactly when tabs come and go (a new thread, closing
 * the active tab). One strip shows at a time, so it remembers what it last
 * showed and a fresh mount picks the motion up from there.
 */
let shownEntries: readonly TabMotionEntry<unknown>[] | null = null;
const widths = new Map<string, number>();

export function useTabMotion<T extends { key: string }>(items: readonly T[]) {
  const observers = useRef(new Map<string, () => void>());
  const signature = items.map((item) => item.key).join("\0");
  const [seenSignature, setSeenSignature] = useState(signature);
  const [entries, setEntries] = useState(() =>
    shownEntries === null
      ? items.map(settled)
      : nextEntries(shownEntries as readonly TabMotionEntry<T>[], items),
  );
  let shown = entries;
  if (signature !== seenSignature) {
    shown = nextEntries(entries, items);
    setSeenSignature(signature);
    setEntries(shown);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed entries to the module so the next strip mount resumes the motion
  useLayoutEffect(() => {
    shownEntries = entries;
  }, [entries]);

  /** Tracks a live tab's width so it can fold from it once closed. */
  const setTabNode = (key: string, node: HTMLElement | null) => {
    observers.current.get(key)?.();
    observers.current.delete(key);
    if (!node) return;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 1) widths.set(key, width);
    };
    measure();
    observers.current.set(key, observeResize(node, measure));
  };
  /** The width a closing tab folds from; read when its fold starts, never in render. */
  const widthOf = (key: string) => widths.get(key) ?? 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- disconnects the tab resize observers on unmount
  useLayoutEffect(
    () => () => {
      for (const stop of observers.current.values()) stop();
    },
    [],
  );

  const finishMotion = (key: string) => {
    setEntries((current) => {
      if (!current.find((entry) => entry.key === key)?.closing) {
        return current.map((entry) => (entry.key === key ? { ...entry, opening: false } : entry));
      }
      widths.delete(key);
      return current.filter((entry) => entry.key !== key);
    });
  };

  // Entries only change with the set of keys; their items track every render.
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  return {
    entries: shown.map((entry) => ({ ...entry, item: itemByKey.get(entry.key) ?? entry.item })),
    setTabNode,
    widthOf,
    finishMotion,
  };
}

/** Folds a slot open or closed along its width, then reports back. */
export function TabMotionSlot({
  phase,
  readWidth,
  onFinish,
  children,
}: {
  phase: "opening" | "closing";
  /** The width a closing slot folds from, measured while its tab was live. */
  readWidth: () => number;
  onFinish: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const finish = useEffectEvent(onFinish);
  const startWidth = useEffectEvent(readWidth);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the slot's DOM width transition with frames and a finish timer
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (phase === "closing") {
      // Start at the tab's width before the first paint. Neighbors measuring in the
      // same commit already gave the slot a width, so jump there rather than animate.
      const width = startWidth();
      element.style.transition = "none";
      element.style.setProperty("--tab-slot-width", width > 1 ? `${width}px` : "14rem");
      // Apply it now, untransitioned. A call: the compile step drops a bare property read.
      element.getBoundingClientRect();
      element.style.removeProperty("transition");
    }
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const duration = readDurationMs("--motion-tab-close-duration", 200);
    let innerFrame = 0;
    let timer = 0;
    // Two frames so the starting width paints before the transition target lands.
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        element.toggleAttribute("data-collapsed", phase === "closing");
        timer = window.setTimeout(() => finish(), duration);
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      window.clearTimeout(timer);
    };
  }, [phase]);
  const closing = phase === "closing";
  return (
    <div
      ref={ref}
      aria-hidden={closing || undefined}
      inert={closing}
      data-collapsed={phase === "opening" || undefined}
      className={`tab-${phase} relative flex h-full min-w-0 self-stretch`}
    >
      {children}
    </div>
  );
}

/** Truncating label that fades its end only while it actually overflows. */
export function TabLabel({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the label element's size and text before paint to fade only real overflow
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflow(element.clientWidth > 0 && element.scrollWidth > element.clientWidth);
    measure();
    // A new title can overflow without changing the truncated label's size.
    const textChanges = new MutationObserver(measure);
    textChanges.observe(element, { characterData: true, childList: true, subtree: true });
    const stopObserving = observeResize(element, measure);
    return () => {
      textChanges.disconnect();
      stopObserving();
    };
  }, []);
  return (
    <span
      ref={ref}
      data-overflow={overflow || undefined}
      className={`tab-label min-w-0 truncate ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

const DRAG_THRESHOLD_PX = 5;

/** Pointer drag reorder along the strip. */
export function useTabReorder(
  keys: readonly string[],
  onReorder: (next: string[], movedKey: string) => void,
) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const latest = useRef({ keys, onReorder });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed keys and callback to a ref the window drag listeners read
  useLayoutEffect(() => {
    latest.current = { keys, onReorder };
  });
  const cleanupRef = useRef<(() => void) | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  // The strip's keys when the drag began, or null between drags.
  const dragSignature = useRef<string | null>(null);
  const signature = keys.join("\0");
  // The strip changed under a drag (a tab closed): drop the drag rather than misplace it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tears down the window drag listeners when the strip changes mid-drag
  useLayoutEffect(() => {
    if (dragSignature.current !== null && dragSignature.current !== signature) {
      cleanupRef.current?.();
    }
  }, [signature]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tears down the window drag listeners on unmount
  useLayoutEffect(() => () => cleanupRef.current?.(), []);

  const setItemRef = (key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };

  const onItemPointerDown = (key: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    finishRef.current?.();
    if (cleanupRef.current) return;
    suppressClickUntil.current = 0;
    const order = latest.current.keys;
    const from = order.indexOf(key);
    if (order.length < 2 || from < 0) return;
    const maybeElements = order.map((candidate) => nodes.current.get(candidate));
    if (maybeElements.some((element) => !element)) return;
    const elements = maybeElements as HTMLElement[];
    const slots = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { start: rect.left, size: rect.width, end: rect.right };
    });
    const dragged = elements[from]!;
    const scrollers: { element: HTMLElement; start: number }[] = [];
    for (let parent = dragged.parentElement; parent; parent = parent.parentElement) {
      scrollers.push({ element: parent, start: parent.scrollLeft });
    }
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const duration = prefersReducedMotion() ? 0 : readDurationMs("--motion-reorder-duration", 160);
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue("--motion-ease-out").trim() ||
      "ease-out";
    const transition = `transform ${duration}ms ${easing}`;
    const translate = (x: number) => `translate3d(${x}px, 0, 0)`;
    let active = false;
    let settling = false;
    let target = from;
    let frame = 0;
    let pointerX = startX;
    let settleTimer = 0;

    const shiftOthers = (to: number) => {
      const next = moveItem(order, from, to);
      elements.forEach((element, index) => {
        if (index === from) return;
        element.style.transform = translate(
          slots[next.indexOf(order[index]!)]!.start - slots[index]!.start,
        );
      });
    };
    const follow = (writeTransform = true) => {
      frame = 0;
      const scrolled = scrollers.reduce(
        (total, { element, start }) => total + element.scrollLeft - start,
        0,
      );
      const offset = Math.max(
        slots[0]!.start - slots[from]!.start,
        Math.min(pointerX - startX + scrolled, slots[slots.length - 1]!.end - slots[from]!.end),
      );
      if (writeTransform) dragged.style.transform = translate(offset);
      const center = slots[from]!.start + slots[from]!.size / 2 + offset;
      const nearest = slots.reduce((best, slot, index) => {
        const distance = Math.abs(center - slot.start - slot.size / 2);
        const bestSlot = slots[best]!;
        return distance < Math.abs(center - bestSlot.start - bestSlot.size / 2) ? index : best;
      }, from);
      if (nearest !== target) {
        target = nearest;
        shiftOthers(nearest);
      }
    };
    const clearDragMarks = () => {
      for (const element of elements) delete element.dataset.reordering;
      delete dragged.dataset.dragging;
      if (dragged.hasPointerCapture(pointerId)) dragged.releasePointerCapture(pointerId);
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", finishEarly, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      for (const element of elements) {
        element.style.removeProperty("transition");
        element.style.removeProperty("transform");
        delete element.dataset.settling;
      }
      clearDragMarks();
      if (active) suppressClickUntil.current = performance.now() + 400;
      cleanupRef.current = null;
      finishRef.current = null;
      dragSignature.current = null;
      setDraggingKey(null);
    };
    const onScroll = () => {
      if (active && !settling && !frame) frame = requestAnimationFrame(() => follow());
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || settling) return;
      pointerX = moveEvent.clientX;
      if (!active) {
        if (Math.abs(pointerX - startX) < DRAG_THRESHOLD_PX) return;
        active = true;
        setDraggingKey(key);
        dragged.setPointerCapture(pointerId);
        for (const element of elements) {
          element.style.transition = transition;
          element.dataset.reordering = "true";
        }
        dragged.style.transition = "none";
        dragged.dataset.dragging = "true";
      }
      if (!frame) frame = requestAnimationFrame(() => follow());
    };
    const end = (commit: boolean) => {
      if (settling) return;
      if (!active) {
        cleanup();
        return;
      }
      settling = true;
      cancelAnimationFrame(frame);
      if (commit) follow(false);
      dragged.dataset.settling = "true";
      clearDragMarks();
      suppressClickUntil.current = performance.now() + duration + 400;
      const final = commit ? target : from;
      shiftOthers(final);
      dragged.style.transition = transition;
      dragged.style.transform = translate(slots[final]!.start - slots[from]!.start);
      const finish = () => {
        flushSync(() => {
          cleanup();
          if (final !== from) latest.current.onReorder(moveItem(order, from, final), key);
        });
      };
      finishRef.current = finish;
      if (duration === 0) finish();
      else {
        window.addEventListener("pointerdown", finishEarly, true);
        settleTimer = window.setTimeout(finish, duration);
      }
    };
    function finishEarly() {
      finishRef.current?.();
    }
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      onMove(upEvent);
      end(true);
    };
    const onCancel = () => end(false);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      end(false);
    };
    cleanupRef.current = cleanup;
    dragSignature.current = order.join("\0");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onCancel);
    window.addEventListener("scroll", onScroll, true);
  };

  /** True right after a drag, so the click that ends it does not also select. */
  const consumeClick = () => performance.now() < suppressClickUntil.current;

  return { draggingKey, setItemRef, onItemPointerDown, consumeClick };
}
