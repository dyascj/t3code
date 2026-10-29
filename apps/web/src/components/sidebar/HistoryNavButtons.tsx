import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "../ui/button";

/** Back and forward through the app's route history, as in the title bar. */
export function HistoryNavButtons() {
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Back"
        onClick={() => window.history.back()}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Forward"
        onClick={() => window.history.forward()}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
