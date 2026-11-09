/**
 * The Turn card (#125): the Turn's heading and number (held through the
 * Playback, ADR-0004 story 4), another Player's Sale or pick as a waiting line,
 * and this client's Roll, Offer and Quarantine controls. It sends their intents
 * itself; `Game` only decides that the bottom slot shows it.
 */
import type { PhaseOf, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import { useStore } from "zustand";
import { Card } from "#components/ui/card.tsx";
import { Button } from "#components/ui/button.tsx";
import { sendIntent } from "#connection.ts";
import type { OpenDecision } from "#decision/decision.ts";
import type { TurnLabel } from "#playback/playback.ts";
import { roomStore } from "#stores/room-store.ts";
import { fieldName, formatMoney, m, playerName } from "#text.ts";

type Props = {
  view: PublicView;
  /** The open Decision; only this client's Roll, Offer and Quarantine are the card's. */
  decision: OpenDecision | null;
  /** The held Turn label: the heading and number before the gate opens. */
  shownTurn: TurnLabel;
  /** Another Player's Sale or pick, as the card's waiting line. */
  waiting: "sale" | "pick" | null;
};

const quarantineRoundsOf = (view: PublicView, playerId: string): number =>
  view.players.find((player) => player.id === playerId)?.quarantineRounds ?? 0;

export function TurnCard({ view, decision, shownTurn, waiting }: Props) {
  const me = useStore(roomStore, (state) => state.me);
  const current = view.players.find((player) => player.id === view.currentPlayer);
  const shownPlayer =
    view.players.find((player) => player.id === shownTurn.currentPlayer) ?? current;
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <strong data-testid="turn-of" className="truncate text-lg font-black">
          {shownTurn.currentPlayer === me
            ? m.game_your_turn()
            : m.game_turn_of({ name: shownPlayer ? playerName(shownPlayer.name) : "" })}
        </strong>
        <span data-testid="turn" className="tnum shrink-0 text-sm font-bold text-ink/70">
          {m.game_turn({ turn: shownTurn.turn })}
        </span>
      </div>
      {waiting === "sale" && (
        <p className="m-0 text-sm font-bold text-ink/70" data-testid="sale-waiting">
          {m.sale_waiting({ name: current ? playerName(current.name) : "" })}
        </p>
      )}
      {waiting === "pick" && (
        <p className="m-0 text-sm font-bold text-ink/70" data-testid="pick-waiting">
          {m.pick_waiting({ name: current ? playerName(current.name) : "" })}
        </p>
      )}
      {decision?.kind === "roll" && (
        <Button size="lg" onClick={() => sendIntent({ type: "Roll", turn: view.turn })}>
          {m.game_roll()}
        </Button>
      )}
      {decision?.kind === "offer" && <OfferPanel view={view} offer={decision.offer} />}
      {decision?.kind === "quarantine" && (
        <section className="flex flex-col gap-2" aria-label={m.field_quarantine()}>
          <p className="m-0 text-sm font-bold text-ink/70">
            {m.game_quarantine_rounds({ rounds: quarantineRoundsOf(view, view.currentPlayer) })}
          </p>
          <Button size="lg" onClick={() => sendIntent({ type: "RollForTwelve", turn: view.turn })}>
            {m.game_roll_for_twelve()}
          </Button>
          <div className="flex flex-wrap gap-2">
            {decision.choice.canBuyPcrTest && (
              <Button
                variant="plain"
                className="flex-1"
                onClick={() => sendIntent({ type: "BuyPcrTest", turn: view.turn })}
              >
                {m.game_buy_pcr_test({ price: formatMoney(decision.choice.pcrTestPrice) })}
              </Button>
            )}
            {decision.choice.canUsePcrTest && (
              <Button
                variant="accent"
                className="flex-1"
                onClick={() => sendIntent({ type: "UsePcrTest", turn: view.turn })}
              >
                {m.game_use_pcr_test()}
              </Button>
            )}
          </div>
        </section>
      )}
    </Card>
  );
}

/**
 * The offer: one button per affordable Level with its price, or the Museum
 * buy, or the Buyout, and Decline. The phase lists what is on offer.
 */
function OfferPanel({ view, offer }: { view: PublicView; offer: PhaseOf<"offer"> }) {
  const field = fieldName(FIELDS[offer.field]?.key ?? "");
  const own = view.fields[offer.field]?.owner === view.currentPlayer;
  const title =
    offer.buyout !== undefined
      ? m.offer_buyout_title({ field })
      : own
        ? m.offer_build({ field })
        : m.offer_buy({ field });
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid="offer">
      <h2 className="m-0 font-display text-xl font-normal">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {offer.levels.map(({ level, price }) => (
          <Button
            key={level}
            className="tnum"
            onClick={() => sendIntent({ type: "BuyLevel", turn: view.turn, level })}
          >
            {m.offer_level({ level, price: formatMoney(price) })}
          </Button>
        ))}
        {offer.museum !== undefined && (
          <Button
            className="tnum"
            onClick={() => sendIntent({ type: "BuyMuseum", turn: view.turn })}
          >
            {m.offer_museum({ price: formatMoney(offer.museum) })}
          </Button>
        )}
        {offer.buyout !== undefined && (
          <Button className="tnum" onClick={() => sendIntent({ type: "Buyout", turn: view.turn })}>
            {m.offer_buyout({ price: formatMoney(offer.buyout) })}
          </Button>
        )}
        <Button
          variant="plain"
          onClick={() => sendIntent({ type: "DeclineOffer", turn: view.turn })}
        >
          {m.offer_decline()}
        </Button>
      </div>
    </section>
  );
}
