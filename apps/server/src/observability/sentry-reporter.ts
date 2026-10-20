/**
 * `@sentry/node` behind the `ErrorReporter` seam. Started only when
 * `SENTRY_DSN` is set (`main.ts`), and every value it sends follows the
 * spec's never-log list: no PII, cookies, headers, bodies or sessions, and the
 * context carries closed sets and ids only.
 */
import * as Sentry from "@sentry/node";
import type { ErrorReporter } from "#observability/error-reporting.ts";
import type { Dsn } from "#observability/dsn.ts";

export type SentryReporterOptions = {
  /** The tracker's DSN, as `SENTRY_DSN` gave it. */
  dsn: Dsn;
  /** The git SHA (`RELEASE`), the same on the server and the client. */
  release: string;
};

/**
 * Starts the SDK and returns the reporter. The default uncaught-exception and
 * unhandled-rejection integrations capture the crash; they leave the exit to
 * `installCrashHandlers`, which flushes and exits.
 */
export function createSentryReporter({ dsn, release }: SentryReporterOptions): ErrorReporter {
  Sentry.init({
    dsn: dsn.dsn,
    release,
    // The v11 replacement for `sendDefaultPii: false`: no user info (so no IP),
    // cookies, headers, bodies or local variables. Errors only: no tracing, no
    // replays, and sessions are removed below.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
      genAI: { inputs: false, outputs: false },
    },
    integrations: (integrations) =>
      integrations.filter((integration) => integration.name !== "ProcessSession"),
  });
  return {
    report(error, context) {
      Sentry.withScope((scope) => {
        if (context?.roomCode !== undefined) scope.setTag("roomCode", context.roomCode);
        if (context?.version !== undefined) scope.setTag("version", String(context.version));
        if (context?.phase !== undefined) scope.setTag("phase", context.phase);
        if (context?.intent !== undefined) scope.setTag("intent", context.intent);
        Sentry.captureException(error);
      });
    },
    async flush(timeoutMs) {
      // A transport error must never keep the process from exiting.
      await Sentry.flush(timeoutMs).catch(() => false);
    },
  };
}
