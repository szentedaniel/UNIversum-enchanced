/**
 * The Decision module (spec #72): the one answer to "what can this client
 * decide right now?" for the Game screen and the Board. It reads one Playback
 * frame and plain UI state and returns plain data: no React, no stores, no
 * timers, so both screens render from the same answer and a vitest can drive
 * every case.
 */
import type { PhaseOf, PlayerId } from "@universum/rules";
import type { FieldId } from "@universum/rules/board";
import { singlePickFor, type SinglePick } from "#pick/pick.ts";
import { saleFor, type SalePick } from "#pick/sale.ts";
import type { Frame } from "#playback/playback.ts";

/**
 * The Decision this client shows: its own, with the value the tray needs, or
 * another Player's Sale or pick as a waiting line. A Roll, Offer or Quarantine
 * choice in flight is hidden (no optimistic UI); a Sale or pick stays, `busy`.
 */
export type OpenDecision =
  | { owner: "me"; kind: "roll" }
  | { owner: "me"; kind: "offer"; offer: PhaseOf<"offer"> }
  | { owner: "me"; kind: "quarantine"; choice: PhaseOf<"quarantineChoice"> }
  | { owner: "me"; kind: "sale"; sale: SalePick; busy: boolean }
  | { owner: "me"; kind: "pick"; pick: SinglePick; busy: boolean }
  | { owner: PlayerId; kind: "sale" | "pick" };

/** What the bottom slot shows, in the screen's order. */
export type BottomSlot =
  | { kind: "none" }
  | { kind: "podium" }
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
  if (phase.kind === "selling") return { owner: currentPlayer, kind: "sale" };
  if (phase.kind === "placingDoubler" || phase.kind === "choosingErasmus") {
    return { owner: currentPlayer, kind: "pick" };
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
  if (phase.kind === "gameOver") return frame.gateOpen ? { kind: "podium" } : { kind: "none" };
  // Only this client's Sale or pick carries the value; another Player's is a
  // waiting line with neither property.
  if (decision !== null) {
    if ("sale" in decision) {
      if (ui.inspect && ui.selectedField !== null) {
        return { kind: "fieldCard", field: ui.selectedField, stepThrough: decision.sale.pickable };
      }
      return { kind: "sale", sale: decision.sale, busy: decision.busy };
    }
    if ("pick" in decision) {
      if (ui.inspect && ui.selectedField !== null) {
        return { kind: "fieldCard", field: ui.selectedField, stepThrough: decision.pick.pickable };
      }
      return { kind: "pick", pick: decision.pick, busy: decision.busy };
    }
  }
  if (ui.selectedField !== null) return { kind: "fieldCard", field: ui.selectedField };
  return { kind: "turnCard" };
}

/**
 * A tap on the Board: during my Sale or pick it picks (or unpicks) the Field
 * and never commits; in inspect mode it opens any Field's card instead; while
 * that Decision is busy it does nothing. Otherwise it opens the Field card.
 */
export function fieldTap(
  decision: OpenDecision | null,
  ui: { inspect: boolean },
  field: FieldId | null,
): FieldTap {
  if (decision !== null && "sale" in decision) {
    if (decision.busy) return { kind: "ignore" };
    if (ui.inspect) return { kind: "selectField", field };
    return field === null
      ? { kind: "ignore" }
      : { kind: "toggleSale", key: decision.sale.key, field };
  }
  if (decision !== null && "pick" in decision) {
    if (decision.busy) return { kind: "ignore" };
    if (ui.inspect) return { kind: "selectField", field };
    return field === null
      ? { kind: "ignore" }
      : { kind: "choosePick", key: decision.pick.key, field };
  }
  return { kind: "selectField", field };
}

/**
 * The key whose change starts a new pick UI: my Sale's or pick's key, else
 * `null`. It ignores `busy`, so a send does not reset the picks.
 */
export function decisionKey(decision: OpenDecision | null): string | null {
  if (decision === null) return null;
  if ("sale" in decision) return decision.sale.key;
  if ("pick" in decision) return decision.pick.key;
  return null;
}
