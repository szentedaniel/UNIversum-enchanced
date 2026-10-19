import type { GameEvent, PublicView } from "@universum/rules";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useStore } from "zustand";
import { Board } from "#board/Board.tsx";
import { FieldCard } from "#board/FieldCard.tsx";
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
import { formatMoney, m, playerName, rejectionText } from "#text.ts";

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
  // One toast at a time: the first event of the push worth one.
  const toast = events.map((event) => describe(event, view)).find((text) => text !== null);

  function roll() {
    setSentAt(answeredAt);
    sendIntent({ type: "Roll", turn: view.turn });
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
      {canRoll && (
        <Button size="lg" onClick={roll}>
          {m.game_roll()}
        </Button>
      )}
    </Card>
  );
  const card = selectedField === null ? turnCard : <FieldCard id={selectedField} view={view} />;

  if (wide) {
    return (
      <main className="board-backdrop fixed inset-0 overflow-hidden">
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
