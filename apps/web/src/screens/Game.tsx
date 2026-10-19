import type { GameEvent, PublicView } from "@universum/rules";
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
import { fieldName, formatMoney, m, playerName, rejectionText } from "#text.ts";

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
  const quarantineChoice =
    myTurn && !pending && view.phase.kind === "quarantineChoice" ? view.phase : null;
  // One toast at a time: the first notice of the push, else its first event worth one.
  const notice = events.find((event) => NOTICES.has(event.type));
  const toast = (notice ? [notice] : events)
    .map((event) => describe(event, view))
    .find((text) => text !== null);
  const selected = selectedField === null ? null : FIELDS[selectedField];

  function send(type: "Roll" | "RollForTwelve" | "BuyPcrTest" | "UsePcrTest") {
    setSentAt(answeredAt);
    sendIntent({ type, turn: view.turn });
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
      p.quarantineRounds === null ? null : m.game_in_quarantine({ rounds: p.quarantineRounds }),
      p.hasPcrTest ? m.game_pcr_test_held() : null,
    ]
      .filter((text) => text !== null)
      .join(" · "),
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
      {selected && (
        <p className="m-0 font-display text-xl" data-testid="selected-field">
          {fieldName(selected.key)}
        </p>
      )}
      {canRoll && (
        <Button size="lg" onClick={() => send("Roll")}>
          {m.game_roll()}
        </Button>
      )}
      {quarantineChoice && (
        <section className="flex flex-col gap-2" aria-label={m.field_quarantine()}>
          <p className="m-0 text-sm font-bold text-ink/70">
            {m.game_quarantine_rounds({ rounds: quarantineRoundsOf(view, view.currentPlayer) })}
          </p>
          <Button size="lg" onClick={() => send("RollForTwelve")}>
            {m.game_roll_for_twelve()}
          </Button>
          <div className="flex flex-wrap gap-2">
            {quarantineChoice.canBuyPcrTest && (
              <Button variant="plain" className="flex-1" onClick={() => send("BuyPcrTest")}>
                {m.game_buy_pcr_test({ price: formatMoney(quarantineChoice.pcrTestPrice) })}
              </Button>
            )}
            {quarantineChoice.canUsePcrTest && (
              <Button variant="accent" className="flex-1" onClick={() => send("UsePcrTest")}>
                {m.game_use_pcr_test()}
              </Button>
            )}
          </div>
        </section>
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
