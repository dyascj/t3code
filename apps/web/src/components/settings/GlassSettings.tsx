import { useAtomValue } from "@effect/atom-react";
import { ImagePlusIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { isElectron } from "../../env";
import {
  BACKGROUND_EFFECTS,
  BACKGROUND_EFFECT_DESCRIPTIONS,
  BACKGROUND_EFFECT_LABELS,
  type BackgroundEffect,
  type BackgroundFocus,
  type ChatBackgroundScope,
  DEFAULT_BACKGROUND_FOCUS,
  DEFAULT_GLASS_APPEARANCE,
  GLASS_LIMITS,
  type GlassAppearance,
  getGlassState,
  globalBackgroundSourceKey,
  isBackgroundEffect,
  removeChatBackgroundImage,
  resetGlassAppearance,
  setChatBackgroundImage,
  BACKGROUND_SLOTS,
  isBackgroundSlot,
  setChatBackgroundSlot,
  showingBackgroundFocus,
  subscribeGlassState,
  updateBackgroundFocus,
  updateGlassAppearance,
} from "../../glass/glassAppearance";
import { GradientBlurBackground } from "../../glass/GradientBlurBackground";
import { useFocalBackgroundRef } from "../../glass/focalPoint";
import { useBackgroundEffectUrl } from "../../glass/projectChatBackground";
import { IMAGE_ACCEPT } from "../../glass/imageStore";
import { shortcutLabelForCommand } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

/* Appearance > Color, Translucency, and Chat background. */

export function useGlassState() {
  return useSyncExternalStore(subscribeGlassState, getGlassState, getGlassState);
}

function ResetButton({ label, keys }: { label: string; keys: (keyof GlassAppearance)[] }) {
  const { appearance } = useGlassState();
  const changed = keys.some((key) => appearance[key] !== DEFAULT_GLASS_APPEARANCE[key]);
  return changed ? (
    <SettingResetButton label={label} onClick={() => resetGlassAppearance(keys)} />
  ) : null;
}

export function GlassSlider({
  id,
  label,
  value,
  min,
  max,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const ratio = (value - min) / (max - min);
  const style = {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
  return (
    <div className="flex w-full items-center gap-3 sm:w-60">
      <input
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={1}
        style={style}
        type="range"
        value={value}
      />
      <output
        className="min-w-11 text-right text-xs font-medium tabular-nums text-foreground"
        htmlFor={id}
      >
        {display}
      </output>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="segmented"
      value={[value]}
      onValueChange={(next) => {
        const selected = options.find((option) => option.value === next[0]);
        if (selected) onChange(selected.value);
      }}
    >
      {options.map((option) => (
        <Toggle key={option.value} value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export const BACKGROUND_EFFECT_OPTIONS = BACKGROUND_EFFECTS.map((effect) => ({
  value: effect,
  label: BACKGROUND_EFFECT_LABELS[effect],
}));

export const BACKGROUND_SCOPE_OPTIONS: readonly { value: ChatBackgroundScope; label: string }[] = [
  { value: "empty", label: "Empty only" },
  { value: "all", label: "All sessions" },
];

const percent = (value: number) => Math.round(value * 100);

export function ColorSettingsSection() {
  const { appearance: a } = useGlassState();
  const L = GLASS_LIMITS;
  return (
    <SettingsSection
      id="appearance-color"
      title="Color"
      description="Hue and saturation tint every surface. Lightness only moves the dark theme."
    >
      <SettingsRow
        title="Hue"
        description="Base hue for accents and tinted surfaces."
        resetAction={<ResetButton label="hue" keys={["hue"]} />}
        control={
          <GlassSlider
            id="theme-hue"
            label="Hue"
            value={a.hue}
            min={L.hue.min}
            max={L.hue.max}
            display={`${a.hue}°`}
            onChange={(hue) => updateGlassAppearance({ hue })}
          />
        }
      />
      <SettingsRow
        title="Saturation"
        description="How strongly the hue tints the interface. Zero keeps it neutral."
        resetAction={<ResetButton label="saturation" keys={["saturation"]} />}
        control={
          <GlassSlider
            id="theme-saturation"
            label="Saturation"
            value={a.saturation}
            min={L.saturation.min}
            max={L.saturation.max}
            display={`${a.saturation}%`}
            onChange={(saturation) => updateGlassAppearance({ saturation })}
          />
        }
      />
      <SettingsRow
        title="Dark-mode lightness"
        description="Base brightness of the dark theme. Lower values are darker; zero is true black."
        resetAction={<ResetButton label="dark-mode lightness" keys={["darkLightness"]} />}
        control={
          <GlassSlider
            id="theme-dark-lightness"
            label="Dark-mode lightness"
            value={a.darkLightness}
            min={L.darkLightness.min}
            max={L.darkLightness.max}
            display={`${a.darkLightness}%`}
            onChange={(darkLightness) => updateGlassAppearance({ darkLightness })}
          />
        }
      />
    </SettingsSection>
  );
}

/** Translucency only exists where the desktop shell can blur behind the window. */
export function TranslucencySettingsSection() {
  const { appearance: a } = useGlassState();
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;
  const L = GLASS_LIMITS;
  return (
    <SettingsSection
      id="appearance-translucency"
      title="Translucency"
      description="How much of the desktop shows through T3 Code. Blur costs more to composite the higher it goes."
    >
      <SettingsRow
        title="Sidebar opacity"
        description="Applies to the project rail and the other glass panes."
        resetAction={<ResetButton label="sidebar opacity" keys={["sidebarOpacity"]} />}
        control={
          <GlassSlider
            id="sidebar-opacity"
            label="Sidebar opacity"
            value={percent(a.sidebarOpacity)}
            min={percent(L.sidebarOpacity.min)}
            max={percent(L.sidebarOpacity.max)}
            display={`${percent(a.sidebarOpacity)}%`}
            onChange={(value) => updateGlassAppearance({ sidebarOpacity: value / 100 })}
          />
        }
      />
      <SettingsRow
        title="Blur radius"
        description="Background blur behind the window."
        resetAction={<ResetButton label="blur radius" keys={["blurRadius"]} />}
        control={
          <GlassSlider
            id="window-blur-radius"
            label="Blur radius"
            value={a.blurRadius}
            min={L.blurRadius.min}
            max={L.blurRadius.max}
            display={`${a.blurRadius}`}
            onChange={(blurRadius) => updateGlassAppearance({ blurRadius })}
          />
        }
      />
      <SettingsRow
        title="Main pane glass"
        description="Extend the translucent treatment to the main pane behind sessions and editors."
        resetAction={<ResetButton label="main pane glass" keys={["mainPaneGlass"]} />}
        control={
          <Switch
            aria-label="Main pane glass"
            checked={a.mainPaneGlass}
            onCheckedChange={(mainPaneGlass) => updateGlassAppearance({ mainPaneGlass })}
          />
        }
      />
    </SettingsSection>
  );
}

/** The image card shared by the global and project background settings. */
export function BackgroundImagePicker({
  imageUrl,
  effect,
  emptyOpacity,
  busy,
  error,
  onChoose,
  onRemove,
  emptyLabel = "Choose an image",
  note,
  followFocalPoint = false,
}: {
  imageUrl: string | null;
  effect: BackgroundEffect;
  emptyOpacity: number;
  busy: boolean;
  error: string | null;
  onChoose: (file: File) => void;
  onRemove: () => void;
  emptyLabel?: string;
  note?: ReactNode;
  /** Frame the preview on the global image's focal point; otherwise it stays centered. */
  followFocalPoint?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const choose = () => fileInputRef.current?.click();
  const focalRef = useFocalBackgroundRef(followFocalPoint);
  return (
    <div className="px-3 py-3 sm:px-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onChoose(file);
        }}
      />
      <div className="overflow-hidden rounded-lg border border-border">
        {imageUrl ? (
          <div
            ref={focalRef}
            className="relative h-36"
            style={
              followFocalPoint
                ? undefined
                : ({ "--chat-background-position": "center" } as CSSProperties)
            }
          >
            {effect === "gradient-blur" ? (
              <GradientBlurBackground
                className="gradient-blur-preview absolute inset-0"
                style={
                  {
                    "--chat-background-image": `url(${JSON.stringify(imageUrl)})`,
                    opacity: emptyOpacity,
                  } as CSSProperties
                }
              />
            ) : (
              <div
                aria-hidden
                className="size-full bg-cover bg-no-repeat"
                style={{
                  backgroundImage: `url(${JSON.stringify(imageUrl)})`,
                  backgroundPosition: "var(--chat-background-position, center)",
                  opacity: emptyOpacity,
                }}
              />
            )}
            <span className="pointer-events-none absolute bottom-2 left-2 text-2xs text-muted-foreground">
              Empty chat preview at {percent(emptyOpacity)}%
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            className="flex h-36 w-full flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {busy ? (
              <Spinner className="size-5" />
            ) : (
              <ImagePlusIcon className="size-5" aria-hidden />
            )}
            <span className="text-xs">{emptyLabel}</span>
          </button>
        )}
      </div>
      {imageUrl ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={choose}>
            {busy ? <Spinner className="size-3.5" /> : null}
            Change
          </Button>
          <Button size="sm" variant="destructive-outline" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : null}
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      {error ? <p className="mt-2 text-xs text-destructive-foreground">{error}</p> : null}
    </div>
  );
}

const FOCUS_KEY_STEP = 5;

/**
 * The whole image with a marker on the focal point. Click, drag, or use the
 * arrow keys to move it.
 */
function FocusPointSurface({
  imageUrl,
  focus,
  onChange,
}: {
  imageUrl: string;
  focus: BackgroundFocus;
  onChange: (focus: BackgroundFocus) => void;
}) {
  const clamp = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
  const moveTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onChange({
      x: clamp(((event.clientX - box.left) / box.width) * 100),
      y: clamp(((event.clientY - box.top) / box.height) * 100),
    });
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Focal point"
      aria-valuetext={`${focus.x}% from the left, ${focus.y}% from the top`}
      className="relative cursor-crosshair touch-none overflow-hidden rounded-md border border-border outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event);
      }}
      onKeyDown={(event) => {
        const delta = {
          ArrowLeft: [-FOCUS_KEY_STEP, 0],
          ArrowRight: [FOCUS_KEY_STEP, 0],
          ArrowUp: [0, -FOCUS_KEY_STEP],
          ArrowDown: [0, FOCUS_KEY_STEP],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        onChange({ x: clamp(focus.x + delta[0]!), y: clamp(focus.y + delta[1]!) });
      }}
    >
      <img alt="" draggable={false} src={imageUrl} className="block max-h-[65vh] max-w-full" />
      <span
        aria-hidden
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/40"
        style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
      />
    </div>
  );
}

/** A thumbnail of the focal point that opens a large view to place it. */
function FocusPointPicker({
  imageUrl,
  imageAspect,
  slot,
  focus,
  onChange,
}: {
  imageUrl: string;
  imageAspect: number | null;
  slot: number;
  focus: BackgroundFocus;
  onChange: (focus: BackgroundFocus) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Set the focal point, now ${focus.x}% from the left and ${focus.y}% from the top`}
        className="relative h-20 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border bg-no-repeat outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{
          aspectRatio: imageAspect ?? 16 / 9,
          backgroundImage: `url(${JSON.stringify(imageUrl)})`,
          backgroundSize: "100% 100%",
        }}
        onClick={() => setOpen(true)}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/40"
          style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-[min(64rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Focal point for background {slot}</DialogTitle>
            <DialogDescription>
              Click or drag to the part of the image to keep in view. Arrow keys nudge it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center px-6">
            <FocusPointSurface imageUrl={imageUrl} focus={focus} onChange={onChange} />
          </div>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              disabled={
                focus.x === DEFAULT_BACKGROUND_FOCUS.x && focus.y === DEFAULT_BACKGROUND_FOCUS.y
              }
              onClick={() => onChange(DEFAULT_BACKGROUND_FOCUS)}
            >
              Center
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/** Runs an image task with the busy and error state the pickers show. */
export function useImageTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the background.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const BACKGROUND_SLOT_OPTIONS = BACKGROUND_SLOTS.map((slot) => ({
  value: String(slot),
  label: String(slot),
}));

export function ChatBackgroundSettingsSection() {
  const glass = useGlassState();
  const { appearance: a, imageUrl, imageRevision, imageAspect, backgroundSlot } = glass;
  const focus = showingBackgroundFocus(glass);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const flipShortcut = shortcutLabelForCommand(keybindings, "background.flip");
  const previewUrl = useBackgroundEffectUrl(
    imageUrl,
    a.backgroundEffect,
    globalBackgroundSourceKey(imageRevision),
  );
  const { busy, error, run } = useImageTask();

  return (
    <SettingsSection
      id="chat-background"
      title="Chat background"
      description="An image behind your chat panes. It stays on this device."
    >
      <SettingsRow
        title="Background"
        description={`Three backgrounds, each with its own image. ${
          flipShortcut ? `${flipShortcut} steps` : "Background: Flip in Keyboard Shortcuts steps"
        } through them; an empty one shows none.`}
        control={
          <Segmented
            label="Background"
            value={String(backgroundSlot)}
            options={BACKGROUND_SLOT_OPTIONS}
            onChange={(value) => {
              const slot = Number(value);
              if (isBackgroundSlot(slot)) void setChatBackgroundSlot(slot);
            }}
          />
        }
      />
      <BackgroundImagePicker
        imageUrl={previewUrl ?? imageUrl}
        effect={a.backgroundEffect}
        emptyOpacity={a.backgroundEmptyOpacity}
        busy={busy}
        error={error}
        onChoose={(file) => void run(() => setChatBackgroundImage(file))}
        onRemove={() => void run(removeChatBackgroundImage)}
        followFocalPoint
      />
      {imageUrl ? (
        <>
          <SettingsRow
            title="Background effect"
            description={BACKGROUND_EFFECT_DESCRIPTIONS[a.backgroundEffect]}
            resetAction={<ResetButton label="background effect" keys={["backgroundEffect"]} />}
            control={
              <Segmented
                label="Background effect"
                value={a.backgroundEffect}
                options={BACKGROUND_EFFECT_OPTIONS}
                onChange={(effect) => {
                  if (isBackgroundEffect(effect))
                    updateGlassAppearance({ backgroundEffect: effect });
                }}
              />
            }
          />
          <SettingsRow
            title="Focal point"
            description="The part of this background to keep in view; each background has its own. Click the image to place it."
            resetAction={
              focus.x !== DEFAULT_BACKGROUND_FOCUS.x || focus.y !== DEFAULT_BACKGROUND_FOCUS.y ? (
                <SettingResetButton
                  label="focal point"
                  onClick={() => updateBackgroundFocus(DEFAULT_BACKGROUND_FOCUS)}
                />
              ) : null
            }
            control={
              <FocusPointPicker
                imageUrl={imageUrl}
                imageAspect={imageAspect}
                slot={backgroundSlot}
                focus={focus}
                onChange={updateBackgroundFocus}
              />
            }
          />
          {a.backgroundEffect === "gradient-blur" ? (
            <SettingsRow
              title="Dither"
              description="Haze the dithered artwork instead of the original."
              resetAction={<ResetButton label="dither" keys={["hazeDither"]} />}
              control={
                <Switch
                  aria-label="Dither the haze"
                  checked={a.hazeDither}
                  onCheckedChange={(hazeDither) => updateGlassAppearance({ hazeDither })}
                />
              }
            />
          ) : null}
          <SettingsRow
            title="Show on"
            description="Empty sessions only, or every conversation."
            resetAction={<ResetButton label="show on" keys={["backgroundScope"]} />}
            control={
              <Segmented
                label="Show background on"
                value={a.backgroundScope}
                options={BACKGROUND_SCOPE_OPTIONS}
                onChange={(backgroundScope) => updateGlassAppearance({ backgroundScope })}
              />
            }
          />
          <SettingsRow
            title="Empty chat visibility"
            description="Background strength before a chat has messages."
            resetAction={
              <ResetButton label="empty chat visibility" keys={["backgroundEmptyOpacity"]} />
            }
            control={
              <GlassSlider
                id="chat-background-empty-visibility"
                label="Empty chat background visibility"
                value={percent(a.backgroundEmptyOpacity)}
                min={percent(GLASS_LIMITS.backgroundOpacity.min)}
                max={percent(GLASS_LIMITS.backgroundOpacity.max)}
                display={`${percent(a.backgroundEmptyOpacity)}%`}
                onChange={(value) => updateGlassAppearance({ backgroundEmptyOpacity: value / 100 })}
              />
            }
          />
          <SettingsRow
            title="Session visibility"
            description="Background strength once the conversation has messages."
            resetAction={
              <ResetButton label="session visibility" keys={["backgroundSessionOpacity"]} />
            }
            control={
              <GlassSlider
                id="chat-background-session-visibility"
                label="Session background visibility"
                value={percent(a.backgroundSessionOpacity)}
                min={percent(GLASS_LIMITS.backgroundOpacity.min)}
                max={percent(GLASS_LIMITS.backgroundOpacity.max)}
                display={`${percent(a.backgroundSessionOpacity)}%`}
                onChange={(value) =>
                  updateGlassAppearance({ backgroundSessionOpacity: value / 100 })
                }
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
