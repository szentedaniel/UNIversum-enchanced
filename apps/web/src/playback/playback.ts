/**
 * The Playback core (ADR-0004, spec #63): one push, one clock. It turns a
 * push into the moments the screen must re-read (`boundaries` and `opensAt`)
 * and answers what the screen shows at any client time (`frameAt`): the dice
 * or the Chance card, the toast's latest line, the Decision gate, the held
 * Turn label, each pawn's Field position and the board the current step
 * reveals (ADR-0005).
 *
 * Every Playback arithmetic lives here. The timeline gives each event its
 * start and duration from the rules' `PLAYBACK_MS`; the presentation table
 * gives its overlay and toast line. The store owns the only timer.
 */
import type { FieldId } from "@universum/rules/board";
import { FIELD_COUNT } from "@universum/rules/board";
import type { EventOf, GameEvent, PlayerId, PublicView, Reveal } from "@universum/rules";
import { playbackOf } from "@universum/rules/playback";
import { eventText, toneOf, type Tone } from "#playback/presentation.ts";
import { stepAt, timelineOf, type PlaybackStep } from "#playback/timeline.ts";

/** The parts of a push the Playback reads. */
export type PlaybackPush = {
  view: PublicView;
  events: readonly GameEvent[];
  /** One board snapshot per event, in the same order (ADR-0005); empty on a reconnect. */
  reveals: readonly Reveal[];
  /** The push's identity (`Push.seq`); a frame never mixes two pushes. */
  seq: number;
  /** The server's clock minus this client's, from the push. */
  clockOffset: number;
  /** This client's clock when the push arrived: its Playback starts here. */
  receivedAt: number;
};

/** The Turn card's heading and number: the values shown before and after the gate. */
export type TurnLabel = { turn: number; currentPlayer: PlayerId };

/**
 * A pawn's place at t, as Field numbers: the Field it stands on (the hop's
 * start while walking), the Field it is heading to, and how far along.
 */
export type PawnPosition = {
  field: FieldId;
  /** The Field being hopped to, or `null` when the pawn stands still. */
  toward: FieldId | null;
  /** How far along `toward`, 0–1; 0 when standing. */
  progress: number;
};

/** The toast's line: the latest step that has text, in the active language. */
export type PlaybackToast = { event: GameEvent; text: string; tone: Tone };

/** The dice or the Chance card, for as long as its step lasts. */
export type PlaybackOverlay = Extract<PlaybackStep, { kind: "dice" | "card" }>;

/** Everything the screen shows at one instant of a push. */
export type Frame = {
  seq: number;
  /**
   * What the Board and the Player cards show: the push's view with the current
   * step's Players, Fields and Doubler, and the push's own view once the
   * Playback ends (ADR-0005).
   */
  view: PublicView;
  overlay: PlaybackOverlay | null;
  toast: PlaybackToast | null;
  gateOpen: boolean;
  shownTurn: TurnLabel;
  pawns: ReadonlyMap<PlayerId, PawnPosition>;
  /** The Player whose pawn is mid-hop, for the camera to follow; else `null`. */
  walking: PlayerId | null;
};

export type Playback = {
  /** When the decision opens, on this client's clock. */
  opensAt: number;
  /** Client ms of every step end following the push, and `opensAt`, sorted and unique. */
  boundaries: readonly number[];
  frameAt(clientNow: number): Frame;
};

type Cue = {
  /** Where the cue starts, in ms from the push's arrival. */
  startMs: number;
  event: GameEvent;
  text: string;
  tone: Tone;
};

/** The steps that have text, in order: the toast shows each from its own start. */
function cuesOf(steps: readonly PlaybackStep[], view: PublicView): Cue[] {
  const cues: Cue[] = [];
  for (const step of steps) {
    if (step.kind === "none") continue;
    const text = eventText(step.event, view);
    if (text === null) continue;
    cues.push({ startMs: step.startMs, event: step.event, text, tone: toneOf(step.event) });
  }
  return cues;
}

/** The last cue that has started by `elapsedMs`; `null` before the first. */
function cueAt(cues: readonly Cue[], elapsedMs: number): Cue | null {
  let shown: Cue | null = null;
  for (const cue of cues) {
    if (cue.startMs > elapsedMs) break;
    shown = cue;
  }
  return shown;
}

/**
 * The last step that has started by `elapsedMs`, zero-length steps included:
 * several steps at the same ms resolve to the last of them, and `-1` before
 * the first. A reveal shows from its step's start, the toast cue's rule — not
 * `stepAt`, which skips zero-length steps.
 */
function startedStepIndex(steps: readonly PlaybackStep[], elapsedMs: number): number {
  let shown = -1;
  for (let index = 0; index < steps.length; index += 1) {
    if ((steps[index]?.startMs ?? 0) > elapsedMs) break;
    shown = index;
  }
  return shown;
}

/**
 * The push's view as one step shows it: the Players, the Fields and the
 * Doubler come from the step's reveal, while each Player's position stays the
 * final view's, because the pawn walk already plays positions (ADR-0005).
 * Built once per step, never in `frameAt`: the Board re-syncs on a changed
 * view object and skips an unchanged one.
 */
