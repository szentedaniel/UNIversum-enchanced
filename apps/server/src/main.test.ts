import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// These tests run the server the way `pnpm dev` and the Docker image do: plain
// `node` on `.ts` source, with no bundler, so the workspace packages must load
// through Node's own type stripping.
const serverDir = new URL("..", import.meta.url);

let child: ChildProcess | undefined;

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  child = undefined;
});

describe("server under plain Node", () => {
  it("loads the shared .ts packages through type stripping", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { MESSAGE } from "@universum/protocol";
         import { FIELD_COUNT } from "@universum/rules";
         console.log(MESSAGE.intent + " " + FIELD_COUNT);`,
      ],
      { cwd: serverDir },
    );

    expect(stdout.trim()).toBe("intent 32");
  });

  it("boots on any free port (PORT=0), keeps its SQLite file in DATA_DIR, and turns ready", async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), "universum-main-")), "data");
    child = spawn(process.execPath, ["src/main.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "",
        PORT: "0",
        INTERNAL_PORT: "0",
        DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });

    const { port, internalPort } = await listeningPorts(child);
    const health = await fetch(`http://127.0.0.1:${port}/__healthcheck`);
    const ready = await fetch(`http://127.0.0.1:${internalPort}/readyz`);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(existsSync(join(dataDir, "rooms.sqlite"))).toBe(true);
  });

  it("in production logs NDJSON boot and shutdown lines, and serves /metrics with its release", async () => {
    child = spawn(process.execPath, ["src/main.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LOG_LEVEL: "",
        RELEASE: "0123abc",
        PORT: "0",
        INTERNAL_PORT: "0",
        DATA_DIR: join(mkdtempSync(join(tmpdir(), "universum-main-")), "data"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    });

    const { internalPort } = await listeningPorts(child);
    const metrics = await (await fetch(`http://127.0.0.1:${internalPort}/metrics`)).text();
    child.kill("SIGTERM");
    const output = await waitForOutput(child, "Server stopped");

    expect(metrics).toContain('build_info{release="0123abc"} 1');
    const lines = output
      .trim()
      .split("\n")
      .map((l) => {
        const line: { level: number; msg: string } = JSON.parse(l);
        return line;
      });
    expect(lines.filter((l) => l.level === 30).map((l) => l.msg)).toEqual([
      "Server listening",
      "Rooms restored",
      "Server ready",
      "Server shutting down",
      "Server stopped",
    ]);
  });
});

/** Everything each spawned server printed so far. */
const outputs = new WeakMap<ChildProcess, string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** One NDJSON log line, or `null` for a partial or human-readable line. */
function logLine(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The ports a spawned production server bound, read from its "Server
 * listening" line once it is ready. Binding port 0 avoids racing other test
 * workers for a free port.
 */
async function listeningPorts(proc: ChildProcess): Promise<{ port: number; internalPort: number }> {
  const output = await waitForOutput(proc, "Server ready");
  const line = output
    .split("\n")
    .map(logLine)
    .find((l) => l?.["msg"] === "Server listening");
  const port = line?.["port"];
  const internalPort = line?.["internalPort"];
  if (typeof port !== "number" || typeof internalPort !== "number") {
    throw new Error(`the server log has no listening ports:\n${output}`);
  }
  return { port, internalPort };
}

/** Waits until the process has printed `text`; returns everything it printed so far. */
async function waitForOutput(proc: ChildProcess, text: string): Promise<string> {
  let output = outputs.get(proc) ?? "";
  return new Promise<string>((resolve, reject) => {
    if (output.includes(text)) resolve(output);
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      outputs.set(proc, output);
      if (output.includes(text)) resolve(output);
    });
    proc.on("exit", (code) =>
      reject(new Error(`server exited (${code}) before "${text}":\n${output}`)),
    );
  });
}
