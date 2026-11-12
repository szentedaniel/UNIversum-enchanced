/**
 * The factory's heartbeat: one `factory-tick.yml` run ticks every ten minutes
 * for about 5.5 hours, then dispatches its successor and exits. GitHub's cron
 * is only the safety net: a run that finds a newer heartbeat queued or running
 * exits without ticking, and the relay keeps exactly one chain alive.
 *
 * Pure: the clock, the wait and the relay are injected, so the test moves a
 * fake clock instead of sleeping and records the relay instead of dispatching.
 * A failed tick is collected, a missed tick slot is skipped rather than caught
 * up, and the hand-over is retried; one bad tick or one refused dispatch never
 * leaves the factory without a heartbeat.
 */

/** How often a heartbeat ticks; the cron's own period is the same. */
export const TICK_INTERVAL_MS = 10 * 60 * 1000;

/** GitHub's job limit. A heartbeat that reaches it is killed without relaying. */
export const JOB_LIMIT_MS = 6 * 60 * 60 * 1000;

/** The hand-over keeps this much room under the job limit for a final tick and the relay. */
export const HANDOVER_MARGIN_MS = 30 * 60 * 1000;

/** The loop's length: 33 ticks, then the hand-over, with 30 minutes to spare. */
export const HEARTBEAT_LENGTH_MS = JOB_LIMIT_MS - HANDOVER_MARGIN_MS;

/** Relay attempts before the run fails: one refused dispatch must not end the chain. */
export const RELAY_ATTEMPTS = 3;

/** How long to wait before trying the relay again. */
export const RELAY_RETRY_MS = 60 * 1000;

/** The runs API statuses a heartbeat can be in; only one is live at a time. */
export const LIVE_STATUSES = ["in_progress", "queued"] as const;

export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** A tick run as the runs API reports it. */
export interface LiveRun {
  readonly id: number;
  readonly status: string;
  readonly event: string;
  readonly display_title?: string;
}

/** The `run-name` marker a dry run carries; `factory-tick.yml` writes it. */
export const DRY_RUN_MARKER = "(dry run)";

/** What one tick reports back; `runTick`'s outcome fits, and a test can fake it. */
export interface TickResult {
  readonly errors: readonly string[];
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The other heartbeat that makes this start a duplicate. Only a newer run can
 * be one: an older run either ran before this one or was replaced in the
 * concurrency group, and the runs API keeps listing it as queued while its
 * cancellation lands. A scheduled (cron) run is only the safety net and a dry
 * run ticks once without relaying, so neither counts.
 */
export const liveHeartbeat = (runs: readonly LiveRun[], selfId: number): LiveRun | undefined =>
  runs.find(
    (run) =>
      run.id > selfId &&
      LIVE_STATUSES.some((live) => live === run.status) &&
      run.event !== "schedule" &&
      !run.display_title?.includes(DRY_RUN_MARKER),
  );

export interface HeartbeatWindow {
  /** The ticks, the first at `start` and the rest one interval apart. */
  readonly ticks: readonly Date[];
  /** When the heartbeat stops ticking and hands over to its successor. */
  readonly handoverAt: Date;
}

/** One heartbeat's ticks and its hand-over, all measured from `start`. */
export const heartbeatWindow = (start: Date): HeartbeatWindow => {
  const ticks: Date[] = [];
  for (let offset = 0; offset < HEARTBEAT_LENGTH_MS; offset += TICK_INTERVAL_MS) {
    ticks.push(new Date(start.getTime() + offset));
  }
  return { ticks, handoverAt: new Date(start.getTime() + HEARTBEAT_LENGTH_MS) };
};

export interface HeartbeatDeps {
  readonly now: () => Date;
  /** Waits `ms`; a test advances its fake clock instead. */
  readonly sleep: (ms: number) => Promise<void>;
  /** True when a newer heartbeat is queued or running: this run exits. */
  readonly live: () => boolean;
  readonly tick: (now: Date) => TickResult;
  /** Dispatches the successor; throws when the dispatch fails. */
  readonly relay: () => void;
  readonly log: (line: string) => void;
}

export interface HeartbeatOutcome {
  /** Another heartbeat was alive, so this run ticked nothing. */
  readonly duplicate: boolean;
  /** The ticks attempted, including the failed ones. */
  readonly ticks: number;
  readonly relayed: boolean;
  /** One line per failed tick and a failed relay; the caller fails the run with them. */
  readonly errors: readonly string[];
}

/** The one wait helper: a tick time already passed needs no sleep. */
const wait = async (ms: number, sleep: (ms: number) => Promise<void>): Promise<void> => {
  if (ms > 0) await sleep(ms);
};

/** Hands over to the successor, retrying a refused dispatch. */
const relayToSuccessor = async (
  at: Date,
  {
    relay,
    sleep,
    log,
    errors,
  }: Pick<HeartbeatDeps, "relay" | "sleep" | "log"> & {
    readonly errors: string[];
  },
): Promise<boolean> => {
  for (let attempt = 1; attempt <= RELAY_ATTEMPTS; attempt += 1) {
    try {
      relay();
      log(`Handed over to the next heartbeat at ${at.toISOString()}.`);
      return true;
    } catch (error) {
      const message = messageOf(error);
      if (attempt === RELAY_ATTEMPTS) {
        errors.push(
          `could not relay the next heartbeat after ${RELAY_ATTEMPTS} attempts: ${message}`,
        );
        return false;
      }
      log(`Relay attempt ${attempt} failed: ${message}; retrying in ${RELAY_RETRY_MS / 1000} s.`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- the hand-over retries one at a time
      await sleep(RELAY_RETRY_MS);
    }
  }
  return false;
};

/**
 * One heartbeat: exit if a newer one is alive, tick every ten minutes until the
 * hand-over, then relay the successor. A tick that throws or reports errors is
 * collected and logged, a tick slot the previous one overran is skipped, and a
 * refused relay is retried.
 */
export const runHeartbeat = async ({
  now,
  sleep,
  live,
  tick,
  relay,
  log,
}: HeartbeatDeps): Promise<HeartbeatOutcome> => {
  if (live()) {
    log("A newer heartbeat is queued or running; this run exits without ticking.");
    return { duplicate: true, ticks: 0, relayed: false, errors: [] };
  }

  const window = heartbeatWindow(now());
  const errors: string[] = [];
  let ticks = 0;

  for (const at of window.ticks) {
    const delay = at.getTime() - now().getTime();
    // A tick that overran its interval leaves its slot behind: skip it rather
    // than firing the missed ticks back to back.
    if (delay < 0) {
      log(`Skipping the tick at ${at.toISOString()}: the previous one overran.`);
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the ticks are one heartbeat: one at a time, ten minutes apart
    await wait(delay, sleep);
    ticks += 1;
    try {
      const { errors: tickErrors } = tick(now());
      for (const error of tickErrors) log(`Tick error: ${error}`);
      errors.push(...tickErrors);
    } catch (error) {
      const message = `tick at ${at.toISOString()} failed: ${messageOf(error)}`;
      log(message);
      errors.push(message);
    }
  }

  await wait(window.handoverAt.getTime() - now().getTime(), sleep);
  const relayed = await relayToSuccessor(window.handoverAt, { relay, sleep, log, errors });

  return { duplicate: false, ticks, relayed, errors };
};
