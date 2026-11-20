/**
 * The two sound settings (#243): one button flips the cues, the other the
 * background music. Both write their own stored choice; the music starts from
 * the tap that turns it on, so it needs no extra gesture.
 *
 * `compact` is Home's form (#244): icon-sized buttons that carry the label in
 * `aria-label` instead, in one row that wraps on a phone. The menu keeps the
 * full-width form with the labels written out.
 */
import { Music, Music2, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { soundStore } from "#stores/sound-store.ts";
import { m } from "#text.ts";

/** The icon a toggle shows while pressed, and while released. */
type IconPair = { pressed: LucideIcon; released: LucideIcon };

const EFFECTS_ICONS: IconPair = { pressed: VolumeX, released: Volume2 };
const MUSIC_ICONS: IconPair = { pressed: Music, released: Music2 };

/**
 * One toggle: the same button in both forms, differing only by size and by
 * where the label goes. `iconOnly` is Home's compact sticker: an icon-sized
 * round button whose label is carried in `aria-label` only. The menu's full
 * form writes the label out at the Button's `default` size, the same height
 * (`min-h-12`), so both stay a thumb-sized target on a phone.
 */
function SoundButton({
  iconOnly,
  testId,
  pressed,
  label,
  icons,
  onToggle,
}: {
  iconOnly: boolean;
  testId: string;
  pressed: boolean;
  label: string;
  icons: IconPair;
  onToggle: () => void;
}) {
  const Icon = pressed ? icons.pressed : icons.released;
  return (
    <Button
      variant="plain"
      size={iconOnly ? "icon" : "default"}
      aria-label={iconOnly ? label : undefined}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onToggle}
    >
      <Icon size={20} strokeWidth={3} aria-hidden />
      {iconOnly ? null : label}
    </Button>
  );
}

export function SoundToggles({ compact = false }: { compact?: boolean }) {
  // Like the single mute before it, `sound-toggle` is pressed while the cues are off.
  const effectsMuted = useStore(soundStore, (state) => state.effectsMuted);
  // The music button is pressed while the music is on.
  const musicOn = useStore(soundStore, (state) => state.musicOn);
  const toggles = (
    <>
      <SoundButton
        iconOnly={compact}
        testId="sound-toggle"
        pressed={effectsMuted}
        label={effectsMuted ? m.sound_off() : m.sound_on()}
        icons={EFFECTS_ICONS}
        onToggle={() => soundStore.getState().toggleEffectsMuted()}
      />
      <SoundButton
        iconOnly={compact}
        testId="music-toggle"
        pressed={musicOn}
        label={musicOn ? m.music_on() : m.music_off()}
        icons={MUSIC_ICONS}
        onToggle={() => soundStore.getState().toggleMusicOn()}
      />
    </>
  );
  return compact ? (
    <div className="flex flex-wrap items-center justify-center gap-2">{toggles}</div>
  ) : (
    toggles
  );
}
