/**
 * Server-side error reporting (spec: Observability → Errors). Off unless
 * `SENTRY_DSN` is set: then `@sentry/node` sends to whatever Sentry-protocol
 * tracker the DSN names. Only ids and codes are reported (Room code, state
 * `version`, `phase`, intent type), never a snapshot, a payload, a token or an IP.
 */

/** What a report says about where it happened: closed sets and ids only. */
export type ErrorContext = {
  roomCode?: string;
  version?: number;
  phase?: string;
  intent?: string;
};

export type ErrorReporter = {
  /** Sends `error` to the tracker, tagged with `context`. */
  report(error: unknown, context?: ErrorContext): void;
  /** Sends what is queued, waiting at most `timeoutMs`. */
  flush(timeoutMs: number): Promise<void>;
};

/** Reporting is off: nothing leaves the server (errors still reach the logs). */
export const noReporter: ErrorReporter = {
  report() {},
  flush: async () => {},
};
