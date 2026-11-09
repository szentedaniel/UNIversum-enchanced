import { afterEach, describe, expect, it, vi } from "vitest";
import { pollUntil, waitUntil } from "#wait.ts";

describe("pollUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps probing until the probe answers true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const answers = [false, false, true];
    const probe = vi.fn<() => Promise<boolean>>(async () => answers.shift() ?? true);

    const result = pollUntil(probe, { timeoutMs: 1_000, intervalMs: 250 });
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toEqual({ ok: true, atMs: 1_500 });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("treats a throwing probe as not ready yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("still booting"))
      .mockResolvedValueOnce(true);

    const result = pollUntil(probe, { timeoutMs: 1_000, intervalMs: 250 });
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ ok: true, atMs: 1_250 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("gives up at the deadline and reports when", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const probe = vi.fn<() => Promise<boolean>>(async () => false);

    const result = pollUntil(probe, { timeoutMs: 500, intervalMs: 250 });
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toEqual({ ok: false, atMs: 1_500 });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("clamps a long interval to the remaining budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const probe = vi.fn<() => Promise<boolean>>(async () => false);

    const result = pollUntil(probe, { timeoutMs: 300, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toEqual({ ok: false, atMs: 1_300 });
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("waitUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves once the wall clock reaches the moment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let finished = false;
    const waiting = waitUntil(1_500).then(() => {
      finished = true;
      return true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(Date.now()).toBe(1_500);
  });

  it("returns at once for a moment already past", async () => {
    await expect(waitUntil(Date.now() - 1)).resolves.toBeUndefined();
  });
});
