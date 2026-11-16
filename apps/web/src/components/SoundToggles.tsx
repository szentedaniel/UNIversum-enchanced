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
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { soundStore } from "#stores/sound-store.ts";
import { m } from "#text.ts";

/**
 * The one place the two forms differ. `size`: `icon` is the round sticker
 * button; the menu's `default` is the same height (`min-h-12`), so both stay a
 * thumb-sized target on a phone. Only the compact form moves the label into
 * `aria-label`; the menu writes it out, inside no wrapper of its own.
 */
const FORMS = {
  compact: {
    size: "icon",
    labelled: false,
    wrap: (toggles: ReactNode) => (
      <div className="flex flex-wrap items-center justify-center gap-2">{toggles}</div>
    ),
  },
  menu: {
    size: "default",
    labelled: true,
    wrap: (toggles: ReactNode) => toggles,
  },
} as const;

type Form = (typeof FORMS)[keyof typeof FORMS];

/** The icon a toggle shows while pressed, and while released. */
type IconPair = { pressed: LucideIcon; released: LucideIcon };

const EFFECTS_ICONS: IconPair = { pressed: VolumeX, released: Volume2 };
const MUSIC_ICONS: IconPair = { pressed: Music, released: Music2 };

/** One toggle: the same button in both forms, differing only by the form's size and label placement. */
function SoundButton({
  form,
  testId,
  pressed,
  label,
  icons,
  onToggle,
}: {
  form: Form;
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
      size={form.size}
      aria-label={form.labelled ? undefined : label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onToggle}
    >
      <Icon size={20} strokeWidth={3} aria-hidden />
      {form.labelled ? label : null}
    </Button>
  );
}

export function SoundToggles({ compact = false }: { compact?: boolean }) {
  // Like the single mute before it, `sound-toggle` is pressed while the cues are off.
  const effectsMuted = useStore(soundStore, (state) => state.effectsMuted);
  // The music button is pressed while the music is on.
  const musicOn = useStore(soundStore, (state) => state.musicOn);
  const form = FORMS[compact ? "compact" : "menu"];
  const toggles = (
    <>
      <SoundButton
        form={form}
        testId="sound-toggle"
        pressed={effectsMuted}
        label={effectsMuted ? m.sound_off() : m.sound_on()}
        icons={EFFECTS_ICONS}
        onToggle={() => soundStore.getState().toggleEffectsMuted()}
      />
      <SoundButton
        form={form}
        testId="music-toggle"
        pressed={musicOn}
        label={musicOn ? m.music_on() : m.music_off()}
        icons={MUSIC_ICONS}
        onToggle={() => soundStore.getState().toggleMusicOn()}
      />
    </>
  );
  return form.wrap(toggles);
}
