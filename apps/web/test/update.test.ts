import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  canReload,
  deployedRelease,
  releaseOf,
  UPDATE_CHECK_INTERVAL_MS,
  updateAvailable,
  watchForUpdate,
  type StopUpdateWatch,
  type VersionFetch,
} from "../src/pwa/update.ts";

// The refresh prompt (spec #184, Decision 3): the build compares its own
// release with the deployment's `/version.json`. Fixed releases, an injected
// fetch and an injected schedule: no network and no real timers.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const version = (release: unknown) => ({ ok: true, json: async () => ({ release }) });

describe("releaseOf", () => {
  it("reads the release from a version file", () => {
    expect(releaseOf({ release: "abc123" })).toBe("abc123");
  });

  it("rejects a body that is not a version file", () => {
    expect(releaseOf(null)).toBeNull();
    expect(releaseOf("abc123")).toBeNull();
    expect(releaseOf({})).toBeNull();
    expect(releaseOf({ release: "" })).toBeNull();
    expect(releaseOf({ release: 42 })).toBeNull();
  });
});

describe("deployedRelease", () => {
  it("reads the deployment's release from /version.json without a cached copy", async () => {
    const fetcher = vi.fn<VersionFetch>(async () => version("new"));

    await expect(deployedRelease(fetcher)).resolves.toBe("new");
    expect(fetcher).toHaveBeenCalledWith("/version.json", { cache: "no-store" });
  });

  it("is silent when the file is missing, malformed or the network is gone", async () => {
    const missing = vi.fn<VersionFetch>(async () => ({ ok: false, json: async () => ({}) }));
    const offline = vi.fn<VersionFetch>(async () => {
      throw new TypeError("offline");
    });
    const malformed = vi.fn<VersionFetch>(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("not JSON");
      },
    }));
    const notAVersion = vi.fn<VersionFetch>(async () => version(undefined));

    await expect(deployedRelease(missing)).resolves.toBeNull();
    await expect(deployedRelease(offline)).resolves.toBeNull();
    await expect(deployedRelease(malformed)).resolves.toBeNull();
    await expect(deployedRelease(notAVersion)).resolves.toBeNull();
  });
});

describe("updateAvailable", () => {
  it("offers a refresh when the deployment serves another release", () => {
    expect(updateAvailable("old", "new")).toBe(true);
  });

  it("stays silent for the same release, a dev build or a failed fetch", () => {
    expect(updateAvailable("same", "same")).toBe(false);
    expect(updateAvailable("dev", "new")).toBe(false);
    expect(updateAvailable("old", "dev")).toBe(false);
    expect(updateAvailable("old", null)).toBe(false);
  });
});

describe("canReload", () => {
  it("never reloads a game in progress", () => {
    expect(canReload("/game/ABCD")).toBe(false);
    expect(canReload("/game/ABCD/")).toBe(false);
  });

  it("offers the reload everywhere else", () => {
    expect(canReload("/")).toBe(true);
    expect(canReload("/rooms")).toBe(true);
    expect(canReload("/room/ABCD")).toBe(true);
    expect(canReload("/game")).toBe(true);
  });
});

/** Drain every microtask a check queues; a macrotask boundary, not a wait. */
const flush = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

/**
 * `watchForUpdate` with a scripted release, a captured timer and a captured
 * visibility listener, so a test fires either one without waiting.
 */
function watch(releases: Array<string | null>, current = "old") {
  const timers: Array<{ run: () => void; ms: number; cancel: Mock<() => void> }> = [];
  const visibles: Array<{ run: () => void; cancel: Mock<() => void> }> = [];
  const onUpdate = vi.fn<(deployed: string) => void>();
  const release = vi.fn<() => Promise<string | null>>(async () => releases.shift() ?? null);
  const stop = watchForUpdate({
    current,
    onUpdate,
    release,
    schedule: (run, ms) => {
      const cancel = vi.fn<() => void>();
      timers.push({ run, ms, cancel });
      return cancel;
    },
    listenVisible: (run) => {
      const cancel = vi.fn<() => void>();
      visibles.push({ run, cancel });
      return cancel;
    },
  });
  return { stop, timers, visibles, onUpdate, release };
}

describe("watchForUpdate", () => {
  it("checks at once and offers the update it finds", async () => {
    const watcher = watch(["new"]);

    await flush();

    expect(watcher.onUpdate).toHaveBeenCalledExactlyOnceWith("new");
    // One prompt is the answer: the check stops and the listener goes with it.
    expect(watcher.timers[0]?.cancel).toHaveBeenCalledOnce();
    expect(watcher.visibles[0]?.cancel).toHaveBeenCalledOnce();
  });

  it("checks again on every interval with the deployment's interval", async () => {
    const watcher = watch(["old", "old", "new"]);

    await flush();
    expect(watcher.onUpdate).not.toHaveBeenCalled();
    expect(watcher.timers[0]?.ms).toBe(UPDATE_CHECK_INTERVAL_MS);

    watcher.timers[0]?.run();
    await flush();
    expect(watcher.onUpdate).not.toHaveBeenCalled();
    expect(watcher.timers).toHaveLength(2);
    expect(watcher.timers[1]?.ms).toBe(UPDATE_CHECK_INTERVAL_MS);

    watcher.timers[1]?.run();
    await flush();

    expect(watcher.onUpdate).toHaveBeenCalledExactlyOnceWith("new");
  });

  it("checks when the tab becomes visible again", async () => {
    const watcher = watch(["old", "new"]);

    await flush();
    watcher.visibles[0]?.run();
    await flush();

    expect(watcher.onUpdate).toHaveBeenCalledExactlyOnceWith("new");
  });

  it("stays silent when the fetch fails or the release matches", async () => {
    const missing = watch([null]);
    const same = watch(["old", "old"]);

    await flush();

    expect(missing.onUpdate).not.toHaveBeenCalled();
    expect(same.onUpdate).not.toHaveBeenCalled();
  });

  it("stays silent in a dev build, which has no release to compare", async () => {
    const watcher = watch(["new"], "dev");

    await flush();

    expect(watcher.onUpdate).not.toHaveBeenCalled();
  });

  it("stops the timer and the visibility listener when the page unmounts", async () => {
    const watcher = watch(["old"]);

    await flush();
    watcher.stop();
    expect(watcher.timers[0]?.cancel).toHaveBeenCalledOnce();
    expect(watcher.visibles[0]?.cancel).toHaveBeenCalledOnce();

    watcher.visibles[0]?.run();
    await flush();
    expect(watcher.release).toHaveBeenCalledOnce();
    expect(watcher.onUpdate).not.toHaveBeenCalled();
  });

  it("never prompts from a fetch that lands after the unmount", async () => {
    const { promise, resolve } = Promise.withResolvers<string | null>();
    const onUpdate = vi.fn<(deployed: string) => void>();
    const stop: StopUpdateWatch = watchForUpdate({
      current: "old",
      onUpdate,
      release: () => promise,
      schedule: () => () => undefined,
      listenVisible: () => () => undefined,
    });

    stop();
    resolve("new");
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("uses the browser's timer and visibility event by default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const addEventListener = vi.fn<(...args: unknown[]) => void>();
    const removeEventListener = vi.fn<(...args: unknown[]) => void>();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener,
      removeEventListener,
    });
    const stop = watchForUpdate({
      current: "old",
      onUpdate: vi.fn<(deployed: string) => void>(),
      release: async () => null,
    });

    await flush();
    expect(addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(1);

    stop();
    expect(removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
