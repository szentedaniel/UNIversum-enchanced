// The web app's test-only hooks (apps/web/src/test-hooks.ts), as the specs
// see them inside `page.evaluate`. One declaration for every spec. The pushed
// view and every phase are the rules engine's types (type-only: `evaluate`
// callbacks are serialized), so a spec cannot drift from the server.
import type { GameEvent, PublicView, Reveal } from "@universum/rules";

export type Camera = { scale: number; x: number; y: number };
/** One animation frame's sample of the Playback hold (ADR-0004), as two-guests.spec.ts records it. */
export type PlaybackSample = {
  version: number;
  /** The client's estimate of the server's clock, and when the push's Playback ends. */
  now: number;
  actsAfter: number;
  /** Whether a control for the pushed decision is on screen. */
  decision: boolean;
  /** Whether the decision gate was open: local Playback and `actsAfter` (ADR-0004). */
  open: boolean;
  /** Whether the Roll's dice are in the DOM for their Playback step. */
  dice: boolean;
  /** The current Player's ring's CSS animation delay in ms (`null` if not rendered). */
  ringDelayMs: number | null;
};
export type PickMarks = { pickable: number[]; picked: number[]; ringed: number[] };

/**
 * One WebSocket construction a page made (#61): the `typeof` of the
 * constructor's second argument — `"undefined"` for the browser form the app
 * must use, `"object"` for the Node form whose first attempt throws.
 */
export type SocketCall = {
  protocols:
    | "undefined"
    | "object"
    | "boolean"
    | "number"
    | "bigint"
    | "string"
    | "symbol"
    | "function";
};

declare global {
  interface Window {
    /** Counted by a spec that stubs `HTMLMediaElement.play` before the app loads. */
    dicePlays?: number;
    /**
     * Every `new WebSocket(...)` the page made, recorded by the probe that
     * `helpers.ts` installs before the app's scripts run (#61).
     */
    universumWebSockets?: SocketCall[];
    /** Samples recorded per animation frame while the Playback probe runs. */
    playbackProbe?: PlaybackSample[];
    /** Stops the probe started by `two-guests.spec.ts`. */
    stopPlaybackProbe?: () => void;
    /** Resumes the animation frames `background-tab.spec.ts` parked to starve the Board. */
    resumeBoardFrames?: () => void;
    universumTest?: TestHooks;
  }
}

/** The latest Rejection of one of this client's intents. */
export type Rejection = { code: string; seq: number };

/** `playback()`: the push the decision gate is for, whether it is open, and the shown Turn. */
export type PlaybackHook = {
  seq: number | null;
  gateOpen: boolean;
  shownTurn: { turn: number; currentPlayer: string } | null;
};

/** The test-only hooks the web app installs on `window.universumTest` (apps/web/src/test-hooks.ts). */
export type TestHooks = {
  fieldCenter(id: number): { x: number; y: number };
  /** Where the Board last placed the given Player's pawn (viewport CSS px). */
  pawn(player: string): { x: number; y: number } | null;
  camera(): Camera;
  view(): PublicView | null;
  /**
   * Which push the decision gate is for and whether it is open (local
   * Playback and `actsAfter`), and the Turn the card shows while it waits.
   */
  playback(): PlaybackHook;
  /**
   * The server's clock estimated from this client's (`serverNow` from
   * `@universum/protocol/messages`): the latest push's offset, or the
   * Lobby's before the first push.
   */
  serverNow(): number;
  pick(): PickMarks | null;
  /**
   * Leaves an intent in flight (the lock `sendIntent` sets, with no answer), so
   * a spec can check the screen while a Sale or pick is busy. A `showView` push
   * clears it, like the server's answer.
   */
  holdIntent(): void;
  /**
   * Shows a made-up view (a full PublicView) as if the server had pushed it,
   * with optional events and one reveal per event.
   */
  showView(view: PublicView, events?: readonly GameEvent[], reveals?: readonly Reveal[]): void;
  /** The room store (only the fields the specs read). */
  room(): {
    me: string | null;
    status: string;
    /** The latest Rejection of one of this client's intents. */
    rejection: Rejection | null;
    push: {
      view: PublicView;
      /** The events of the push, in order. */
      events: { type: string }[];
      /** One board snapshot per event, in the same order (ADR-0005). */
      reveals: Reveal[];
      seq: number;
      clockOffset: number;
    } | null;
  };
};
