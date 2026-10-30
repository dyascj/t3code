import type { CSSProperties } from "react";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A video background, drawn where an image background would be the CSS
 * background-image. Muted and looping; with reduced motion it holds its first frame.
 */
export function BackgroundVideo({
  src,
  className = "",
  style,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <video
      aria-hidden
      src={src}
      autoPlay={!reducedMotion()}
      muted
      loop
      playsInline
      disablePictureInPicture
      className={`background-video ${className}`}
      style={style}
    />
  );
}
