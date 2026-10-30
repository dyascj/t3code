import type { CSSProperties, Ref } from "react";

import { BackgroundVideo } from "./BackgroundVideo";

/** The Haze effect's layered artwork, shared by the chat pane and the settings preview. */
export function GradientBlurBackground({
  className = "",
  style,
  ref,
  videoSrc,
}: {
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  /** A video background plays in each layer, where an image is the layers' CSS background. */
  videoSrc?: string | null;
}) {
  const video = videoSrc ? <BackgroundVideo src={videoSrc} /> : null;
  return (
    <div ref={ref} aria-hidden className={`gradient-blur-background ${className}`} style={style}>
      {video}
      <span className="gradient-blur-background-soft">{video}</span>
      <span className="gradient-blur-background-strong">{video}</span>
    </div>
  );
}
