/**
 * The in-game menu: the language picker, the two sound toggles and the
 * quick-chat mute. A language switch reloads the page and rejoins the Seat by
 * Guest token; the sound, the music and the quick-chat choices are remembered
 * separately.
 */
import { Menu, MessageCircle, MessageCircleOff } from "lucide-react";
import { useStore } from "zustand";
import { SoundToggles } from "#components/SoundToggles.tsx";
import { LanguagePicker } from "#components/LanguagePicker.tsx";
import { Button } from "#components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog.tsx";
import { chatMuteStore } from "#stores/chat-mute-store.ts";
import { m } from "#text.ts";

/** The quick-chat mute toggle: it hides the tray and every bubble on this device (#232). */
export function ChatMuteToggle() {
  const muted = useStore(chatMuteStore, (s) => s.muted);
  return (
    <Button
      variant="plain"
      aria-pressed={muted}
      data-testid="chat-toggle-mute"
      onClick={() => chatMuteStore.getState().toggleMuted()}
    >
      {muted ? (
        <MessageCircleOff size={20} strokeWidth={3} aria-hidden />
      ) : (
        <MessageCircle size={20} strokeWidth={3} aria-hidden />
      )}
      {muted ? m.chat_off() : m.chat_on()}
    </Button>
  );
}

export function GameMenu() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="plain"
            size="icon"
            aria-label={m.menu()}
            data-testid="game-menu"
            className="size-10"
          />
        }
      >
        <Menu size={20} strokeWidth={3} aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.menu_title()}</DialogTitle>
        </DialogHeader>
        <section className="flex flex-col gap-2" aria-label={m.language()}>
          <h3 className="m-0 text-sm font-black text-ink/70">{m.language()}</h3>
          <LanguagePicker />
        </section>
        <SoundToggles />
        <ChatMuteToggle />
      </DialogContent>
    </Dialog>
  );
}
