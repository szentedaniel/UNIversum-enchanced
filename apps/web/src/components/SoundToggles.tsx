/**
 * The two sound settings (#243): one button flips the cues, the other the
 * background music. Both write their own stored choice; the music starts from
 * the tap that turns it on, so it needs no extra gesture.
 *
 * `compact` is Home's form (#244): icon-sized buttons that carry the label in
 * `aria-label` instead, in one row that wraps on a phone. The menu keeps the
 * full-width form with the labels written out.
 */
import { Music, Music2, Volume2, VolumeX } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { soundStore } from "#stores/sound-store.ts";
import { m } from "#text.ts";

export function SoundToggles({ compact = false }: { compact?: boolean }) {
  // Like the single mute before it, `sound-toggle` is pressed while the cues are off.
  const effectsMuted = useStore(soundStore, (state) => state.effectsMuted);
  // The music button is pressed while the music is on.
  const musicOn = useStore(soundStore, (state) => state.musicOn);
  const effectsLabel = effectsMuted ? m.sound_off() : m.sound_on();
  const musicLabel = musicOn ? m.music_on() : m.music_off();
  // `icon-sm` is the height of the language pills beside it on Home.
  const size = compact ? "icon-sm" : "default";
  const toggles = (
    <>
      <Button
        variant="plain"
        size={size}
        aria-label={compact ? effectsLabel : undefined}
        aria-pressed={effectsMuted}
        data-testid="sound-toggle"
        onClick={() => soundStore.getState().toggleEffectsMuted()}
      >
        {effectsMuted ? (
          <VolumeX size={20} strokeWidth={3} aria-hidden />
        ) : (
          <Volume2 size={20} strokeWidth={3} aria-hidden />
        )}
        {compact ? null : effectsLabel}
      </Button>
      <Button
        variant="plain"
        size={size}
        aria-label={compact ? musicLabel : undefined}
        aria-pressed={musicOn}
        data-testid="music-toggle"
        onClick={() => soundStore.getState().toggleMusicOn()}
      >
        {musicOn ? (
          <Music size={20} strokeWidth={3} aria-hidden />
        ) : (
          <Music2 size={20} strokeWidth={3} aria-hidden />
        )}
        {compact ? null : musicLabel}
      </Button>
    </>
  );
  if (!compact) return toggles;
  return <div className="flex flex-wrap items-center justify-center gap-2">{toggles}</div>;
}
