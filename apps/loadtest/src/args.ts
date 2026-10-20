/**
 * The `pnpm loadtest` command line. Everything the run needs is resolved here,
 * with the spec's profile as the default, so the runner only executes a plan.
 */
import { availableParallelism } from "node:os";
import {
 DEFAULT_PROFILE,
 KNEE_PROFILE,
 defaultReportDir,
 resolveEndpoint,
 type KneeProfile,
 type LoadProfile,
} from "#config.ts";

export type RunOptions = {
 profile: LoadProfile;
 /** `null`: the normal ramp/hold/kill run; otherwise the knee search. */
 knee: KneeProfile | null;
 /** Where the generator connects: Caddy in front of the Room server. */
 endpoint: string;
 httpPort: number;
 prometheusPort: number;
 grafanaPort: number;
 projectName: string;
 /** Build the images before starting compose (off with `--no-build`). */
 build: boolean;
 /** Leave the compose stack (and its SQLite volume) running after the run. */
 keep: boolean;
 workers: number;
 reportDir: string;
 /** Profile changes the operator should know about (e.g. a scaled-down smoke). */
 warnings: string[];
};

export type ParsedArgs = { kind: "help"; text: string } | { kind: "run"; options: RunOptions };

export const HELP = `Usage: pnpm loadtest [--] [options]

Both \`pnpm loadtest --rooms 20 ...\` and \`pnpm loadtest -- --rooms 20 ...\`
work: pnpm 12 forwards the separator to the script, and it is ignored here.

Runs the launch peak against docker compose: 1,000 Rooms of 4 over a 10-minute
ramp, a 30-minute hold, a SIGKILL 20 minutes in, and a PASS/FAIL verdict from
Prometheus plus the generator's own round-trip and Seat checks.

  --rooms N            Rooms scheduled over the ramp (default 1000)
  --players N          Guests per Room, 2/3/4 (default 4)
  --ramp DURATION      Ramp length, e.g. 10m (default 10m)
  --hold DURATION      Hold length, e.g. 30m (default 30m)
  --restart-at DURATION  Kill this far into the hold (default 20m; the middle
                       when the hold is shorter)
  --minute-limit N     Every Room's Minute limit, 15/30/50 (default 15)
  --watchers N         Lobby-list watchers (default 200)
  --seed N             Seeds the generated profile (default 46)
  --workers N          Generator worker threads (default: one per core)
  --http-port N        Caddy's host port (default 8080, env LOADTEST_HTTP_PORT)
  --prometheus-port N  Prometheus host port (default 9090, env LOADTEST_PROMETHEUS_PORT)
  --grafana-port N     Grafana host port (default 3000, env LOADTEST_GRAFANA_PORT)
  --project NAME       Compose project name (default universum-loadtest)
  --endpoint URL       Generator endpoint (default http://127.0.0.1:<http-port>/colyseus)
  --report-dir DIR     Where the Markdown report goes (default loadtest-reports/)
  --find-knee          Add 100 Rooms/min until a threshold breaks; never gates
  --max-rooms N        The knee search's ceiling (default 2000)
  --no-build           Use the images already built
  --keep               Leave the compose stack and its volume running
  --help               This text

A shorter run still kills the server mid-hold, e.g.:

  pnpm loadtest -- --rooms 20 --ramp 1m --hold 2m --restart-at 1m
`;

