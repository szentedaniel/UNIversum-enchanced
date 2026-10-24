/**
 * `pnpm loadtest`: the launch-peak load test and its PASS/FAIL verdict
 * (spec: Load test). See `--help` for the scaled-down smoke run.
 */
import { parseArgs } from "#args.ts";
import { runLoadTest } from "#runner.ts";

const parsed = parseArgs(process.argv.slice(2));
if (parsed.kind === "help") {
  console.log(parsed.text);
  process.exit(0);
}
process.exitCode = await runLoadTest(parsed.options);
