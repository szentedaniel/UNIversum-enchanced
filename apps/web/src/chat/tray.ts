/**
 * The quick-chat tray's behaviour (#176, #231): whom the Game screen offers it
 * to, and what a tap does. A tap takes the sender as an argument, so a unit
 * test drives it with a spy — the house has no DOM test environment (#224),
 * and the tray's real press is the two-Guest e2e spec (#233). Time is not in
 * here: the component arms the cooldown's one timer, and `cooldownOver` clears
 * the flag when it fires.
 */
import type { ChatId } from "@universum/protocol/messages";
import type { PlayerId, PublicView } from "@universum/rules";

/** The tray's state: open on screen, and whether its buttons still refuse a send. */
export type ChatTrayState = {
  open: boolean;
  /** A send just happened; every button stays disabled until the cooldown ends. */
  cooling: boolean;
};

/** Nothing open and nothing cooling: the tray's initial state. */
export const CLOSED_TRAY: ChatTrayState = { open: false, cooling: false };

/** The toggle opened the tray; a running cooldown stays. */
export function openTray(state: ChatTrayState): ChatTrayState {
  return { ...state, open: true };
}

/** The toggle, Escape or an outside tap closed the tray; a running cooldown stays. */
export function closeTray(state: ChatTrayState): ChatTrayState {
  return { ...state, open: false };
}

/** The cooldown ran out: the buttons send again. */
export function cooldownOver(state: ChatTrayState): ChatTrayState {
  return { ...state, cooling: false };
}

/**
 * One tap on a catalogue id: `send` gets that id and the tray closes. While the
 * cooldown runs the tap is refused: the buttons are disabled, and a stray tap
 * sends nothing.
 */
export function tapChat(
  state: ChatTrayState,
  id: ChatId,
  send: (id: ChatId) => void,
): ChatTrayState {
  if (state.cooling) return state;
  send(id);
  return { open: false, cooling: true };
}

/**
 * Whether the game the view shows offers the tray to this client's Guest: a
 * seated Player, not the result screen, and not a Guest who muted chat (#232).
 * A spectator (#248) holds no Seat, and the Lobby draws no Game screen.
 */
export function chatOpenTo(view: PublicView, me: PlayerId | null, muted: boolean): boolean {
  return (
    !muted &&
    me !== null &&
    view.phase.kind !== "gameOver" &&
    view.players.some((p) => p.id === me)
  );
}