/** Seconds, or a duration with an `s`, `m` or `h` suffix; `null` when invalid. */
export function parseSeconds(raw: string): number | null {
 const match = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(raw.trim());
 if (!match) return null;
 const amount = Number(match[1]);
 const unit = match[2];
 const seconds = unit === "h" ? amount * 3_600 : unit === "m" ? amount * 60 : amount;
 return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

export function parseSecondsOrThrowArg(name: string, raw: string): number {
 const seconds = parseSeconds(raw);
 if (seconds === null) {
  throw new Error(`loadtest: ${name} needs a duration like 30s, 10m or 2h`);
 }
 return seconds;
}

const integer = (name: string, raw: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
 const value = Number(raw);
 if (!Number.isInteger(value) || value < min || value > max) {
  throw new Error(`loadtest: ${name} must be a whole number from ${min} to ${max}, got ${raw}`);
 }
 return value;
};

const port = (name: string, raw: string): number => integer(name, raw, 1, 65_535);

const envValue = (env: Record<string, string | undefined>, key: string): string | undefined => {
 const value = env[key];
 return value === undefined || value.trim() === "" ? undefined : value;
};

export function parseArgs(
 argv: readonly string[],
 env: Readonly<Record<string, string | undefined>> = process.env,
): ParsedArgs {
 const profile: LoadProfile = { ...DEFAULT_PROFILE };
 let knee: KneeProfile | null = null;
 let httpPort = port("--http-port", envValue(env, "LOADTEST_HTTP_PORT") ?? "8080");
 let prometheusPort = port(
  "--prometheus-port",
  envValue(env, "LOADTEST_PROMETHEUS_PORT") ?? "9090",
 );
 let grafanaPort = port("--grafana-port", envValue(env, "LOADTEST_GRAFANA_PORT") ?? "3000");
 let projectName = envValue(env, "LOADTEST_PROJECT") ?? "universum-loadtest";
 let endpoint = envValue(env, "LOADTEST_ENDPOINT") ?? null;
 let reportDir = envValue(env, "LOADTEST_REPORT_DIR") ?? defaultReportDir();
 let workers = availableParallelism();
 let build = true;
 let keep = false;
 let restartGiven = false;
 const warnings: string[] = [];

 const value = (index: number, name: string): string => {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
   throw new Error(`loadtest: ${name} needs a value`);
  }
  return next;
 };

 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  switch (arg) {
   case "--":
    // pnpm 12 forwards the separator itself; it carries no meaning here.
    break;
   case "--help":
    return { kind: "help", text: HELP };
   case "--rooms":
    profile.rooms = integer("--rooms", value(i, arg), 1, 100_000);
    i++;
    break;
   case "--players": {
    const players = integer("--players", value(i, arg), 2, 4);
    if (players !== 2 && players !== 3 && players !== 4) {
     throw new Error("loadtest: --players must be 2, 3 or 4");
    }
    profile.playersPerRoom = players;
    i++;
    break;
   }
   case "--ramp":
    profile.rampSeconds = parseSecondsOrThrowArg(arg, value(i, arg));
    i++;
    break;
   case "--hold":
    profile.holdSeconds = parseSecondsOrThrowArg(arg, value(i, arg));
    i++;
    break;
   case "--restart-at":
    profile.restartAfterHoldSeconds = parseSecondsOrThrowArg(arg, value(i, arg));
    restartGiven = true;
    i++;
    break;
   case "--minute-limit": {
    const limit = integer("--minute-limit", value(i, arg), 15, 50);
    if (limit !== 15 && limit !== 30 && limit !== 50) {
     throw new Error("loadtest: --minute-limit must be 15, 30 or 50");
    }
    profile.minuteLimit = limit;
    i++;
    break;
   }
   case "--watchers":
    profile.lobbyWatchers = integer("--watchers", value(i, arg), 0, 100_000);
    i++;
    break;
   case "--seed":
    profile.seed = integer("--seed", value(i, arg), 0);
    i++;
    break;
   case "--workers":
    workers = integer("--workers", value(i, arg), 1, 256);
    i++;
    break;
   case "--http-port":
    httpPort = port(arg, value(i, arg));
    i++;
    break;
   case "--prometheus-port":
    prometheusPort = port(arg, value(i, arg));
    i++;
    break;
   case "--grafana-port":
    grafanaPort = port(arg, value(i, arg));
    i++;
    break;
   case "--project":
    projectName = value(i, arg);
    i++;
    break;
   case "--endpoint":
    endpoint = value(i, arg);
    i++;
    break;
   case "--report-dir":
    reportDir = value(i, arg);
    i++;
    break;
   case "--find-knee":
    knee = { ...KNEE_PROFILE };
    break;
   case "--max-rooms":
    knee = { ...(knee ?? KNEE_PROFILE), maxRooms: integer(arg, value(i, arg), 1) };
    i++;
    break;
   case "--no-build":
    build = false;
    break;
   case "--keep":
    keep = true;
    break;
   default:
    throw new Error(`loadtest: unknown option ${arg}`);
  }
 }

 if (profile.restartAfterHoldSeconds > profile.holdSeconds) {
  if (restartGiven) {
   throw new Error(
    `loadtest: --restart-at must be within the ${profile.holdSeconds}s hold, got ${profile.restartAfterHoldSeconds}s`,
   );
  }
  profile.restartAfterHoldSeconds = Math.floor(profile.holdSeconds / 2);
  warnings.push(
   `hold is shorter than 20m: restarting at the middle of the hold (${profile.restartAfterHoldSeconds}s)`,
  );
 }

 return {
  kind: "run",
  options: {
   profile,
   knee,
   endpoint: resolveEndpoint(httpPort, endpoint),
   httpPort,
   prometheusPort,
   grafanaPort,
   projectName,
   build,
   keep,
   workers,
   reportDir,
   warnings,
  },
 };
}
