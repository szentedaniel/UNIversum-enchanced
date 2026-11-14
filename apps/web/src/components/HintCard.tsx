/**
 * The hint card (spec #180): one short sentence on the concept a first-time
 * Guest meets — an Offer, Quarantine, a Sale — and a dismiss button that
 * remembers the hint as seen for this browser. It is an inline card beside the
 * Decision, never a dialog: it takes no focus, blocks no button and pauses no
 * timer. The screen picks the row through `nextHint` and decides where it
 * renders, the Game's bottom area or the Sale tray.
 */
import { X } from "lucide-react";
import { Button } from "#components/ui/button.tsx";
import type { HintRow } from "#hints/hints.ts";
import { hintStore } from "#stores/hint-store.ts";
import { m } from "#text.ts";

export function HintCard({ hint }: { hint: HintRow | null }) {
  if (hint === null) return null;
  return (
    <aside
      data-testid="hint-card"
      data-hint={hint.id}
      data-board-obstacle
      className="sticker flex items-start gap-2 rounded-ui bg-card p-2.5 text-card-foreground"
    >
      <p className="m-0 flex-1 self-center text-sm font-bold">{m[hint.messageKey]()}</p>
      <Button
        variant="plain"
        size="icon-sm"
        className="min-h-11 min-w-11 shrink-0"
        aria-label={m.hint_dismiss()}
        data-testid="hint-dismiss"
        onClick={() => hintStore.getState().dismiss(hint.id)}
      >
        <X size={18} strokeWidth={3} aria-hidden />
      </Button>
    </aside>
  );
}
