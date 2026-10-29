import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { resolveShortcutCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { flipChatBackground } from "./glassAppearance";

/**
 * Mod+B by default steps through the chat backgrounds, ASCII scene first, anywhere in the app,
 * the message box included. It listens in the capture phase so a focused editor
 * can't claim the key for bold first.
 */
export function useBackgroundFlipShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window capture keydown listener that flips the chat background on its shortcut
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
