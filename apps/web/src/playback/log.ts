/**
 * The Event log (#182): the lines of the events the Playback has revealed so
 * far, newest last. It is client-side history — a reload or a reconnect starts
 * empty — and it appends across pushes itself, because a push replaces the
 * previous one. Each line's text is fixed when the line is appended, from the
 * push's own view and in the language active then, so a later view (whose
 * Players may have changed) never rewrites an earlier line.
 *
 * The Playback core says how many of a push's events it has reached; this
 * module turns those events into lines once each, skipping an event whose
 * presentation has nothing to say (`eventText` returns `null`).
 */
import type { GameEvent, PublicView } from "@universum/rules";
import { eventText } from "#playback/presentation.ts";

/** One line: an event's text, with the push and index that identify it. */
export type LogLine = {
  /** The push the line belongs to. */
  seq: number;
  /** The event's place in that push. */
  index: number;
  text: string;
};

/** The parts of a push the log reads. */
export type LogPush = {
  seq: number;
  view: PublicView;
  events: readonly GameEvent[];
};

/** What the log keeps, and how far into which push it has read. */
export type LogState = {
  lines: readonly LogLine[];
  /** The last push read and the number of its events considered; `null` before the first. */
  cursor: { seq: number; shown: number } | null;
};

/** The most lines kept: the oldest are dropped, so a long game cannot grow without bound. */
export const LOG_LIMIT = 200;

/** An empty log: what a reload or a new Room starts with. */
export const emptyLog: LogState = { lines: [], cursor: null };

/**
 * The log after the Playback has reached `revealed` of the push's events.
 * Reading the same push again appends nothing; a later push starts a new
 * cursor and keeps the earlier lines.
 */
export function appendRevealed(log: LogState, push: LogPush, revealed: number): LogState {
  const cursor = log.cursor;
  // A frame left over from a push the log has already passed adds nothing.
  if (cursor !== null && push.seq < cursor.seq) return log;
  const from = cursor !== null && cursor.seq === push.seq ? cursor.shown : 0;
  const to = Math.min(Math.max(revealed, 0), push.events.length);
  if (from === to && cursor !== null && cursor.seq === push.seq) return log;

  const appended: LogLine[] = [];
  for (let index = from; index < to; index += 1) {
    const event = push.events[index];
    if (!event) continue;
    const text = eventText(event, push.view);
    if (text !== null) appended.push({ seq: push.seq, index, text });
  }

  if (appended.length === 0) return { lines: log.lines, cursor: { seq: push.seq, shown: to } };
  const lines = [...log.lines, ...appended];
  return {
    lines: lines.length > LOG_LIMIT ? lines.slice(lines.length - LOG_LIMIT) : lines,
    cursor: { seq: push.seq, shown: to },
  };
}
