import type { CSSProperties, Ref } from "react";

/** The Haze effect's layered artwork, shared by the chat pane and the settings preview. */
export function GradientBlurBackground({
  className = "",
  style,
  ref,
}: {
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} aria-hidden className={`gradient-blur-background ${className}`} style={style}>
      <span className="gradient-blur-background-soft" />
      <span className="gradient-blur-background-strong" />
    </div>
  );
}
