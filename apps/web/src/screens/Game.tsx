import type { FieldId, GameEvent, PhaseOf, PlayerIntent, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useStore } from "zustand";
import { Board } from "#board/Board.tsx";
import { EventToast, MinutePill } from "#components/GameHud.tsx";
import { PlayerCard, PlayerChip, type PlayerSummary } from "#components/PlayerCard.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { sendIntent } from "#connection.ts";
import { useWide } from "#lib/use-media-query.ts";
import { cn } from "#lib/utils.ts";
import { TurnRing } from "#screens/TurnRing.tsx";
import { roomStore } from "#stores/room-store.ts";
import { uiStore } from "#stores/ui-store.ts";
import { chanceCardText, fieldName, formatMoney, m, playerName, rejectionText } from "#text.ts";

/** The newest event worth a toast, as text. */
function describe(event: GameEvent, view: PublicView): string | null {
  const name = (id: string) => {
    const player = view.players.find((p) => p.id === id);
    return player ? playerName(player.name) : "";
  };
  switch (event.type) {
    case "DiceRolled":
      return m.event_dice_rolled({
        name: name(event.player),
        first: event.dice[0],
        second: event.dice[1],
      });
    case "RoundBonusPaid":
      return m.event_round_bonus({ name: name(event.player), amount: formatMoney(event.amount) });
    case "TimedOut":
      return m.event_timed_out({ name: name(event.player) });
    case "TimeoutPenaltyPaid":
      return m.event_timeout_penalty({
        name: name(event.player),
        amount: formatMoney(event.amount),
      });
    case "TurnPassed":
      return m.event_turn_passed({ name: name(event.player) });
    case "LevelBought":
      return m.event_level_bought({
        name: name(event.player),
        field: fieldName(FIELDS[event.field]?.key ?? ""),
        level: event.level,
        price: formatMoney(event.price),
      });
    case "OfferDeclined":
      return m.event_offer_declined({
        name: name(event.player),
        field: fieldName(FIELDS[event.field]?.key ?? ""),
      });
    case "RentPaid":
      return m.event_rent_paid({
        name: name(event.player),
        owner: name(event.owner),
        amount: formatMoney(event.amount),
      });
    case "CardDrawn":
      return m.event_card_drawn({ name: name(event.player), ...chanceCardText(event.card) });
    case "ChanceMoneyReceived":
      return m.event_chance_money_received({
        name: name(event.player),
        amount: formatMoney(event.amount),
      });
    case "ChanceChargePaid":
      return m.event_chance_charge_paid({
        name: name(event.player),
        amount: formatMoney(event.amount),
      });
    case "TaxPaid":
      return m.event_tax_paid({ name: name(event.player), amount: formatMoney(event.amount) });
    default:
      return null;
  }
}

