import type { RejectionCode } from "@universum/protocol/messages";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { Board } from "#board/Board.tsx";
import { FieldCard } from "#board/FieldCard.tsx";
import { ChanceCardOverlay } from "#components/ChanceCardOverlay.tsx";
import { DiceOverlay } from "#components/DiceOverlay.tsx";
import { EventLog } from "#components/EventLog.tsx";
import { GameMenu } from "#components/GameMenu.tsx";
import { EventToast, MinutePill } from "#components/GameHud.tsx";
import { HintCard } from "#components/HintCard.tsx";
import {
  PlayerCard,
  PlayerChip,
  type ChatPlacement,
  type PlayerSummary,
} from "#components/PlayerCard.tsx";
import { Podium } from "#components/Podium.tsx";
import { buttonVariants } from "#components/ui/button.tsx";
import { ReconnectOverlay } from "#components/ReconnectOverlay.tsx";
import { ensureJoined, JoinError } from "#connection.ts";
import { bottomSlot, openDecision } from "#decision/decision.ts";
import { nextHint } from "#hints/hints.ts";
import { stripMoney, useCardLayout } from "#lib/tray-layout.ts";
import { useWide } from "#lib/use-media-query.ts";
import { cn } from "#lib/utils.ts";
import { playbackStore } from "#playback/playback-store.ts";
import { DecisionTray } from "#screens/DecisionTray.tsx";
import { TurnCard } from "#screens/TurnCard.tsx";
import { TurnRing } from "#screens/TurnRing.tsx";
import { hintStore } from "#stores/hint-store.ts";
import { inFlightOf, inLobbyOf, roomStore } from "#stores/room-store.ts";
import { uiStore } from "#stores/ui-store.ts";
import { formatCompactMoney, formatMoney, m, playerName, rejectionText } from "#text.ts";

