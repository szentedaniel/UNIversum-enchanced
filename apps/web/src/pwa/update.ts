/**
 * The refresh prompt (spec: Mobile polish and installable PWA, Decision 3).
 *
 * A build writes its release (`CLIENT_RELEASE`) into the page, and the same
 * release into `/version.json`; when the deployment serves a different one,
 * the page offers a refresh instead of reloading under the Player. `/version.json`
 * is a static file (Caddy revalidates it), never a server endpoint, and a
 * failed fetch — offline, a 404, a malformed body — is silent.
 */

/** Where the deployment publishes the release it serves. */
const VERSION_URL = "/version.json";

/** How often a visible page asks again; a returning tab checks through its visibility event. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;

/** The narrow `fetch` the checker needs; the real one fits. */
export type VersionFetch = (
  url: string,
  init: { cache: "no-store" },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The release a `/version.json` body carries, or null when it is not one. */
export function releaseOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("release" in body)) return null;
  return typeof body.release === "string" && body.release !== "" ? body.release : null;
}

/** The release the deployment serves; offline, missing or malformed answers null. */
export async function deployedRelease(fetcher: VersionFetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(VERSION_URL, { cache: "no-store" });
    if (!response.ok) return null;
    return releaseOf(await response.json());
  } catch {
    return null;
  }
}

/**
 * Whether this build is stale: the deployment serves another release. `dev` is
 * not a release (a dev server or a local build), so it never prompts.
 */
export function updateAvailable(current: string, deployed: string | null): boolean {
  if (current === "dev" || deployed === null || deployed === "dev") return false;
  return current !== deployed;
}

/**
 * Whether a reload is safe here. A Game holds the Player's Seat, Turn and open
 * Decision; the refresh prompt never reloads it under them (spec Decision 3).
 */
export function canReload(pathname: string): boolean {
  return !pathname.startsWith("/game/");
}

/** A scheduled check: `cancel` stops it before it runs. */
export type ScheduleCheck = (run: () => void, ms: number) => () => void;

/** The visibility event's subscription: `cancel` removes the listener. */
export type ListenVisible = (run: () => void) => () => void;

export type UpdateWatchOptions = {
  /** This build's release (`CLIENT_RELEASE`). */
  current: string;
  /** The deployment serves another release: show the prompt once. */
  onUpdate(deployed: string): void;
  /** The release fetch; injectable for tests. */
  release?: () => Promise<string | null>;
  /** The interval's scheduler; injectable for tests. */
  schedule?: ScheduleCheck;
  /** The visibility subscription; injectable for tests. */
  listenVisible?: ListenVisible;
};

/** The stop function a mounted `UpdatePrompt` returns from its effect. */
export type StopUpdateWatch = () => void;

/** Nothing to cancel, until both subscriptions are in place. */
const noCancel: StopUpdateWatch = () => undefined;

/** One timeout, cancelled by the returned function. */
function intervalTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

/** A check whenever the tab comes back into view. */
function visibilityListener(run: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const listener = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/**
 * Checks at once, then every interval and whenever the tab becomes visible.
 * The first update stops the watch: the prompt stays until the page reloads.
 * The returned function stops both the timer and the listener.
 */
export function watchForUpdate(options: UpdateWatchOptions): StopUpdateWatch {
  const release = options.release ?? (() => deployedRelease());
  const schedule = options.schedule ?? intervalTimer;
  const listen = options.listenVisible ?? visibilityListener;
  let stopped = false;
  let cancelTimer: StopUpdateWatch = noCancel;
  let cancelVisible: StopUpdateWatch = noCancel;

  const check = async () => {
    if (stopped) return;
    let deployed: string | null;
    try {
      deployed = await release();
    } catch {
      return;
    }
    if (stopped || deployed === null || !updateAvailable(options.current, deployed)) return;
    // One prompt is the answer: stop asking until the next launch.
    stopped = true;
    cancelTimer();
    cancelVisible();
    options.onUpdate(deployed);
  };

  cancelTimer = schedule(() => void check(), UPDATE_CHECK_INTERVAL_MS);
  cancelVisible = listen(() => void check());
  void check();

  return () => {
    stopped = true;
    cancelTimer();
    cancelVisible();
  };
}
