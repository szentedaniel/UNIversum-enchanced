/**
 * The Decision module (spec #72): the one answer to "what can this client
 * decide right now?" for the Game screen and the Board. It reads one Playback
 * frame and plain UI state and returns plain data: no React, no stores, no
 * timers, so both screens render from the same answer and a vitest can drive
 * every case.
 */
import type { PhaseOf, PlayerId } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { selectedPick, singleMarks, singlePickFor, type SinglePick } from "#pick/pick.ts";
import {
  AUTO_SELL_WARNING_MS,
  saleFor,
  saleMarks,
  salePicksFor,
  type PickMarks,
  type SalePick,
  type SalePicks,
} from "#pick/sale.ts";
import type { Frame } from "#playback/playback.ts";

/**
 * The Decision this client shows: its own, with the value the tray needs, or
 * another Player's Sale or pick as a waiting line. A Roll, Offer or Quarantine
 * choice in flight is hidden (no optimistic UI); a Sale or pick stays, `busy`.
 * `owner` tells mine from another Player's without reading the payload.
 */
export type OpenDecision =
  | { owner: "me"; kind: "roll" }
  | { owner: "me"; kind: "offer"; offer: PhaseOf<"offer"> }
  | { owner: "me"; kind: "quarantine"; choice: PhaseOf<"quarantineChoice"> }
  | { owner: "me"; kind: "sale"; sale: SalePick; busy: boolean }
  | { owner: "me"; kind: "pick"; pick: SinglePick; busy: boolean }
  | { owner: "other"; player: PlayerId; kind: "sale" | "pick" };

/** This client's Sale or pick. */
type MySaleOrPick = Extract<OpenDecision, { owner: "me"; kind: "sale" | "pick" }>;

/**
 * This client's Sale or pick, or `null` for every other Decision: the one
 * place the `owner` discrimination is read.
 */
function mySaleOrPick(decision: OpenDecision | null): MySaleOrPick | null {
  if (decision === null || decision.owner !== "me") return null;
  return decision.kind === "sale" || decision.kind === "pick" ? decision : null;
}

/** What the bottom slot shows, in the screen's order. */
export type BottomSlot =
  | { kind: "none" }
  | { kind: "podium"; phase: PhaseOf<"gameOver"> }
  | { kind: "fieldCard"; field: FieldId; stepThrough?: readonly FieldId[] }
  | { kind: "sale"; sale: SalePick; busy: boolean }
  | { kind: "pick"; pick: SinglePick; busy: boolean }
  | { kind: "turnCard" };

/** What a tap on the Board does. */
export type FieldTap =
  | { kind: "selectField"; field: FieldId | null }
  | { kind: "toggleSale"; key: string; field: FieldId }
  | { kind: "choosePick"; key: string; field: FieldId }
  | { kind: "ignore" };

/** The local UI state the bottom slot and a tap read (`uiStore`). */
export type DecisionUi = { selectedField: FieldId | null; inspect: boolean };

/**
 * The open Decision: nothing while there is no frame, the gate is shut, the
 * game is over, or a one-tap Decision is in flight; another Player's Sale or
 * pick is a waiting line, and their other Decisions show nothing.
 */
export function openDecision(
  frame: Frame | null,
  me: PlayerId | null,
  inFlight: boolean,
): OpenDecision | null {
  if (frame === null || !frame.gateOpen) return null;
  const { phase, currentPlayer } = frame.view;
  // The result screen is nobody's Decision.
  if (phase.kind === "gameOver") return null;
  if (currentPlayer === me) {
    switch (phase.kind) {
      case "awaitingRoll":
        return inFlight ? null : { owner: "me", kind: "roll" };
      case "offer":
        return inFlight ? null : { owner: "me", kind: "offer", offer: phase };
      case "quarantineChoice":
        return inFlight ? null : { owner: "me", kind: "quarantine", choice: phase };
      case "selling": {
        const sale = saleFor(frame.view, me);
        return sale === null ? null : { owner: "me", kind: "sale", sale, busy: inFlight };
      }
      case "placingDoubler":
      case "choosingErasmus": {
        const pick = singlePickFor(frame.view, me);
        return pick === null ? null : { owner: "me", kind: "pick", pick, busy: inFlight };
      }
    }
  }
  // Another Player's Sale or pick is a waiting line; their Roll, Offer and
  // Quarantine choice leave this client with nothing to show.
  if (phase.kind === "selling") return { owner: "other", player: currentPlayer, kind: "sale" };
  if (phase.kind === "placingDoubler" || phase.kind === "choosingErasmus") {
    return { owner: "other", player: currentPlayer, kind: "pick" };
  }
  return null;
}

