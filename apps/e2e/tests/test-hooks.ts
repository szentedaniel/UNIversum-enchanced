// The web app's test-only hooks (apps/web/src/test-hooks.ts), as the specs
// see them inside `page.evaluate`. One declaration for every spec.

export type ViewSummary = {
  turn: number;
  version: number;
  currentPlayer: string;
  /** When the latest push's Playback ends, by the server's clock (ADR-0004). */
  actsAfter: number;
  phase: {
    kind: string;
    field?: number;
    levels?: { level: number; price: number }[];
    /** The Museum's price on a Museum offer. */
    museum?: number;
    /** The Buyout price on a Buyout offer. */
    buyout?: number;
  };
  fields: { owner: string | null; level: number; value: number; rent: number }[];
};
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
/** A Player as a full pushed view carries them (PlayerView). */
export type ViewPlayer = {
  id: string;
  seat: number;
  name: { adjective: string; noun: string };
  cash: number;
  wealth: number;
  position: number;
  bankrupt: boolean;
  quarantineRounds: number | null;
  hasPcrTest: boolean;
};

export type FullPickOption =
  | { kind: "doubler"; field: number; rent: number; rentAfter: number }
  | {
      kind: "erasmus";
      field: number;
      steps: number;
      passesStart: boolean;
      bonus: number | null;
    };
/** A decision phase as the full pushed view (PublicView) carries it. */
export type FullPhase =
  | { kind: "awaitingRoll" }
  | {
      kind: "quarantineChoice";
      canBuyPcrTest: boolean;
      canUsePcrTest: boolean;
      pcrTestPrice: number;
    }
  | {
      kind: "offer";
      field: number;
      levels?: { level: number; price: number }[];
      museum?: number;
      buyout?: number;
    }
  | { kind: "selling"; shortfall: number; resume: unknown }
  | { kind: "placingDoubler"; fields: number[] }
  | { kind: "choosingErasmus"; fields: number[] }
  | { kind: "gameOver"; winner: string; reason: string };
/** The parts of a full pushed view (PublicView) that specs change before `showView`. */
export type FullView = {
  turn: number;
  version: number;
  currentPlayer: string;
  phase: FullPhase;
  players: ViewPlayer[];
  fields: { owner: string | null; level: number; value: number; rent: number; sale: number }[];
  doubler: { field: number; count: number } | null;
  autoSell: number[] | null;
  pickOptions: FullPickOption[] | null;
  actsAfter: number;
  turnDeadline: number | null;
  turnTimer: { endsAt: number; limitMs: number } | null;
  standings: { player: string; wealth: number }[] | null;
};

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
    universumTest?: TestHooks;
  }
}

/** The latest Rejection of one of this client's intents. */
export type Rejection = { code: string; seq: number };

/** `playback()`: the push the decision gate is for, whether it is open, and the shown Turn. */
export type PlaybackHook = {
  seq: number | null;
  over: boolean;
  shownTurn: { turn: number; currentPlayer: string } | null;
};

/** The test-only hooks the web app installs on `window.universumTest` (apps/web/src/test-hooks.ts). */
export type TestHooks = {
  fieldCenter(id: number): { x: number; y: number };
  camera(): Camera;
  view(): ViewSummary | null;
  /**
   * Which push the decision gate is for and whether it is open (local
   * Playback and `actsAfter`), and the Turn the card shows while it waits.
   */
  playback(): PlaybackHook;
  pick(): PickMarks | null;
  /** Shows a made-up view (a full PublicView) as if the server had pushed it, with optional events. */
  showView(view: FullView, events?: { type: string; [key: string]: unknown }[]): void;
  /** The room store (only the fields the specs read). */
  room(): {
    me: string | null;
    status: string;
    /** The latest Rejection of one of this client's intents. */
    rejection: Rejection | null;
    push: {
      view: FullView;
      /** The events of the push, in order. */
      events: { type: string }[];
      seq: number;
      clockOffset: number;
    } | null;
  };
};