function viewOfStep(view: PublicView, reveal: Reveal | undefined): PublicView {
  if (!reveal) return view;
  const positions = new Map(view.players.map((player) => [player.id, player.position]));
  return {
    ...view,
    players: reveal.players.map((player) => ({
      ...player,
      position: positions.get(player.id) ?? player.position,
    })),
    fields: reveal.fields,
    doubler: reveal.doubler,
  };
}

/** A step whose event moved a pawn; its `from`, `to` and `steps` drive the walk. */
type MovedStep = PlaybackStep & { event: EventOf<"Moved"> };

const isMovedStep = (step: PlaybackStep): step is MovedStep => step.event.type === "Moved";

/** Each Player's `Moved` steps, in order: the only place a position changes in the rules. */
function movesByPlayer(steps: readonly PlaybackStep[]): Map<PlayerId, MovedStep[]> {
  const moves = new Map<PlayerId, MovedStep[]>();
  for (const step of steps) {
    if (!isMovedStep(step)) continue;
    const own = moves.get(step.event.player);
    if (own) own.push(step);
    else moves.set(step.event.player, [step]);
  }
  return moves;
}

/**
 * Every pawn's place at `elapsedMs` and the one mid-hop: before a Player's
 * first `Moved` step its `from`, hop by hop during a step, the last `to`
 * between steps, and the final view once the Playback has run out.
 */
function pawnsAt(
  view: PublicView,
  moves: ReadonlyMap<PlayerId, readonly MovedStep[]>,
  elapsedMs: number,
  playbackEndMs: number,
): { pawns: ReadonlyMap<PlayerId, PawnPosition>; walking: PlayerId | null } {
  const pawns = new Map<PlayerId, PawnPosition>();
  let walking: PlayerId | null = null;
  for (const player of view.players) {
    pawns.set(player.id, { field: player.position, toward: null, progress: 0 });
    if (elapsedMs >= playbackEndMs) continue;
    const own = moves.get(player.id) ?? [];
    const first = own[0];
    if (first && elapsedMs < first.startMs) {
      pawns.set(player.id, { field: first.event.from, toward: null, progress: 0 });
      continue;
    }
    for (const step of own) {
      if (step.startMs > elapsedMs) break;
      const endMs = step.startMs + step.durationMs;
      if (elapsedMs >= endMs) {
        pawns.set(player.id, { field: step.event.to, toward: null, progress: 0 });
        continue;
      }
      const progress = (elapsedMs - step.startMs) / step.durationMs;
      const walked = progress * step.event.steps;
      const hop = Math.min(Math.floor(walked), step.event.steps - 1);
      const from = (step.event.from + hop) % FIELD_COUNT;
      pawns.set(player.id, {
        field: from,
        toward: (from + 1) % FIELD_COUNT,
        progress: walked - hop,
      });
      walking ??= player.id;
      break;
    }
  }
  return { pawns, walking };
}

/** One push's Playback. `previousTurn` is the label the screen shows before the gate opens. */
export function playbackOfPush(
  push: PlaybackPush,
  previousTurn: TurnLabel | null = null,
): Playback {
  const steps = timelineOf(push.events);
  const playbackEndMs = playbackOf(push.events);
  const views = steps.map((_, index) => viewOfStep(push.view, push.reveals[index]));
  const cues = cuesOf(steps, push.view);
  const moves = movesByPlayer(steps);

  // The gate: the local Playback and the server's `actsAfter` on this client's
  // clock (a server timestamp becoming a client one: the one inverse conversion).
  const actsAfter = push.view.actsAfter - push.clockOffset;
  const opensAt = Math.max(push.receivedAt + playbackEndMs, actsAfter);

  const ends = steps.map((step) => push.receivedAt + step.startMs + step.durationMs);
  ends.push(opensAt);
  const boundaries = [...new Set(ends)].toSorted((a, b) => a - b);

  const current: TurnLabel = { turn: push.view.turn, currentPlayer: push.view.currentPlayer };
  const hasPlayback = steps.length > 0;

  return {
    opensAt,
    boundaries,
    frameAt(clientNow) {
      const elapsedMs = clientNow - push.receivedAt;
      // The current step's board until the Playback ends; the push's own view after.
      const stepIndex = elapsedMs >= playbackEndMs ? -1 : startedStepIndex(steps, elapsedMs);
      const gateOpen = clientNow >= opensAt;
      const shown = stepAt(steps, elapsedMs);
      const cue = cueAt(cues, elapsedMs);
      const pawns = pawnsAt(push.view, moves, elapsedMs, playbackEndMs);
      return {
        seq: push.seq,
        view: stepIndex === -1 ? push.view : (views[stepIndex] ?? push.view),
        overlay: shown?.kind === "dice" || shown?.kind === "card" ? shown : null,
        toast: cue ? { event: cue.event, text: cue.text, tone: cue.tone } : null,
        gateOpen,
        // Story 4: the heading and Turn number switch with the controls.
        shownTurn: previousTurn === null || gateOpen || !hasPlayback ? current : previousTurn,
        pawns: pawns.pawns,
        walking: pawns.walking,
      };
    },
  };
}