/**
 * The bottom slot: the result screen first (the podium once its gate opens),
 * then the Field card in inspect mode during my Sale or pick (stepping through
 * its pickable Fields), then the tray, then a selected Field's card, then the
 * Turn card. With inspect on and no Field open, the tray shows, as it always did.
 */
export function bottomSlot(
  decision: OpenDecision | null,
  frame: Frame | null,
  ui: DecisionUi,
): BottomSlot {
  if (frame === null) return { kind: "none" };
  const { phase } = frame.view;
  if (phase.kind === "gameOver") {
    return frame.gateOpen ? { kind: "podium", phase } : { kind: "none" };
  }
  const mine = mySaleOrPick(decision);
  if (mine !== null) {
    if (ui.inspect && ui.selectedField !== null) {
      const pickable = mine.kind === "sale" ? mine.sale.pickable : mine.pick.pickable;
      return { kind: "fieldCard", field: ui.selectedField, stepThrough: pickable };
    }
    return mine.kind === "sale"
      ? { kind: "sale", sale: mine.sale, busy: mine.busy }
      : { kind: "pick", pick: mine.pick, busy: mine.busy };
  }
  if (ui.selectedField !== null) return { kind: "fieldCard", field: ui.selectedField };
  return { kind: "turnCard" };
}

/**
 * A tap on the Board: during my Sale or pick it picks (or unpicks) the Field
 * and never commits; in inspect mode it opens any Field's card instead, even
 * while the Decision is busy (inspect never changes a pick). While a busy
 * Decision is not in inspect mode it does nothing. Otherwise it opens the
 * Field card.
 */
export function fieldTap(
  decision: OpenDecision | null,
  ui: { inspect: boolean },
  field: FieldId | null,
): FieldTap {
  const mine = mySaleOrPick(decision);
  if (mine === null || ui.inspect) return { kind: "selectField", field };
  if (mine.busy || field === null) return { kind: "ignore" };
  return mine.kind === "sale"
    ? { kind: "toggleSale", key: mine.sale.key, field }
    : { kind: "choosePick", key: mine.pick.key, field };
}

/** The picks a tap made (`uiStore`), keyed by the Decision each belongs to. */
export type PickSelection = {
  /** A Sale's picked Fields, and the Sale they belong to. */
  salePicks: SalePicks;
  /** A single pick's chosen Field, and the pick it belongs to. */
  singlePick: { key: string; field: FieldId | null };
};

/** What the Board draws for the open Decision. */
export type PickSync = {
  /** My open Sale's or pick's key, else `null`; a change starts a new pick UI. */
  key: string | null;
  /** The marks for my Sale or pick, else `null` (none, or a Sale without the room clock). */
  marks: PickMarks | null;
  /** The time until Auto-sell's warning starts, else `null` (no Sale, the warning is due, or no clock). */
  wakeInMs: number | null;
};

/**
 * The Board's pick sync for the open Decision: the key that starts a new pick
 * UI (it ignores `busy`, so a send never resets the picks), the marks for my
 * Sale or pick, and the time until Auto-sell's warning starts. `serverNowMs` is
 * the server's clock: the Sale's countdown runs on it, so a Sale marks nothing
 * while the clock is unknown (`null`, no push yet).
 */
export function pickSyncOf(
  decision: OpenDecision | null,
  frame: Frame | null,
  serverNowMs: number | null,
  selection: PickSelection,
): PickSync {
  const mine = mySaleOrPick(decision);
  if (mine === null) return { key: null, marks: null, wakeInMs: null };
  const key = mine.kind === "sale" ? mine.sale.key : mine.pick.key;
  if (frame === null) return { key, marks: null, wakeInMs: null };
  if (mine.kind === "pick") {
    const field = selectedPick(mine.pick, selection.singlePick);
    return { key, marks: singleMarks(mine.pick, field), wakeInMs: null };
  }
  const timer = frame.view.turnTimer;
  if (timer === null || serverNowMs === null) return { key, marks: null, wakeInMs: null };
  const msLeft = timer.endsAt - serverNowMs;
  const picks = salePicksFor(selection.salePicks, key);
  return {
    key,
    marks: saleMarks(mine.sale, frame.view, picks, msLeft),
    wakeInMs: msLeft > AUTO_SELL_WARNING_MS ? msLeft - AUTO_SELL_WARNING_MS : null,
  };
}
