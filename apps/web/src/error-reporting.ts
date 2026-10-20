/**
 * Client error reporting (spec: Observability → Errors). Off unless the
 * server says `errorReporting` is true on `/client-config`; then `@sentry/react`
 * sends errors through the server's `/errors` tunnel, which swaps the
 * placeholder DSN for the real one and strips the IP and every token. No
 * sessions, replays or tracing, and no PII.
 */
import * as Sentry from "@sentry/react";

/** Vite replaces this with the git SHA (`RELEASE`), the same `release` as the server. */
declare const CLIENT_RELEASE: string;

/** The tracker is never contacted directly: the tunnel rewrites this DSN. */
const PLACEHOLDER_DSN = "https://public@errors.invalid/1";

/** Starts reporting when the server has a `SENTRY_DSN`; never throws. */
export async function startErrorReporting(): Promise<void> {
  try {
    const response = await fetch("/client-config");
    if (!response.ok) return;
    const config: unknown = await response.json();
    if (
      typeof config !== "object" ||
      config === null ||
      !("errorReporting" in config) ||
      config.errorReporting !== true
    ) {
      return;
    }
    Sentry.init({
      dsn: PLACEHOLDER_DSN,
      release: CLIENT_RELEASE,
      tunnel: "/errors",
      // Sentry 11's replacement for `sendDefaultPii: false`: no user info (so
      // no IP), cookies, headers, bodies or source variables.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
      },
      // No sessions (spec); errors only, so no tracing or replay integrations.
      integrations: (integrations) =>
        integrations.filter((integration) => integration.name !== "BrowserSession"),
    });
  } catch {
    // Reporting is optional: the game works with no tracker and no DSN.
  }
}
