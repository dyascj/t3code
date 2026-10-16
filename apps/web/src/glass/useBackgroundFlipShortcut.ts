import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { resolveShortcutCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { flipChatBackground } from "./glassAppearance";

/**
 * Mod+B by default steps through the three chat backgrounds, anywhere in the app,
 * the message box included. It listens in the capture phase so a focused editor
 * can't claim the key for bold first.
 */
export function useBackgroundFlipShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Recording a new shortcut in settings must see the keys, not trigger them.
      if (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
        return;
      if (resolveShortcutCommand(event, keybindings) !== "background.flip") return;
      event.preventDefault();
      event.stopPropagation();
      flipChatBackground();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);
}
