/**
 * A drawn Chance card, shown as a card for its Playback step (ADR-0004): its
 * title and text in the active language. The close control hides it on this
 * screen only — the Playback keeps running, so closing it gains no time and
 * reading it loses none. The effect (money, a Charge, a PCR test) follows as
 * the next step of the same Playback.
 */
import type { ChanceCardId } from "@universum/rules/board";
import { useState } from "react";
import { Button } from "#components/ui/button.tsx";
import { chanceCardText, m } from "#text.ts";

export function ChanceCardOverlay({ card }: { card: ChanceCardId }) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  const { title, text } = chanceCardText(card);
  return (
    <section
      data-testid="chance-card"
      aria-label={title}
      className="pop-in sticker pointer-events-auto flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-ui bg-card p-4 text-card-foreground"
    >
      <header className="text-center">
        <p className="m-0 text-xs font-extrabold text-primary uppercase">{m.field_chance()}</p>
        <h2 className="m-0 font-display text-2xl leading-tight font-normal">{title}</h2>
      </header>
      <p className="m-0 text-center text-base font-bold">{text}</p>
      <Button variant="accent" aria-label={m.chance_card_close()} onClick={() => setClosed(true)}>
        {m.chance_card_close()}
      </Button>
    </section>
  );
}
