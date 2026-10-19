import type { GameEvent, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useStore } from "zustand";
import { Board } from "#board/Board.tsx";
import { sendIntent } from "#connection.ts";
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

  if (!push) {
    return (
      <main className="screen">
        <p>{status === "connecting" ? m.connecting() : m.connection_lost()}</p>
        <Link to="/">{m.back_home()}</Link>
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
  const toast = events
    .map((event) => describe(event, view))
    .filter((text) => text !== null)
    .slice(0, 2)
    .join(" · ");
  const selected = selectedField === null ? null : FIELDS[selectedField];

  function send(type: "Roll" | "RollForTwelve" | "BuyPcrTest" | "UsePcrTest") {
    setSentAt(answeredAt);
    sendIntent({ type, turn: view.turn });
  }

  return (
    <main className="screen game">
      <header className="game-header">
        <span data-testid="turn">{m.game_turn({ turn: view.turn })}</span>
        <strong data-testid="turn-of">
          {myTurn
            ? m.game_your_turn()
            : m.game_turn_of({ name: current ? playerName(current.name) : "" })}
        </strong>
      </header>
      <ul className="players" aria-label={m.game_players()}>
        {view.players.map((p) => (
          <li
            key={p.id}
            className={`player seat-${p.seat}${p.id === view.currentPlayer ? " current" : ""}`}
          >
            <span className="figure">
              {p.id === view.currentPlayer && (
                <TurnRing
                  key={`${view.turn}:${view.turnDeadline}`}
                  timer={view.turnTimer}
                  clockOffset={push.clockOffset}
                />
              )}
            </span>
            <span className="player-text">
              <span>{playerName(p.name)}</span>
              <span className="cash" aria-label={m.game_cash()}>
                {formatMoney(p.cash)}
              </span>
              {p.quarantineRounds !== null && (
                <span className="badge">
                  {m.game_in_quarantine({ rounds: p.quarantineRounds })}
                </span>
              )}
              {p.hasPcrTest && <span className="badge">{m.game_pcr_test_held()}</span>}
            </span>
          </li>
        ))}
      </ul>
      <output className="toast">
        {rejection && rejection.seq > push.seq ? rejectionText(rejection.code) : toast}
      </output>
      <Board />
      <footer className="game-footer">
        {selected && (
          <p className="selected-field" data-testid="selected-field">
            {fieldName(selected.key)}
          </p>
        )}
        {canRoll && (
          <button type="button" className="primary" onClick={() => send("Roll")}>
            {m.game_roll()}
          </button>
        )}
        {quarantineChoice && (
          <section className="choice-panel" aria-label={m.field_quarantine()}>
            <p>{m.game_quarantine_rounds({ rounds: me ? quarantineRoundsOf(view, me) : 0 })}</p>
            <button type="button" className="primary" onClick={() => send("RollForTwelve")}>
              {m.game_roll_for_twelve()}
            </button>
            {quarantineChoice.canBuyPcrTest && (
              <button type="button" onClick={() => send("BuyPcrTest")}>
                {m.game_buy_pcr_test({ price: formatMoney(quarantineChoice.pcrTestPrice) })}
              </button>
            )}
            {quarantineChoice.canUsePcrTest && (
              <button type="button" onClick={() => send("UsePcrTest")}>
                {m.game_use_pcr_test()}
              </button>
            )}
          </section>
        )}
      </footer>
    </main>
  );
}
