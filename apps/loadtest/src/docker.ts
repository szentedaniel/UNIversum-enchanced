/**
 * The compose stack the load test runs against: the base file plus
 * `compose.loadtest.yaml` (2 CPUs, 2 GB, raised per-IP limits), with the
 * `monitoring` profile. The generator stays on the host, outside the caps.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { RunOptions } from "#args.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const LOADTEST_COMPOSE = `${REPO_ROOT}/compose.loadtest.yaml`;

export type ComposeOptions = Pick<
  RunOptions,
  "httpPort" | "prometheusPort" | "grafanaPort" | "projectName"
>;

export function composeArgs(options: ComposeOptions, args: string[]): string[] {
  return [
    "compose",
    "-f",
    `${REPO_ROOT}/compose.yaml`,
    "-f",
    LOADTEST_COMPOSE,
    "--project-name",
    options.projectName,
    "--profile",
    "monitoring",
    ...args,
  ];
}

export function composeEnv(options: ComposeOptions, release: string): Record<string, string> {
  return {
    HTTP_PORT: String(options.httpPort),
    PROMETHEUS_PORT: String(options.prometheusPort),
    GRAFANA_PORT: String(options.grafanaPort),
    RELEASE: release,
  };
}

type CommandResult = { code: number; stdout: string; stderr: string };

/** A thin `docker compose` runner with the probes the run needs. */
export class Compose {
  readonly #args: string[];
  readonly #env: Record<string, string | undefined>;
  readonly #log: (line: string) => void;

  constructor(options: ComposeOptions, release: string, log: (line: string) => void) {
    this.#args = composeArgs(options, []);
    this.#env = { ...process.env, ...composeEnv(options, release) };
    this.#log = log;
  }

  /** Removes the stack and its SQLite volume: every run starts from no Rooms. */
  async down(): Promise<void> {
    await this.run(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
  }

  async up(build: boolean): Promise<void> {
    const args = ["up", "-d", "--wait", "--remove-orphans"];
    if (build) args.push("--build");
    const result = await this.run(args, { inherit: true });
    if (result.code !== 0) throw new Error(`docker compose up failed (${result.code})`);
  }

  /** SIGKILL the server; Docker's `restart: unless-stopped` brings it back. */
  async killServer(): Promise<void> {
    const result = await this.run(["kill", "server"], { allowFailure: true });
    if (result.code !== 0) throw new Error(`docker compose kill failed (${result.code})`);
  }

  /**
   * Poll `/readyz` on the server's internal port from inside its container.
   * Returns when it first answers 200, or after `timeoutMs`.
   */
  async waitUntilReady(timeoutMs: number): Promise<{ ready: boolean; atMs: number }> {
    const started = Date.now();
    let restarted = false;
    while (Date.now() - started <= timeoutMs) {
      // oxlint-disable-next-line no-await-in-loop -- readiness is polled, one probe at a time
      const result = await this.execReadyz();
      if (result === 0) return { ready: true, atMs: Date.now() };
      // If Docker's restart policy did not catch the kill, start it ourselves.
      if (!restarted && Date.now() - started > 5_000) {
        restarted = true;
        // oxlint-disable-next-line no-await-in-loop -- the start must finish before the next probe
        await this.run(["start", "server"], { allowFailure: true });
      }
      // oxlint-disable-next-line no-await-in-loop -- the probe interval
      await sleep(250);
    }
    return { ready: false, atMs: Date.now() };
  }

  /** 0 when `/readyz` answered 200; any failure (not running, booting) otherwise. */
  async execReadyz(): Promise<number> {
    const result = await this.run(
      [
        "exec",
        "-T",
        "server",
        "node",
        "-e",
        "fetch('http://127.0.0.1:9464/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
      ],
      { allowFailure: true },
    );
    return result.code;
  }

  /** Runs compose with the configured project and waits for it to finish. */
  async run(
    args: string[],
    options: { inherit?: boolean; allowFailure?: boolean } = {},
  ): Promise<CommandResult> {
    const fullArgs = [...this.#args, ...args];
    if (options.inherit !== false) {
      this.#log(`$ docker ${fullArgs.join(" ")}`);
    }
    const { promise, resolve: finish, reject } = Promise.withResolvers<CommandResult>();
    const child = spawn("docker", fullArgs, {
      cwd: REPO_ROOT,
      env: this.#env,
      stdio: options.inherit === false ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(
          new Error(
            `docker ${fullArgs.join(" ")} failed (${result.code})\n${result.stderr || result.stdout}`,
          ),
        );
        return;
      }
      finish(result);
    });
    return promise;
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve: finish } = Promise.withResolvers<void>();
  setTimeout(finish, ms);
  return promise;
}
