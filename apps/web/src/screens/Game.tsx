import type { GameEvent, PhaseOf, PlayerIntent, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import type { RejectionCode } from "@universum/protocol/messages";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useStore } from "zustand";
import { Board } from "#board/Board.tsx";
import { FieldCard } from "#board/FieldCard.tsx";
import { EventToast, MinutePill } from "#components/GameHud.tsx";
import { PlayerCard, PlayerChip, type PlayerSummary } from "#components/PlayerCard.tsx";
import { Podium } from "#components/Podium.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { ReconnectOverlay } from "#components/ReconnectOverlay.tsx";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { useWide } from "#lib/use-media-query.ts";
import { cn } from "#lib/utils.ts";
import { saleFor } from "#pick/sale.ts";
import { SaleTray } from "#screens/SaleTray.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { roomStore } from "#stores/room-store.ts";
import { salePicksFor, uiStore } from "#stores/ui-store.ts";
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
    case "MuseumBought":
      return m.event_museum_bought({
        name: name(event.player),
        field: fieldName(FIELDS[event.field]?.key ?? ""),
        price: formatMoney(event.price),
      });
    case "BoughtOut":
      return m.event_bought_out({
        name: name(event.player),
        owner: name(event.owner),
        field: fieldName(FIELDS[event.field]?.key ?? ""),
        price: formatMoney(event.price),
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
    case "QuarantineEntered":
      return m.event_quarantine_entered({ name: name(event.player), rounds: event.rounds });
    case "QuarantineRoundUsed":
      return m.event_quarantine_round_used({
        name: name(event.player),
        rounds: event.roundsLeft,
      });
    case "QuarantineReleased":
      return m.event_quarantine_released({ name: name(event.player) });
    case "PcrTestBought":
      return m.event_pcr_test_bought({
        name: name(event.player),
        amount: formatMoney(event.amount),
      });
    case "PcrTestUsed":
      return m.event_pcr_test_used({ name: name(event.player) });
    case "FieldsSold":
      return (event.auto ? m.event_auto_sold : m.event_fields_sold)({
        name: name(event.player),
        amount: formatMoney(event.amount),
      });
    case "WentBankrupt":
      return m.event_went_bankrupt({ name: name(event.player) });
    case "GameEnded":
      return m.event_game_ended({ name: name(event.winner) });
    default:
      return null;
  }
}

/**
 * Steps with no choice that a Player must notice (spec: acknowledgements are
 * events, not clicks). They take the toast ahead of routine events in the
 * same push, such as the dice that led there.
 */
const NOTICES = new Set<GameEvent["type"]>([
  "QuarantineEntered",
  "QuarantineRoundUsed",
  "QuarantineReleased",
  "PcrTestBought",
  "PcrTestUsed",
  "RentPaid",
  "CardDrawn",
  "TaxPaid",
  "WentBankrupt",
  "GameEnded",
]);

const quarantineRoundsOf = (view: PublicView, playerId: string): number =>
  view.players.find((p) => p.id === playerId)?.quarantineRounds ?? 0;

