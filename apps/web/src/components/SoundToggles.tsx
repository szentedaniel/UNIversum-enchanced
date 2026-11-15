/**
 * The two sound settings (#243): one button flips the cues, the other the
 * background music. Both write their own stored choice; the music starts from
 * the tap that turns it on, so it needs no extra gesture.
 */
import { Music, Music2, Volume2, VolumeX } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { soundStore } from "#stores/sound-store.ts";
import { m } from "#text.ts";

export function SoundToggles() {
  // Like the single mute before it, `sound-toggle` is pressed while the cues are off.
  const effectsMuted = useStore(soundStore, (state) => state.effectsMuted);
  // The music button is pressed while the music is on.
  const musicOn = useStore(soundStore, (state) => state.musicOn);
  return (
    <>
      <Button
        variant="plain"
        aria-pressed={effectsMuted}
        data-testid="sound-toggle"
        onClick={() => soundStore.getState().toggleEffectsMuted()}
      >
        {effectsMuted ? (
          <VolumeX size={20} strokeWidth={3} aria-hidden />
        ) : (
          <Volume2 size={20} strokeWidth={3} aria-hidden />
        )}
        {effectsMuted ? m.sound_off() : m.sound_on()}
      </Button>
      <Button
        variant="plain"
        aria-pressed={musicOn}
        data-testid="music-toggle"
        onClick={() => soundStore.getState().toggleMusicOn()}
      >
        {musicOn ? (
          <Music size={20} strokeWidth={3} aria-hidden />
        ) : (
          <Music2 size={20} strokeWidth={3} aria-hidden />
        )}
        {musicOn ? m.music_on() : m.music_off()}
      </Button>
    </>
  );
}
