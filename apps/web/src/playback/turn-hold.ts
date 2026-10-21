/**
 * Story 4 of ADR-0004: the next Turn starts at the same moment on every
 * screen. The turn card's heading and Turn number are held at the previous
 * push's values while the Playback runs, and switch together with the controls
 * when the decision gate opens. The ring and the current Player's card
 * highlight still follow the push at once, as before.
 *
 * A first view, a reconnect or a reload has no previous Turn to show: it shows
 * the current values at once.
 */
import type { PlayerId } from "@universum/rules";

export type TurnLabel = { turn: number; currentPlayer: PlayerId };

/** The label to show: the previous Turn until the gate opens, unless there is no previous view. */
export function turnLabelToShow(
  shown: TurnLabel | null,
  current: TurnLabel,
  over: boolean,
  hasPlayback: boolean,
): TurnLabel {
  return shown === null || over || !hasPlayback ? current : shown;
}
