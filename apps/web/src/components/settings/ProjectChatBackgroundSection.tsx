import {
  BACKGROUND_EFFECT_DESCRIPTIONS,
  GLASS_LIMITS,
  isBackgroundEffect,
} from "../../glass/glassAppearance";
import {
  defaultProjectChatBackgroundSettings,
  removeProjectChatBackground,
  setProjectChatBackgroundImage,
  updateProjectChatBackgroundSettings,
  projectBackgroundSourceKey,
  useBackgroundEffectUrl,
  useProjectChatBackground,
} from "../../glass/projectChatBackground";
import {
  BACKGROUND_EFFECT_OPTIONS,
  BACKGROUND_SCOPE_OPTIONS,
  BackgroundImagePicker,
  GlassSlider,
  Segmented,
  useImageTask,
} from "./GlassSettings";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const percent = (value: number) => Math.round(value * 100);

/**
 * A project's own chat background. With an image it overrides the global
 * background on this project's chats; without one the project follows Appearance.
 */
export function ProjectChatBackgroundSection({
  projectKey,
  projectName,
}: {
  projectKey: string;
  projectName: string;
}) {
  const background = useProjectChatBackground(projectKey);
  const settings = background?.settings ?? defaultProjectChatBackgroundSettings();
  const previewUrl = useBackgroundEffectUrl(
    background?.src ?? null,
    settings.effect,
    projectBackgroundSourceKey(background?.revision ?? 0),
  );
  const { busy, error, run } = useImageTask();
  const L = GLASS_LIMITS.backgroundOpacity;

  return (
    <SettingsSection
      id="project-chat-background"
      title="Background image"
      description={`Choose a background image for ${projectName}.`}
    >
      <BackgroundImagePicker
        imageUrl={background ? (previewUrl ?? background.src) : null}
        haze={settings.haze}
        emptyOpacity={settings.emptyOpacity}
        busy={busy}
        error={error}
        emptyLabel="Choose image"
        note={
          background
            ? "This image overrides the global background for this project."
            : "This project currently follows the global Appearance setting."
        }
        onChoose={(file) =>
          void run(() => setProjectChatBackgroundImage(projectKey, file, settings))
        }
        onRemove={() => void run(() => removeProjectChatBackground(projectKey))}
      />
      {background ? (
        <>
          <SettingsRow
            title="Background effect"
            description={BACKGROUND_EFFECT_DESCRIPTIONS[settings.effect]}
            control={
              <Segmented
                label="Project background effect"
                value={settings.effect}
                options={BACKGROUND_EFFECT_OPTIONS}
                onChange={(effect) => {
                  if (isBackgroundEffect(effect))
                    updateProjectChatBackgroundSettings(projectKey, { effect });
                }}
              />
            }
          />
          <SettingsRow
            title="Haze"
            description="Takes the artwork away toward the bottom, in the style set in Appearance."
            control={
              <Switch
                aria-label="Project background haze"
                checked={settings.haze}
                onCheckedChange={(haze) =>
                  updateProjectChatBackgroundSettings(projectKey, { haze })
                }
              />
            }
          />
          <SettingsRow
            title="Show on"
            description="Empty sessions only, or every conversation."
            control={
              <Segmented
                label="Show project background on"
                value={settings.scope}
                options={BACKGROUND_SCOPE_OPTIONS}
                onChange={(scope) => updateProjectChatBackgroundSettings(projectKey, { scope })}
              />
            }
          />
          <SettingsRow
            title="Empty chat visibility"
            description="Background strength before a chat has messages."
            control={
              <GlassSlider
                id="project-background-empty-visibility"
                label="Project empty chat background visibility"
                value={percent(settings.emptyOpacity)}
                min={percent(L.min)}
                max={percent(L.max)}
                display={`${percent(settings.emptyOpacity)}%`}
                onChange={(value) =>
                  updateProjectChatBackgroundSettings(projectKey, { emptyOpacity: value / 100 })
                }
              />
            }
          />
          <SettingsRow
            title="Session visibility"
            description="Background strength once the conversation has messages."
            control={
              <GlassSlider
                id="project-background-session-visibility"
                label="Project session background visibility"
                value={percent(settings.sessionOpacity)}
                min={percent(L.min)}
                max={percent(L.max)}
                display={`${percent(settings.sessionOpacity)}%`}
                onChange={(value) =>
                  updateProjectChatBackgroundSettings(projectKey, { sessionOpacity: value / 100 })
                }
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
