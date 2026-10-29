import { type ReactNode, useEffect, useRef, useState } from "react";

import { useSidebar } from "../ui/sidebar";

/** Grace before a peek tucks away once the pointer leaves it. */
const PEEK_CLOSE_DELAY_MS = 180;

/**
 * With the sidebar collapsed, the sidebar floats out as a card below the title bar while
 * the pointer rests on the expand button ([data-sidebar-peek-trigger]). It tucks away shortly after the pointer leaves it, on a
 * press outside it, or on Escape. The workspace never reflows. After MonoCode.
 */
export function SidebarPeek({ children }: { children: ReactNode }) {
  const { isMobile, state } = useSidebar();
  const enabled = !isMobile && state === "collapsed";
  const [open, setOpen] = useState(false);
  // Stays mounted after closing until the fade out ends.
  const [present, setPresent] = useState(false);
  if (open && !present) setPresent(true);
  // Set by the panel's React handler, which also sees presses in the menus it portals out.
  const pressInside = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), PEEK_CLOSE_DELAY_MS);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document pointer and key listeners that open and close the peek while the sidebar is collapsed
  useEffect(() => {
    if (!enabled) return;
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return; // a drag or a text selection passing by
      if (!(event.target instanceof Element && event.target.closest("[data-sidebar-peek-trigger]")))
        return;
      window.clearTimeout(closeTimer.current);
      setOpen(true);
    };
    const onPointerDown = () => {
      if (!pressInside.current) setOpen(false);
      pressInside.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // An open menu inside claims Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    // Bubbling, so it runs after React's root listener has marked a press inside.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(closeTimer.current);
      // Expanding or leaving desktop ends the peek, so collapsing again starts tucked away.
      setOpen(false);
      setPresent(false);
    };
  }, [enabled]);

  if (!enabled || !present) return null;
  const closing = open ? undefined : "";
  return (
    <>
      <div
        aria-hidden
        data-closing={closing}
        className="sidebar-peek-backdrop fixed inset-0 z-54"
      />
      <div
        data-app-sidebar=""
        data-sidebar="sidebar"
        data-sidebar-peek=""
        data-closing={closing}
        className="sidebar-peek fixed top-(--workspace-topbar-height) bottom-1.5 left-1.5 z-55 flex w-(--sidebar-width) flex-col text-sidebar-foreground"
        onPointerDownCapture={() => {
          pressInside.current = true;
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) setPresent(false);
        }}
      >
        {children}
      </div>
    </>
  );
}