export function Game() {
  const { code = "" } = useParams();
  const push = useStore(roomStore, (s) => (s.code === code ? s.push : null));
  const me = useStore(roomStore, (s) => s.me);
  const status = useStore(roomStore, (s) => s.status);
  const rejection = useStore(roomStore, (s) => s.rejection);
  const selectedField = useStore(uiStore, (s) => s.selectedField);
  // No optimistic UI: after a tap the control stays hidden until the next push or a Rejection.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const wide = useWide();

  if (!push) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="m-0 font-bold">
          {status === "connecting" ? m.connecting() : m.connection_lost()}
        </p>
        <Link to="/" className={buttonVariants({ variant: "plain" })}>
          {m.back_home()}
        </Link>
      </main>
    );
  }

  const { view, events } = push;
  const current = view.players.find((p) => p.id === view.currentPlayer);
  const myTurn = view.currentPlayer === me;
  const answeredAt = Math.max(push.seq, rejection?.seq ?? 0);
  const pending = sentAt !== null && answeredAt <= sentAt;
  const canRoll = myTurn && view.phase.kind === "awaitingRoll" && !pending;
  const offer = myTurn && view.phase.kind === "offer" && !pending ? view.phase : null;
  // One toast at a time: the first event of the push worth one.
  const toast = events.map((event) => describe(event, view)).find((text) => text !== null);
  const selected = selectedField === null ? null : FIELDS[selectedField];

  function send(intent: PlayerIntent) {
    setSentAt(answeredAt);
    sendIntent(intent);
  }

  const players: PlayerSummary[] = view.players.map((p) => ({
    seat: p.seat,
    name: playerName(p.name),
    cash: formatMoney(p.cash),
    fields: view.fields.filter((field) => field.owner === p.id).length,
    current: p.id === view.currentPlayer,
    you: p.id === me,
    bankrupt: p.bankrupt,
    ring: p.id === view.currentPlayer && (
      <TurnRing
        key={`${view.turn}:${view.turnDeadline}`}
        timer={view.turnTimer}
        clockOffset={push.clockOffset}
      />
    ),
  }));
  const rejected = rejection !== null && rejection.seq > push.seq;

  const statusRow = (
    <>
      <MinutePill endsAt={view.endsAt} />
      <EventToast
        key={rejected ? `r${rejection.seq}` : push.seq}
        tone={rejected ? "bad" : "neutral"}
      >
        {rejected ? rejectionText(rejection.code) : toast}
      </EventToast>
    </>
  );

  // The card (later: the Field card or the pick tray) at the bottom.
  const card = (
    <Card className="gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <strong data-testid="turn-of" className="truncate text-lg font-black">
          {myTurn
            ? m.game_your_turn()
            : m.game_turn_of({ name: current ? playerName(current.name) : "" })}
        </strong>
        <span data-testid="turn" className="tnum shrink-0 text-sm font-bold text-ink/70">
          {m.game_turn({ turn: view.turn })}
        </span>
      </div>
      {selected && <FieldDetails view={view} field={selected.id} />}
      {canRoll && (
        <Button size="lg" onClick={() => send({ type: "Roll", turn: view.turn })}>
          {m.game_roll()}
        </Button>
      )}
      {offer && (
        <OfferPanel
          view={view}
          offer={offer}
          onBuy={(level) => send({ type: "BuyLevel", turn: view.turn, level })}
          onDecline={() => send({ type: "DeclineOffer", turn: view.turn })}
        />
      )}
    </Card>
  );

  if (wide) {
    return (
      <main className="board-backdrop fixed inset-0 overflow-hidden">
        {/* The Board's fit area: clear of the corner cards, the status row and the card. */}
        <div className="absolute inset-x-[110px] top-[110px] bottom-[200px]">
          <Board />
        </div>
        <ul className="contents" aria-label={m.game_players()}>
          {players.map((player) => (
            <PlayerCard
              key={player.seat}
              player={player}
              className={cn("absolute", CORNERS[player.seat], player.current && "z-10")}
            />
          ))}
        </ul>
        <div className="absolute top-6 left-1/2 flex w-[calc(100%-600px)] -translate-x-1/2 items-center justify-center gap-2">
          {statusRow}
        </div>
        <div className="absolute bottom-3 left-1/2 w-[min(440px,calc(100%-600px))] -translate-x-1/2">
          {card}
        </div>
      </main>
    );
  }

  return (
    <main className="board-backdrop fixed inset-0 flex flex-col overflow-hidden pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))]">
      <ul className="m-0 flex list-none justify-center gap-1.5 px-2" aria-label={m.game_players()}>
        {players.map((player) => (
          <PlayerChip key={player.seat} player={player} className="w-0 max-w-28 flex-1" />
        ))}
      </ul>
      <div className="mt-2 flex min-w-0 items-center justify-center gap-2 px-2">{statusRow}</div>
      <div className="relative min-h-0 flex-1">
        <Board />
      </div>
      <div className="px-2">{card}</div>
    </main>
  );
}

/** Desktop corner of each Seat, clockwise from top left. */
const CORNERS = ["top-3 left-3", "top-3 right-3", "right-3 bottom-3", "bottom-3 left-3"];

/** The tapped Field: its name, and for a University its owner, Level, Value and Rent. */
function FieldDetails({ view, field }: { view: PublicView; field: FieldId }) {
  const info = FIELDS[field];
  const state = view.fields[field];
  if (!info || !state) return null;
  const owner = view.players.find((p) => p.id === state.owner);
  return (
    <div>
      <p className="m-0 font-display text-xl" data-testid="selected-field">
        {fieldName(info.key)}
      </p>
      {info.kind === "university" && (
        <p className="tnum m-0 text-sm font-bold text-ink/70" data-testid="field-numbers">
          {owner
            ? [
                playerName(owner.name),
                m.field_level({ level: state.level }),
                m.field_value({ amount: formatMoney(state.value) }),
                m.field_rent({ amount: formatMoney(state.rent) }),
              ].join(" · ")
            : m.field_unowned()}
        </p>
      )}
    </div>
  );
}

/** The buy/build offer: one button per affordable Level with its price, and Decline. */
function OfferPanel({
  view,
  offer,
  onBuy,
  onDecline,
}: {
  view: PublicView;
  offer: PhaseOf<"offer">;
  onBuy: (level: number) => void;
  onDecline: () => void;
}) {
  const field = fieldName(FIELDS[offer.field]?.key ?? "");
  const own = view.fields[offer.field]?.owner === view.currentPlayer;
  const title = own ? m.offer_build({ field }) : m.offer_buy({ field });
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid="offer">
      <h2 className="m-0 font-display text-xl font-normal">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {offer.levels.map(({ level, price }) => (
          <Button key={level} className="tnum" onClick={() => onBuy(level)}>
            {m.offer_level({ level, price: formatMoney(price) })}
          </Button>
        ))}
        <Button variant="plain" onClick={onDecline}>
          {m.offer_decline()}
        </Button>
      </div>
    </section>
  );
}
