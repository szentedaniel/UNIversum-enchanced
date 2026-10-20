/**
 * Process crash handling (spec: Observability → Process crash): log at
 * `fatal`, give the error reporter at most 2 s to flush, then exit non-zero.
 * `docker compose` restarts the server and the Rooms are restored from the
 * store. The handlers are installed by `main.ts`; tests hand in an emitter,
 * a fake reporter and a fake exit.
 */
import type { ErrorReporter } from "#observability/error-reporting.ts";
import type { Logger } from "#observability/logger.ts";

/** How long a crash waits for queued error reports before it exits anyway. */
export const CRASH_FLUSH_MS = 2_000;

/** The part of `process` the handlers need (tests pass an `EventEmitter`). */
export type CrashEventSource = {
  on(
    event: "uncaughtException" | "unhandledRejection",
    listener: (reason: unknown) => void,
  ): unknown;
};

export type CrashHandlersOptions = {
  /** `process` in production. */
  source: CrashEventSource;
  log: Logger;
  reporter: ErrorReporter;
  exit: (code: number) => void;
  /** The flush cap; `CRASH_FLUSH_MS` unless a test shortens it. */
  timeoutMs?: number;
};

/** Installs the two handlers. A second crash while flushing exits at once. */
export function installCrashHandlers({
  source,
  log,
  reporter,
  exit,
  timeoutMs = CRASH_FLUSH_MS,
}: CrashHandlersOptions): void {
  let crashing = false;
  let exited = false;
  const finish = (): void => {
    if (exited) return;
    exited = true;
    exit(1);
  };
  const crash = (reason: unknown): void => {
    if (crashing) {
      log.fatal({ err: reason }, "Server crashed again while flushing");
      finish();
      return;
    }
    crashing = true;
    log.fatal({ err: reason }, "Server crashed");
    const timer = setTimeout(finish, timeoutMs);
    // The timer must not hold the process open on its own; `finish` does exit.
    timer.unref?.();
    void reporter.flush(timeoutMs).then(finish, (error: unknown) => {
      log.error({ err: error }, "Error reports did not flush");
      finish();
    });
  };
  source.on("uncaughtException", crash);
  source.on("unhandledRejection", crash);
}
