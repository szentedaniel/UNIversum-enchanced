import type { PhaseOf, PlayerIntent, PublicView } from "@universum/rules";
import { FIELDS } from "@universum/rules/board";
import type { RejectionCode } from "@universum/protocol/messages";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useStore } from "zustand";
import { playDice } from "#audio.ts";
import { Board } from "#board/Board.tsx";
import { FieldCard } from "#board/FieldCard.tsx";
import { ChanceCardOverlay } from "#components/ChanceCardOverlay.tsx";
import { DiceOverlay } from "#components/DiceOverlay.tsx";
import { GameMenu } from "#components/GameMenu.tsx";
import { EventToast, MinutePill } from "#components/GameHud.tsx";
import { PlayerCard, PlayerChip, type PlayerSummary } from "#components/PlayerCard.tsx";
import { Podium } from "#components/Podium.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { ReconnectOverlay } from "#components/ReconnectOverlay.tsx";
import { ensureJoined, JoinError, sendIntent } from "#connection.ts";
import { useWide } from "#lib/use-media-query.ts";
import { cn } from "#lib/utils.ts";
import { singlePickFor } from "#pick/pick.ts";
import { saleFor } from "#pick/sale.ts";
import { gateOpenOf, playbackStore } from "#playback/playback-store.ts";
import { PickTray } from "#screens/PickTray.tsx";
import { SaleTray } from "#screens/SaleTray.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { roomStore } from "#stores/room-store.ts";
import { salePicksFor, uiStore } from "#stores/ui-store.ts";
import { fieldName, formatMoney, m, playerName, rejectionText } from "#text.ts";

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
  const singleSelection = useStore(uiStore, (s) => s.singlePick);
  const checklistOpen = useStore(uiStore, (s) => s.checklistOpen);
  const inspect = useStore(uiStore, (s) => s.inspect);
  // No optimistic UI: after a tap the control stays hidden until the next push or a Rejection.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const wide = useWide();
  const [joinError, setJoinError] = useState<RejectionCode | null>(null);
  // The Playback core's frame: the gate, the held Turn, the toast and the overlay (ADR-0004).
  const gateOpen = useStore(playbackStore, gateOpenOf);
  // The view the screen draws is the frame's, never the push's: one reading for every layer.
  const view = useStore(playbackStore, (state) => state.frame?.view ?? null);
  // Story 4: the heading and Turn number switch when the gate opens, not on the push.
  const shownTurn = useStore(playbackStore, (state) => state.frame?.shownTurn ?? null);
  const toast = useStore(playbackStore, (state) => state.frame?.toast ?? null);
  // The dice and a drawn Chance card show for their own step of the Playback (ADR-0004).
  const overlay = useStore(playbackStore, (state) => state.frame?.overlay ?? null);

  // The dice sound starts on the server's roll, never on a tap (spec: no optimistic UI).
  useEffect(() => {
    if (push?.events.some((event) => event.type === "DiceRolled")) playDice();
  }, [push]);

  // Opened by its address (a reload, a new tab, a later visit): take the Seat back by Guest token.
  useEffect(() => {
    ensureJoined(code).catch((e: unknown) => {
      setJoinError(e instanceof JoinError ? e.code : "INTERNAL");
    });
  }, [code]);

  if (!push || view === null) {
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

  const gameOver = view.phase.kind === "gameOver" ? view.phase : null;
  const current = view.players.find((p) => p.id === view.currentPlayer);
  const myTurn = view.currentPlayer === me;
  // The turn card holds the previous Turn's values through the Playback (story 4, ADR-0004).
  const shownPlayer = view.players.find((p) => p.id === shownTurn?.currentPlayer) ?? current;
  const shownMyTurn = shownTurn?.currentPlayer === me;
  const shownTurnNumber = shownTurn?.turn ?? view.turn;
  const answeredAt = Math.max(push.seq, rejection?.seq ?? 0);
  const pending = sentAt !== null && answeredAt <= sentAt;
  // Decision controls wait for the decision gate: the local Playback and the server's actsAfter (ADR-0004).
  const canRoll = myTurn && gateOpen && view.phase.kind === "awaitingRoll" && !pending;
  const offer = myTurn && gateOpen && view.phase.kind === "offer" && !pending ? view.phase : null;
  const quarantineChoice =
    myTurn && gateOpen && !pending && view.phase.kind === "quarantineChoice" ? view.phase : null;
  const sale = gateOpen ? saleFor(view, me) : null;
  const singlePick = gateOpen ? singlePickFor(view, me) : null;
  const othersSale = !myTurn && gateOpen && view.phase.kind === "selling";
  const othersPick =
    !myTurn &&
    gateOpen &&
    (view.phase.kind === "placingDoubler" || view.phase.kind === "choosingErasmus");

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
  // The Playback's DOM layer: the frame's overlay is the dice or a drawn Chance card.
  const boardOverlay =
    overlay?.kind === "dice" ? (
      <DiceOverlay dice={overlay.event.dice} />
    ) : overlay?.kind === "card" ? (
      <ChanceCardOverlay key={`${push.seq}:${overlay.startMs}`} card={overlay.event.card} />
    ) : null;

  const statusRow = (
    <>
      <MinutePill endsAt={view.endsAt} clockOffset={push.clockOffset} />
      <EventToast
        key={rejected ? `r${rejection.seq}` : push.seq}
        tone={rejected ? "bad" : toast?.tone === "notice" ? "good" : "neutral"}
      >
        {rejected ? rejectionText(rejection.code) : toast?.text}
      </EventToast>
      <GameMenu />
    </>
  );

  // The Turn card at the bottom; the Field card takes its place while open (later: the pick tray).
  const turnCard = (
    <Card className="gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <strong data-testid="turn-of" className="truncate text-lg font-black">
          {shownMyTurn
            ? m.game_your_turn()
            : m.game_turn_of({ name: shownPlayer ? playerName(shownPlayer.name) : "" })}
        </strong>
        <span data-testid="turn" className="tnum shrink-0 text-sm font-bold text-ink/70">
          {m.game_turn({ turn: shownTurnNumber })}
        </span>
      </div>
      {othersSale && (
        <p className="m-0 text-sm font-bold text-ink/70" data-testid="sale-waiting">
          {m.sale_waiting({ name: current ? playerName(current.name) : "" })}
        </p>
      )}
      {othersPick && (
        <p className="m-0 text-sm font-bold text-ink/70" data-testid="pick-waiting">
          {m.pick_waiting({ name: current ? playerName(current.name) : "" })}
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
  // The result screen replaces both. Otherwise inspect mode during a pick opens
  // the Field card in the tray's place, with ‹ › over pickable Fields only;
  // closing it brings the tray back. Else the pick tray takes the bottom slot,
  // then the Field card, then the Turn card.
  const pick = sale ?? singlePick;
  const card = gameOver ? null : pick && inspect && selectedField !== null ? (
    <FieldCard id={selectedField} view={view} stepThrough={pick.pickable} />
  ) : sale ? (
    <SaleTray
      view={view}
      sale={sale}
      picks={salePicksFor(salePicks, sale.key)}
      seat={mySeat}
      clockOffset={push.clockOffset}
      busy={pending}
      checklistOpen={checklistOpen}
      inspect={inspect}
      onToggleChecklist={() => uiStore.getState().setChecklistOpen(!checklistOpen)}
      onToggleInspect={() => uiStore.getState().setInspect(!inspect)}
      onToggle={(field) => uiStore.getState().toggleSalePick(sale.key, field)}
      onFocus={(field) => uiStore.getState().focusPick(field)}
      onUnpick={(field) => uiStore.getState().toggleSalePick(sale.key, field)}
      onAutoSell={() => send({ type: "AutoSell", turn: view.turn })}
      onSell={(fields) => send({ type: "SellFields", turn: view.turn, fields })}
    />
  ) : singlePick ? (
    <PickTray
      view={view}
      pick={singlePick}
      selection={singleSelection}
      seat={mySeat}
      clockOffset={push.clockOffset}
      busy={pending}
      checklistOpen={checklistOpen}
      inspect={inspect}
      onToggleChecklist={() => uiStore.getState().setChecklistOpen(!checklistOpen)}
      onToggleInspect={() => uiStore.getState().setInspect(!inspect)}
      onToggle={(field) => uiStore.getState().choosePick(singlePick.key, field)}
      onFocus={(field) => uiStore.getState().focusPick(field)}
      onPick={(field) => uiStore.getState().choosePick(singlePick.key, field)}
      onCommit={(field) =>
        send(
          singlePick.kind === "doubler"
            ? { type: "PlaceDoubler", turn: view.turn, field }
            : { type: "TravelErasmus", turn: view.turn, field },
        )
      }
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
        {gameOver && gateOpen && <Podium view={view} phase={gameOver} />}
        {/* The Board's box: clear of the corner cards, the status row and the card; the
            fit area also keeps clear of the camera buttons on its right. */}
        <div className="absolute inset-x-[110px] top-[110px] bottom-[200px] [--board-inset-left:3.75rem] [--board-inset-right:3.75rem]">
          <Board />
          {boardOverlay && <div className="playback-overlay">{boardOverlay}</div>}
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
      {gameOver && gateOpen && <Podium view={view} phase={gameOver} />}
      <ul className="m-0 flex list-none justify-center gap-1.5 px-2" aria-label={m.game_players()}>
        {players.map((player) => (
          <PlayerChip key={player.seat} player={player} className="w-0 max-w-28 flex-1" />
        ))}
      </ul>
      <div className="mt-2 flex min-w-0 items-center justify-center gap-2 px-2">{statusRow}</div>
      {/* The card overlays the Board's bottom. The Board fits above it and below
          the camera buttons, into space reserved whether or not a card is open,
          so opening the Field card never changes the zoom. A landscape phone is
          short: the card stays a compact strip at the bottom and the Board fits
          the whole space above the top row instead. */}
      <div className="relative mt-2 min-h-0 flex-1 [--board-inset-bottom:14rem] [--board-inset-top:3.75rem] landscape:[--board-inset-bottom:0px] landscape:[--board-inset-right:3.5rem] landscape:[--board-inset-top:0px]">
        <Board />
        {boardOverlay && <div className="playback-overlay landscape:bottom-24">{boardOverlay}</div>}
        <div className="absolute inset-x-2 bottom-0 landscape:mx-auto landscape:max-w-md">
          {card}
        </div>
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
