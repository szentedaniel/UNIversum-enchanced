/**
 * The quick-chat tray (#176, #231): the protocol catalogue's lines and emotes,
 * one tap each, and no text input, so nobody can type anything into a Room. A
 * tap sends the id and closes the tray; the buttons then refuse a second send
 * for `CHAT_COOLDOWN_MS`, so a normal Guest rarely meets the server's
 * `SLOW_DOWN`. `Game` mounts it only for a seated Guest in a running game (see
 * `chatOpenTo`), through one call site so #232's mute gate is one condition.
 */
import { CHAT_EMOTES, CHAT_LINES, type ChatId } from "@universum/protocol/messages";
import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { bubbleOf } from "#chat/catalogue.ts";
import { CLOSED_TRAY, closeTray, cooldownOver, openTray, tapChat } from "#chat/tray.ts";
import { Button } from "#components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog.tsx";
import { sendChat } from "#connection.ts";
import { cn } from "#lib/utils.ts";
import { CHAT_COOLDOWN_MS } from "#stores/chat-store.ts";
import { m } from "#text.ts";

type Send = (id: ChatId) => void;

/** One catalogue entry as a send button: a line's text, or an emote's glyph under its label. */
function ChatChoice({ id, cooling, onPick }: { id: ChatId; cooling: boolean; onPick: Send }) {
  const face = bubbleOf(id);
  return (
    <Button
      variant="plain"
      size={face.kind === "line" ? "sm" : "icon-sm"}
      disabled={cooling}
      aria-label={face.kind === "emote" ? face.label : undefined}
      data-testid={`chat-send-${id}`}
      className={cn(
        "min-h-11",
        face.kind === "line"
          ? "h-auto justify-start text-left whitespace-normal"
          : "size-11 text-xl leading-none",
      )}
      onClick={() => onPick(id)}
    >
      {face.kind === "line" ? (
        face.text
      ) : (
        <span aria-hidden className="leading-none">
          {face.glyph}
        </span>
      )}
    </Button>
  );
}

/** The tray's body: every line, then every emote, each id once. */
export function ChatChoices({ cooling, onPick }: { cooling: boolean; onPick: Send }) {
  return (
    <>
      <section className="flex flex-col gap-2" aria-label={m.chat_lines()}>
        <h3 className="m-0 text-sm font-black text-ink/70">{m.chat_lines()}</h3>
        <div className="grid grid-cols-2 gap-2">
          {CHAT_LINES.map((id) => (
            <ChatChoice key={id} id={id} cooling={cooling} onPick={onPick} />
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2" aria-label={m.chat_emotes()}>
        <h3 className="m-0 text-sm font-black text-ink/70">{m.chat_emotes()}</h3>
        <div className="flex flex-wrap gap-2">
          {CHAT_EMOTES.map((id) => (
            <ChatChoice key={id} id={id} cooling={cooling} onPick={onPick} />
          ))}
        </div>
      </section>
    </>
  );
}

/**
 * The quick-chat toggle and its tray. The dialog closes on Escape, an outside
 * tap and its own close button; `send` is `sendChat` in the game and a spy in
 * a test.
 */
export function ChatTray({ send = sendChat }: { send?: Send }) {
  const [tray, setTray] = useState(CLOSED_TRAY);
  // One timer for the cooldown: it re-enables the buttons without a clock read in render.
  useEffect(() => {
    if (!tray.cooling) return undefined;
    const timer = setTimeout(() => setTray(cooldownOver), CHAT_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [tray.cooling]);
  return (
    <Dialog
      open={tray.open}
      onOpenChange={(open) => setTray((current) => (open ? openTray(current) : closeTray(current)))}
    >
      <DialogTrigger
        render={
          <Button
            variant="plain"
            size="icon"
            aria-label={m.chat_open()}
            data-testid="chat-toggle"
            className="size-10"
          />
        }
      >
        <MessageCircle size={20} strokeWidth={3} aria-hidden />
      </DialogTrigger>
      <DialogContent closeLabel={m.chat_close()} className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{m.chat_open()}</DialogTitle>
        </DialogHeader>
        <ChatChoices cooling={tray.cooling} onPick={(id) => setTray(tapChat(tray, id, send))} />
      </DialogContent>
    </Dialog>
  );
}
