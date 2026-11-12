/**
 * The factory's heartbeat entry for `factory-tick.yml`: the loop, its cadence
 * and the duplicate rule live in `heartbeat.ts`; this file owns the real clock
 * and sleep, the runs API check and the relay. `DRY_RUN=1` ticks once and
 * starts no successor.
 *
 * Every `gh` call is capped at `GH_CALL_TIMEOUT_MS`, so a hung call fails like
 * any other error: the tick records it and the loop still reaches its hand-over
 * in time to relay.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), GITHUB_RUN_ID, DRY_RUN.
 */
import {
  LIVE_STATUSES,
  liveHeartbeat,
  messageOf,
  runHeartbeat,
  type LiveRun,
  type LiveStatus,
} from "#schedule/heartbeat.ts";
import { GH_CALL_TIMEOUT_MS, runTick, tickWiring } from "#schedule/tick.ts";
import { fail, required, sh } from "#shared/common.ts";

const TICK_WORKFLOW = "factory-tick.yml";

/** One page of this workflow's runs in `status`; at most one is live, so 100 is plenty. */
const liveRuns = (repo: string, status: LiveStatus): readonly LiveRun[] => {
  const runs: unknown = JSON.parse(
    sh(
      `gh api "repos/${repo}/actions/workflows/${TICK_WORKFLOW}/runs?status=${status}&per_page=100" --jq '.workflow_runs'`,
      GH_CALL_TIMEOUT_MS,
    ),
  );
  if (!Array.isArray(runs)) throw new Error(`The ${status} tick runs page is not an array.`);
  return runs as readonly LiveRun[];
};

/** The dry tick and the heartbeat fail the run on the same rule. */
const failOn = (what: string, errors: readonly string[]): void => {
  if (errors.length > 0) fail(`The ${what} hit errors:\n- ${errors.join("\n- ")}`);
};

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  const dryRun = process.env["DRY_RUN"] === "1";
  const wiring = tickWiring(repo);
  const now = new Date();

  console.log(`Factory heartbeat — ${now.toISOString()}`);

  if (dryRun) {
    const { errors } = runTick({ now, dryRun: true, ...wiring, log: console.log });
    failOn("dry tick", errors);
    console.log("Dry run: one tick, no successor.");
    return;
  }

  const selfId = Number(required("GITHUB_RUN_ID"));
  const outcome = await runHeartbeat({
    now: () => new Date(),
    sleep: (ms) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    },
    live: () =>
      liveHeartbeat(
        LIVE_STATUSES.flatMap((status) => liveRuns(repo, status)),
        selfId,
      ) !== undefined,
    tick: (tickNow) => runTick({ now: tickNow, dryRun: false, ...wiring, log: console.log }),
    relay: () => {
      sh(`gh workflow run ${TICK_WORKFLOW} --ref main`, GH_CALL_TIMEOUT_MS);
    },
    log: console.log,
  });

  if (outcome.duplicate) return;
  failOn("heartbeat", outcome.errors);
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    fail(messageOf(error));
  }
}
