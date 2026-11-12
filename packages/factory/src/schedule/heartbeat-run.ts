/**
 * The factory's heartbeat run: one `factory-tick.yml` run ticks every ten
 * minutes for about 5.5 hours, then dispatches its successor and exits. A run
 * that finds another tick run queued or running exits without ticking, so
 * GitHub's ten-minute cron is only the safety net and one heartbeat is live at
 * a time.
 *
 * The loop, the tick cadence and the duplicate-start rule live in
 * `heartbeat.ts`; the tick's own rules stay in `tick.ts` and `due.ts`. This
 * entry owns the real clock and sleep, the runs API check and the relay.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), GITHUB_RUN_ID, DRY_RUN.
 */
import { liveHeartbeat, runHeartbeat, type LiveRun } from "#schedule/heartbeat.ts";
import { runTick, tickWiring } from "#schedule/tick.ts";
import { fail, required, sh } from "#shared/common.ts";

const TICK_WORKFLOW = "factory-tick.yml";

/** The runs API statuses a heartbeat can be in; only one is live at a time. */
type LiveStatus = "in_progress" | "queued";

/** One page of this workflow's runs in `status`; at most one is live, so 100 is plenty. */
const liveRuns = (repo: string, status: LiveStatus): readonly LiveRun[] => {
  const runs: unknown = JSON.parse(
    sh(
      `gh api "repos/${repo}/actions/workflows/${TICK_WORKFLOW}/runs?status=${status}&per_page=100" --jq '.workflow_runs'`,
    ),
  );
  if (!Array.isArray(runs)) throw new Error(`The ${status} tick runs page is not an array.`);
  return runs as readonly LiveRun[];
};

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  const dryRun = process.env["DRY_RUN"] === "1";
  const wiring = tickWiring(repo);
  const now = new Date();

  console.log(`Factory heartbeat — ${now.toISOString()}`);

  if (dryRun) {
    const outcome = runTick({ now, dryRun: true, ...wiring, log: console.log });
    if (outcome.errors.length > 0) {
      fail(`The dry tick hit errors:\n- ${outcome.errors.join("\n- ")}`);
    }
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
      liveHeartbeat([...liveRuns(repo, "in_progress"), ...liveRuns(repo, "queued")], selfId) !==
      undefined,
    tick: (tickNow) => runTick({ now: tickNow, dryRun: false, ...wiring, log: console.log }),
    relay: () => {
      sh(`gh workflow run ${TICK_WORKFLOW} --ref main`);
    },
    log: console.log,
  });

  if (outcome.duplicate) return;
  if (outcome.errors.length > 0) {
    fail(`The heartbeat hit errors:\n- ${outcome.errors.join("\n- ")}`);
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
