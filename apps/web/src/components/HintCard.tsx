/**
 * The hint card (spec #180): one short sentence on the concept a first-time
 * Guest meets — an Offer, Quarantine, a Sale, a Doubler or Erasmus pick, the
 * game end — and a dismiss button that remembers the hint as seen for this
 * browser. It is an inline card beside the Decision, never a dialog: it takes
 * no focus, blocks no button and pauses no timer. The screen picks the row
 * through `nextHint`; the card decides which area draws it, so the Game's
 * bottom area and the Sale or pick tray never both show the same hint.
 */
import { X } from "lucide-react";
import { Button } from "#components/ui/button.tsx";
import type { HintId, HintRow } from "#hints/hints.ts";
import { hintStore } from "#stores/hint-store.ts";
import { m } from "#text.ts";

/** Where a hint renders: the Game's bottom area, or the Sale or pick tray. */
export type HintPlace = "bottom" | "tray";

/**
 * The area each concept's hint renders in: an Offer, Quarantine and the game
 * end in the Game's bottom area, a Sale, the Doubler and Erasmus in their
 * tray. Every id has a place, so a new row cannot silently render nowhere.
 */
const PLACES: Record<HintId, HintPlace> = {
  offer: "bottom",
  quarantine: "bottom",
  doubler: "tray",
  erasmus: "tray",
  sale: "tray",
  gameEnd: "bottom",
};

export function HintCard({ hint, place }: { hint: HintRow | null; place: HintPlace }) {
  if (hint === null || PLACES[hint.id] !== place) return null;
  return (
    <aside
      role="note"
      data-testid="hint"
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
