/*
 * Tab strip motion, after MonoCode's title bar. A closed tab stays in the strip
 * at its measured width and folds to zero; a new tab grows in from zero. Drag
 * reorder is FLIP on transforms: neighbors slide into their new slots while the
 * dragged tab follows the pointer, then the order commits once it settles.
 */
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
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
  /** Width a closing tab folds from. */
  readonly width: number;
}

function settled<T extends { key: string }>(item: T): TabMotionEntry<T> {
  return { key: item.key, item, closing: false, opening: false, width: 0 };
}

export function useTabMotion<T extends { key: string }>(items: readonly T[]) {
  const widths = useRef(new Map<string, number>());
  const observers = useRef(new Map<string, () => void>());
  const signature = items.map((item) => item.key).join("\0");
  const [seenSignature, setSeenSignature] = useState(signature);
  const [entries, setEntries] = useState(() => items.map(settled));
  let shown = entries;
  if (signature !== seenSignature) {
    const keys = items.map((item) => item.key);
    const current = new Set(keys);
    const itemByKey = new Map(items.map((item) => [item.key, item]));
    const live = entries.filter((entry) => !entry.closing);
    const liveKeys = live.map((entry) => entry.key);
    // A whole new set of tabs (first load, a new window of threads) just appears.
    const replaced =
      liveKeys.length > 0 && keys.length > 0 && liveKeys.every((key) => !current.has(key));
    if (replaced || prefersReducedMotion()) {
      shown = items.map(settled);
    } else {
      const closing = entries.filter((entry) => entry.closing && !current.has(entry.key));
      for (const entry of live) {
        if (current.has(entry.key)) continue;
        closing.push({
          ...entry,
          closing: true,
          opening: false,
          width: widths.current.get(entry.key) ?? 0,
        });
      }
      const closingByKey = new Map(closing.map((entry) => [entry.key, entry]));
      const liveByKey = new Map(live.map((entry) => [entry.key, entry]));
      shown = mergeClosingKeys(
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
          {
            key,
            item,
            closing: false,
            opening: previous ? previous.opening : liveKeys.length > 0,
            width: 0,
          },
        ];
      });
    }
    setSeenSignature(signature);
    setEntries(shown);
  }

  /** Tracks a live tab's width so it can fold from it once closed. */
  const setTabNode = useCallback((key: string, node: HTMLElement | null) => {
    observers.current.get(key)?.();
    observers.current.delete(key);
    if (!node) return;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 1) widths.current.set(key, width);
    };
    measure();
    observers.current.set(key, observeResize(node, measure));
  }, []);
  useLayoutEffect(
    () => () => {
      for (const stop of observers.current.values()) stop();
    },
    [],
  );

  const finishMotion = useCallback((key: string) => {
    setEntries((current) => {
      if (!current.find((entry) => entry.key === key)?.closing) {
        return current.map((entry) => (entry.key === key ? { ...entry, opening: false } : entry));
      }
      widths.current.delete(key);
      return current.filter((entry) => entry.key !== key);
    });
  }, []);

  // Entries only change with the set of keys; their items track every render.
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  return {
    entries: shown.map((entry) => ({ ...entry, item: itemByKey.get(entry.key) ?? entry.item })),
    setTabNode,
    finishMotion,
  };
}

/** Folds a slot open or closed along its width, then reports back. */
export function TabMotionSlot({
  phase,
  width,
  onFinish,
  children,
}: {
  phase: "opening" | "closing";
  width: number;
  onFinish: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) {
      onFinishRef.current();
      return;
    }
    const duration = readDurationMs("--motion-tab-close-duration", 200);
    let innerFrame = 0;
    let timer = 0;
    // Two frames so the starting width paints before the transition target lands.
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        element.toggleAttribute("data-collapsed", phase === "closing");
        timer = window.setTimeout(() => onFinishRef.current(), duration);
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
      style={
        closing
          ? ({ "--tab-slot-width": width > 1 ? `${width}px` : "14rem" } as CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Truncating label that fades its end only while it actually overflows. */
export function TabLabel({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflow(element.clientWidth > 0 && element.scrollWidth > element.clientWidth);
    measure();
    return observeResize(element, measure);
  }, [children]);
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
  useLayoutEffect(() => {
    latest.current = { keys, onReorder };
  });
  const cleanupRef = useRef<(() => void) | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const signature = keys.join("\0");
  // The strip changed under a drag (a tab closed): drop the drag rather than misplace it.
  useLayoutEffect(() => () => cleanupRef.current?.(), [signature]);

  const setItemRef = useCallback((key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  const onItemPointerDown = useCallback((key: string, event: ReactPointerEvent) => {
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
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onCancel);
    window.addEventListener("scroll", onScroll, true);
  }, []);

  /** True right after a drag, so the click that ends it does not also select. */
  const consumeClick = useCallback(() => performance.now() < suppressClickUntil.current, []);

  return { draggingKey, setItemRef, onItemPointerDown, consumeClick };
}
