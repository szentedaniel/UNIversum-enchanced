import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
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

  it("boots on the configured ports, keeps its SQLite file in DATA_DIR, and turns ready", async () => {
    const [port, internalPort] = [await freePort(), await freePort()];
    const dataDir = join(mkdtempSync(join(tmpdir(), "universum-main-")), "data");
    child = spawn(process.execPath, ["src/main.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        PORT: String(port),
        INTERNAL_PORT: String(internalPort),
        DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });

    await waitForOutput(child, "ready on internal port");
    const health = await fetch(`http://127.0.0.1:${port}/__healthcheck`);
    const ready = await fetch(`http://127.0.0.1:${internalPort}/readyz`);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(existsSync(join(dataDir, "rooms.sqlite"))).toBe(true);
  });
});

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function waitForOutput(proc: ChildProcess, text: string): Promise<void> {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(text)) resolve();
    });
    proc.on("exit", (code) =>
      reject(new Error(`server exited (${code}) before "${text}":\n${output}`)),
    );
  });
}