export function Game() {
  const { code = "" } = useParams();
  const push = useStore(roomStore, (s) => (s.code === code ? s.push : null));
  const me = useStore(roomStore, (s) => s.me);
  const status = useStore(roomStore, (s) => s.status);
  const rejection = useStore(roomStore, (s) => s.rejection);
  const selectedField = useStore(uiStore, (s) => s.selectedField);
  const salePicks = useStore(uiStore, (s) => s.salePicks);
  // No optimistic UI: after a tap the control stays hidden until the next push or a Rejection.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const wide = useWide();
  const [joinError, setJoinError] = useState<RejectionCode | null>(null);

  // Opened by its address (a reload, a new tab, a later visit): take the Seat back by Guest token.
  useEffect(() => {
    ensureJoined(code).catch((e: unknown) => {
      setJoinError(e instanceof JoinError ? e.code : "INTERNAL");
    });
  }, [code]);

  if (!push) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="m-0 font-bold">
          {joinError
            ? rejectionText(joinError)
            : status === "lost"
              ? m.connection_lost()
              : m.connecting()}
        </p>
        <Link to="/" className={buttonVariants({ variant: "plain" })}>
          {m.back_home()}
        </Link>
      </main>
    );
  }

  const { view, events } = push;
  const gameOver = view.phase.kind === "gameOver" ? view.phase : null;
  const current = view.players.find((p) => p.id === view.currentPlayer);
  const myTurn = view.currentPlayer === me;
  const answeredAt = Math.max(push.seq, rejection?.seq ?? 0);
  const pending = sentAt !== null && answeredAt <= sentAt;
  const canRoll = myTurn && view.phase.kind === "awaitingRoll" && !pending;
  const offer = myTurn && view.phase.kind === "offer" && !pending ? view.phase : null;
  const quarantineChoice =
    myTurn && !pending && view.phase.kind === "quarantineChoice" ? view.phase : null;
  const sale = saleFor(view, me);
  const othersSale = !myTurn && view.phase.kind === "selling";
  // One toast at a time: the first notice of the push, else its first event worth one.
  const notice = events.find((event) => NOTICES.has(event.type));
  const toast = (notice ? [notice] : events)
    .map((event) => describe(event, view))
    .find((text) => text !== null);

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
    status: [
      p.bankrupt ? m.game_bankrupt() : null,
      p.quarantineRounds === null ? null : m.game_in_quarantine({ rounds: p.quarantineRounds }),
      p.hasPcrTest ? m.game_pcr_test_held() : null,
    ]
      .filter((text) => text !== null)
      .join(" · "),
    ring: p.id === view.currentPlayer && view.turnTimer !== null && (
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
      <MinutePill endsAt={view.endsAt} clockOffset={push.clockOffset} />
      <EventToast
        key={rejected ? `r${rejection.seq}` : push.seq}
        tone={rejected ? "bad" : "neutral"}
      >
        {rejected ? rejectionText(rejection.code) : toast}
      </EventToast>
    </>
  );

  // The Turn card at the bottom; the Field card takes its place while open (later: the pick tray).
  const turnCard = (
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
      {othersSale && (
        <p className="m-0 text-sm font-bold text-ink/70" data-testid="sale-waiting">
          {m.sale_waiting({ name: current ? playerName(current.name) : "" })}
        </p>
      )}
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
          onBuyMuseum={() => send({ type: "BuyMuseum", turn: view.turn })}
          onBuyout={() => send({ type: "Buyout", turn: view.turn })}
          onDecline={() => send({ type: "DeclineOffer", turn: view.turn })}
        />
      )}
      {quarantineChoice && (
        <section className="flex flex-col gap-2" aria-label={m.field_quarantine()}>
          <p className="m-0 text-sm font-bold text-ink/70">
            {m.game_quarantine_rounds({ rounds: quarantineRoundsOf(view, view.currentPlayer) })}
          </p>
          <Button size="lg" onClick={() => send({ type: "RollForTwelve", turn: view.turn })}>
            {m.game_roll_for_twelve()}
          </Button>
          <div className="flex flex-wrap gap-2">
            {quarantineChoice.canBuyPcrTest && (
              <Button
                variant="plain"
                className="flex-1"
                onClick={() => send({ type: "BuyPcrTest", turn: view.turn })}
              >
                {m.game_buy_pcr_test({ price: formatMoney(quarantineChoice.pcrTestPrice) })}
              </Button>
            )}
            {quarantineChoice.canUsePcrTest && (
              <Button
                variant="accent"
                className="flex-1"
                onClick={() => send({ type: "UsePcrTest", turn: view.turn })}
              >
                {m.game_use_pcr_test()}
              </Button>
            )}
          </div>
        </section>
      )}
    </Card>
  );
  const mySeat = view.players.find((p) => p.id === me)?.seat ?? 0;
  // The Sale tray takes the bottom slot during this client's Sale; else the Field card or the Turn card.
  // The result screen replaces the controls once the game is over.
  const card = gameOver ? null : sale ? (
    <SaleTray
      view={view}
      sale={sale}
      picks={salePicksFor(salePicks, sale.key)}
      seat={mySeat}
      clockOffset={push.clockOffset}
      busy={pending}
      onUnpick={(field) => uiStore.getState().toggleSalePick(sale.key, field)}
      onAutoSell={() => send({ type: "AutoSell", turn: view.turn })}
      onSell={(fields) => send({ type: "SellFields", turn: view.turn, fields })}
    />
  ) : selectedField === null ? (
    turnCard
  ) : (
    <FieldCard id={selectedField} view={view} />
  );

  if (wide) {
    return (
      <main className="board-backdrop fixed inset-0 overflow-hidden">
        <ReconnectOverlay />
        {gameOver && <Podium view={view} phase={gameOver} />}
        {/* The Board's box: clear of the corner cards, the status row and the card; the
            fit area also keeps clear of the camera buttons on its right. */}
        <div className="absolute inset-x-[110px] top-[110px] bottom-[200px] [--board-inset-left:3.75rem] [--board-inset-right:3.75rem]">
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
      <ReconnectOverlay />
      {gameOver && <Podium view={view} phase={gameOver} />}
      <ul className="m-0 flex list-none justify-center gap-1.5 px-2" aria-label={m.game_players()}>
        {players.map((player) => (
          <PlayerChip key={player.seat} player={player} className="w-0 max-w-28 flex-1" />
        ))}
      </ul>
      <div className="mt-2 flex min-w-0 items-center justify-center gap-2 px-2">{statusRow}</div>
      {/* The card overlays the Board's bottom (the right side in landscape). The Board
          fits above it and below the camera buttons, into space reserved whether or not
          a card is open, so opening the Field card never changes the zoom. */}
      <div className="relative mt-2 min-h-0 flex-1 [--board-inset-bottom:14rem] [--board-inset-top:3.75rem] landscape:[--board-inset-bottom:0px] landscape:[--board-inset-right:17.5rem]">
        <Board />
        <div className="absolute inset-x-2 bottom-0 landscape:left-auto landscape:w-64">{card}</div>
      </div>
    </main>
  );
}

/** Desktop corner of each Seat, clockwise from top left. */
const CORNERS = ["top-3 left-3", "top-3 right-3", "right-3 bottom-3", "bottom-3 left-3"];

/**
 * The offer: one button per affordable Level with its price, or the Museum
 * buy, or the Buyout, and Decline. The phase lists what is on offer.
 */
function OfferPanel({
  view,
  offer,
  onBuy,
  onBuyMuseum,
  onBuyout,
  onDecline,
}: {
  view: PublicView;
  offer: PhaseOf<"offer">;
  onBuy: (level: number) => void;
  onBuyMuseum: () => void;
  onBuyout: () => void;
  onDecline: () => void;
}) {
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
          <Button key={level} className="tnum" onClick={() => onBuy(level)}>
            {m.offer_level({ level, price: formatMoney(price) })}
          </Button>
        ))}
        {offer.museum !== undefined && (
          <Button className="tnum" onClick={onBuyMuseum}>
            {m.offer_museum({ price: formatMoney(offer.museum) })}
          </Button>
        )}
        {offer.buyout !== undefined && (
          <Button className="tnum" onClick={onBuyout}>
            {m.offer_buyout({ price: formatMoney(offer.buyout) })}
          </Button>
        )}
        <Button variant="plain" onClick={onDecline}>
          {m.offer_decline()}
        </Button>
      </div>
    </section>
  );
}
