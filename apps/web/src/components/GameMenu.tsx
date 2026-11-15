/**
 * The in-game menu: the language picker, the sound toggles, the hints switch
 * and list, and the quick-chat mute. A language switch reloads the page and
 * rejoins the Seat by Guest token; the sound, the quick-chat and the hints
 * choices are remembered separately. The six hint texts make the body long on a
 * phone, so the dialog scrolls.
 */
import { Lightbulb, LightbulbOff, Menu, MessageCircle, MessageCircleOff } from "lucide-react";
import { useStore } from "zustand";
import { LanguagePicker } from "#components/LanguagePicker.tsx";
import { SoundToggles } from "#components/SoundToggles.tsx";
import { Button } from "#components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog.tsx";
import { HINTS } from "#hints/hints.ts";
import { chatMuteStore } from "#stores/chat-mute-store.ts";
import { hintStore } from "#stores/hint-store.ts";
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

/** The hints switch: off hides every hint on this device (#257). */
export function HintsToggle() {
  const enabled = useStore(hintStore, (state) => state.enabled);
  return (
    <Button
      variant="plain"
      aria-pressed={enabled}
      data-testid="hints-toggle"
      onClick={() => hintStore.getState().setEnabled(!enabled)}
    >
      {enabled ? (
        <Lightbulb size={20} strokeWidth={3} aria-hidden />
      ) : (
        <LightbulbOff size={20} strokeWidth={3} aria-hidden />
      )}
      {enabled ? m.hints_on() : m.hints_off()}
    </Button>
  );
}

/** Every hint's text, seen or not, so the Guest can re-read one; and the reset. */
export function HintList() {
  return (
    <section className="flex flex-col gap-2" aria-label={m.hints_list_title()}>
      <h3 className="m-0 text-sm font-black text-ink/70">{m.hints_list_title()}</h3>
      <ul
        data-testid="hint-list"
        className="m-0 flex list-none flex-col gap-2 p-0 text-sm font-bold"
      >
        {HINTS.map((row) => (
          <li key={row.id}>{m[row.messageKey]()}</li>
        ))}
      </ul>
      <Button
        variant="plain"
        data-testid="hints-reset"
        onClick={() => hintStore.getState().reset()}
      >
        {m.hints_reset()}
      </Button>
    </section>
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{m.menu_title()}</DialogTitle>
        </DialogHeader>
        <section className="flex flex-col gap-2" aria-label={m.language()}>
          <h3 className="m-0 text-sm font-black text-ink/70">{m.language()}</h3>
          <LanguagePicker />
        </section>
        <SoundToggles />
        <HintsToggle />
        <ChatMuteToggle />
        <HintList />
      </DialogContent>
    </Dialog>
  );
}
