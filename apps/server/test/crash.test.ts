import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCrashHandlers } from "#observability/crash-handlers.ts";
import { createLogger } from "#observability/logger.ts";
import { captureLogs } from "./helpers.ts";

afterEach(() => {
  vi.useRealTimers();
});

function crashSetup(flush: () => Promise<void>, timeoutMs: number) {
  const source = new EventEmitter();
  const logs = captureLogs();
  const exit = vi.fn<(code: number) => void>();
  installCrashHandlers({
    source,
    log: createLogger({ level: "info", stream: logs.stream }),
    reporter: { report() {}, flush },
    exit,
    timeoutMs,
  });
  return { source, logs, exit };
}

describe("a process crash", () => {
  it("logs at fatal, flushes the reporter, and exits non-zero", async () => {
    const flushed = vi.fn<() => Promise<void>>(async () => {});
    const { source, logs, exit } = crashSetup(flushed, 50);

    source.emit("uncaughtException", new Error("boom"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(flushed).toHaveBeenCalledWith(50);
    expect(logs.lines().filter((line) => line["level"] === 60)).toEqual([
      expect.objectContaining({ msg: "Server crashed", err: expect.anything() }),
    ]);
  });

  it("exits at the 2 s cap when the flush never settles", () => {
    vi.useFakeTimers();
    const never = Promise.withResolvers<void>();
    const { source, exit } = crashSetup(() => never.promise, 2_000);

    source.emit("unhandledRejection", new Error("never handled"));
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits at once on a second crash while the first is flushing", async () => {
    const never = Promise.withResolvers<void>();
    const { source, logs, exit } = crashSetup(() => never.promise, 2_000);

    source.emit("uncaughtException", new Error("first"));
    source.emit("uncaughtException", new Error("second"));

    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.lines().map((line) => line["msg"])).toEqual([
      "Server crashed",
      "Server crashed again while flushing",
    ]);
  });
});
