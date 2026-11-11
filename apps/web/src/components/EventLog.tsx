/**
 * The Event log (#182): a sticker button beside the menu opens the lines of
 * the events the Playback has revealed so far, newest last. The list is
 * client-side history only — the log store appends it across pushes and
 * `reset()` clears it with the Room — and each line was fixed in the language
 * it was appended in.
 */
import { ScrollText } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog.tsx";
import { logStore } from "#stores/log-store.ts";
import { m } from "#text.ts";

export function EventLog() {
  const lines = useStore(logStore, (state) => state.lines);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="plain"
            size="icon"
            aria-label={m.log_toggle()}
            data-testid="event-log"
            className="size-10"
          />
        }
      >
        <ScrollText size={20} strokeWidth={3} aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.log_title()}</DialogTitle>
        </DialogHeader>
        <div
          role="log"
          aria-label={m.log_title()}
          aria-relevant="additions"
          data-testid="event-log-lines"
          className="-mx-1 max-h-[60vh] overflow-y-auto px-1"
        >
          {lines.length === 0 ? (
            <p className="m-0 text-sm font-bold text-ink/70">{m.log_empty()}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm font-bold">
              {lines.map((line) => (
                <li key={`${line.seq}:${line.index}`}>{line.text}</li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