export function Game() {
  const { code = "" } = useParams();
  const push = useStore(roomStore, (s) => (s.code === code ? s.push : null));
  const me = useStore(roomStore, (s) => s.me);
  const status = useStore(roomStore, (s) => s.status);
  const rejection = useStore(roomStore, (s) => s.rejection);
  const selectedField = useStore(uiStore, (s) => s.selectedField);
  const inspect = useStore(uiStore, (s) => s.inspect);
  // No optimistic UI: a tap locks the controls until the server answers.
  const inFlight = useStore(roomStore, inFlightOf);
  // The hints this browser has shown and the Guest's switch (spec #180).
  const hintsSeen = useStore(hintStore, (s) => s.seen);
  const hintsEnabled = useStore(hintStore, (s) => s.enabled);
  const wide = useWide();
  // The bottom card's height ceiling and the on-screen keyboard's lift (#184).
  const cardLayout = useCardLayout();
  const [joinError, setJoinError] = useState<RejectionCode | null>(null);
  // The phone strip's one expanded Player: its full card replaces the chips.
  const [openCard, setOpenCard] = useState<number | null>(null);
  // The Playback core's frame: the gate, the view, the held Turn, the toast and the overlay (ADR-0004).
  const frame = useStore(playbackStore, (state) => state.frame);
  // The Room returned to Lobby (a rematch): the Lobby message dropped the game
  // push the screen drew. Leave for the Lobby's own address, replacing the
  // game's, and show nothing meanwhile so the connecting card never flashes.
  const returned = useStore(roomStore, (s) => s.code === code && inLobbyOf(s));
  const navigate = useNavigate();

  // Opened by its address (a reload, a new tab, a later visit): take the Seat back by Guest token.
  useEffect(() => {
    ensureJoined(code).catch((e: unknown) => {
      setJoinError(e instanceof JoinError ? e.code : "INTERNAL");
    });
  }, [code]);

  useEffect(() => {
    if (returned) void navigate(`/room/${code}`, { replace: true });
  }, [returned, code, navigate]);

  if (returned) return null;

  if (!push || frame === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-safe-4 text-center">
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

  // The view the screen draws is the frame's, never the push's: one reading for every layer.
  const view = frame.view;
  // Story 4: the heading and Turn number hold the previous label until the gate opens;
  // the dice and a drawn Chance card show for their own step of the Playback (ADR-0004).
  const { shownTurn, toast, overlay } = frame;
  const { clockOffset } = push;
  // One answer for the Turn card, the trays, the bottom slot and the Podium (spec #72).
  const decision = openDecision(frame, me, inFlight);
  const slot = bottomSlot(decision, frame, { selectedField, inspect });
  // The one hint a first-time Guest meets now (#255): the table's order decides,
  // and the card draws it only in the area this ticket covers.
  const hint = nextHint({ decision, view, seen: hintsSeen, enabled: hintsEnabled });
  const waiting = decision !== null && decision.owner === "other" ? decision.kind : null;

  const players: PlayerSummary[] = view.players.map((p) => ({
    seat: p.seat,
    name: playerName(p.name),
    bot: p.bot,
    cash: formatMoney(p.cash),
    cashShort: formatCompactMoney(p.cash),
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
        clockOffset={clockOffset}
      />
    ),
  }));
  const openPlayer = players.find((player) => player.seat === openCard) ?? null;
  // Four Players on a portrait phone leave each chip too narrow for the full cash.
  const compactMoney = stripMoney(cardLayout.width, players.length) === "compact";
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
      <MinutePill endsAt={view.endsAt} clockOffset={clockOffset} />
      <EventToast
        key={rejected ? `r${rejection.seq}` : push.seq}
        tone={rejected ? "bad" : toast?.tone === "notice" ? "good" : "neutral"}
      >
        {rejected ? rejectionText(rejection.code) : toast?.text}
      </EventToast>
      <EventLog />
      <GameMenu />
    </>
  );

  // The Turn card at the bottom; the Field card takes its place while open.
  const mySeat = view.players.find((p) => p.id === me)?.seat ?? 0;
  const turnCard = (
    <TurnCard
      view={view}
      decision={decision}
      shownTurn={shownTurn}
      waiting={waiting}
      clockOffset={clockOffset}
      seat={mySeat}
    />
  );
  // The bottom slot in the Decision module's order (spec #72): the result
  // screen, the Field card in inspect mode during my Sale or pick (‹ › over its
  // pickable Fields only; closing it brings the tray back), the tray, the Field
  // card, the Turn card.
  function bottomCard() {
    switch (slot.kind) {
      case "none":
      case "podium":
        return null;
      case "fieldCard":
        return <FieldCard id={slot.field} view={view} stepThrough={slot.stepThrough} />;
      case "sale":
      case "pick":
        return (
          <DecisionTray
            view={view}
            slot={slot}
            clockOffset={clockOffset}
            seat={mySeat}
            hint={hint}
          />
        );
      case "turnCard":
        return turnCard;
    }
    return null;
  }
  const card = bottomCard();
  const podium =
    slot.kind === "podium" ? (
      <Podium view={view} phase={slot.phase} rematch={push.rematch} me={me} busy={inFlight} />
    ) : null;

  if (wide) {
    return (
      <main className="game-shell board-backdrop fixed inset-0 overflow-hidden p-safe-0">
        <ReconnectOverlay />
        {podium}
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
              className={cn("absolute", CORNERS[player.seat]?.card, player.current && "z-10")}
              bubblePlacement={CORNERS[player.seat]?.bubble}
            />
          ))}
        </ul>
        <div className="absolute top-6 left-1/2 flex w-[calc(100%-600px)] -translate-x-1/2 items-center justify-center gap-2">
          {statusRow}
        </div>
        {/* The card and the hint above it stay in the space the Board reserves
            (`bottom-[200px]` minus this strip's `bottom-3`): with a hint the
            strip scrolls instead of covering a Field a Sale or pick asks for,
            as the phone's does. Without one the card keeps its old room. */}
        <div
          className={cn(
            "absolute bottom-3 left-1/2 flex w-[min(440px,calc(100%-600px))] -translate-x-1/2 flex-col gap-2",
            hint !== null && "max-h-[calc(200px-0.75rem)] overflow-y-auto overscroll-contain",
          )}
        >
          <HintCard hint={hint} place="bottom" />
          {card}
        </div>
      </main>
    );
  }

  return (
    <main className="game-shell board-backdrop fixed inset-0 flex flex-col overflow-hidden px-safe-0 pt-safe-2 pb-safe-2">
      <ReconnectOverlay />
      {podium}
      <ul className="m-0 flex list-none justify-center gap-1.5 px-2" aria-label={m.game_players()}>
        {/* Phone (#184, story 5): a chip per Player, and one tap shows that
            Player's full card in the strip's place so the cards never cover
            the Board. The wide screen keeps the corner cards. */}
        {openPlayer === null ? (
          players.map((player, index) => (
            <PlayerChip
              key={player.seat}
              player={player}
              className="w-0 max-w-28 flex-1"
              bubblePlacement={index < players.length / 2 ? "below-start" : "below-end"}
              onExpand={() => setOpenCard(player.seat)}
              compactMoney={compactMoney}
            />
          ))
        ) : (
          <PlayerCard
            key={openPlayer.seat}
            player={openPlayer}
            className={cn("w-full max-w-sm", openPlayer.current && "scale-100")}
            onCollapse={() => setOpenCard(null)}
          />
        )}
      </ul>
      <div className="mt-2 flex min-w-0 items-center justify-center gap-2 px-2">{statusRow}</div>
      {/* The card overlays the Board's bottom. The Board fits above it and below
          the camera buttons, into space reserved whether or not a card is open,
          so opening the Field card never changes the zoom. A landscape phone is
          short: the card stays a compact strip at the bottom and the Board fits
          the whole space above the top row instead. The card scrolls inside the
          reserved space (or its share of a short screen) and the keyboard lifts
          it, so it never covers the Board or sits under the keyboard; the
          shell's `pb-safe-2` keeps it clear of the safe-area inset. */}
      <div className="relative mt-2 min-h-0 flex-1 [--board-inset-bottom:14rem] [--board-inset-top:3.75rem] landscape:[--board-inset-bottom:0px] landscape:[--board-inset-right:3.5rem] landscape:[--board-inset-top:0px]">
        <Board />
        {boardOverlay && <div className="playback-overlay landscape:bottom-24">{boardOverlay}</div>}
        <div
          className="absolute inset-x-2 bottom-0 flex flex-col gap-2 overflow-y-auto overscroll-contain pb-1 pr-1 landscape:mx-auto landscape:max-w-md"
          style={{ bottom: cardLayout.keyboard, maxHeight: cardLayout.maxHeight }}
        >
          <HintCard hint={hint} place="bottom" />
          {card}
        </div>
      </div>
    </main>
  );
}

/** Desktop corner of each Seat, clockwise from top left, and where its chat bubble hangs. */
const CORNERS: { card: string; bubble: ChatPlacement }[] = [
  { card: "top-3 left-3", bubble: "below-start" },
  { card: "top-3 right-3", bubble: "below-end" },
  { card: "right-3 bottom-3", bubble: "above-end" },
  { card: "bottom-3 left-3", bubble: "above-start" },
];
