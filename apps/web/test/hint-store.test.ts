import { afterEach, describe, expect, it, vi } from "vitest";

// The hint store (spec #180): the seen set and the hints switch, one per
// browser in `localStorage`, read fresh on every page load. The storage stub
// and the module reload follow `sound.test.ts`.

const storage = new Map<string, string>();

/** Loads the module fresh, as a new page would: the stored hints are read on import. */
async function loadStore() {
  vi.resetModules();
  return import("#stores/hint-store.ts");
}

/** The stored seen ids, in the order the store wrote them. */
const storedSeen = (): unknown => JSON.parse(storage.get("universum.hintsSeen") ?? "[]");

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
});

function stubStorage({ failing = false } = {}) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (failing) throw new Error("storage is blocked");
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failing) throw new Error("storage is blocked");
      storage.set(key, value);
    },
  });
}

describe("the hint store", () => {
  it("starts with nothing seen and hints on", async () => {
    stubStorage();
    const { hintStore } = await loadStore();

    expect([...hintStore.getState().seen]).toEqual([]);
    expect(hintStore.getState().enabled).toBe(true);
  });

  it("remembers a dismissed hint across a reload", async () => {
    stubStorage();
    const first = await loadStore();
    first.hintStore.getState().dismiss("offer");

    expect(storedSeen()).toEqual(["offer"]);
    const second = await loadStore();
    expect([...second.hintStore.getState().seen]).toEqual(["offer"]);
  });

  it("keeps a dismissal for this page when storage is unavailable", async () => {
    stubStorage({ failing: true });
    const { hintStore } = await loadStore();

    expect(() => hintStore.getState().dismiss("sale")).not.toThrow();
    expect(hintStore.getState().seen.has("sale")).toBe(true);
    expect(hintStore.getState().enabled).toBe(true);
  });

  it("ignores a stored id the table no longer knows", async () => {
    stubStorage();
    storage.set("universum.hintsSeen", JSON.stringify(["offer", "v0-old", 7, "gameEnd"]));
    const { hintStore } = await loadStore();

    expect([...hintStore.getState().seen].toSorted()).toEqual(["gameEnd", "offer"]);
    hintStore.getState().dismiss("sale");
    expect(storedSeen()).toEqual(["offer", "gameEnd", "sale"]);
  });

  it("reads a corrupt seen value as nothing seen", async () => {
    stubStorage();
    storage.set("universum.hintsSeen", "not json");
    const { hintStore } = await loadStore();

    expect(hintStore.getState().seen.size).toBe(0);
  });

  it("remembers hints switched off across a reload", async () => {
    stubStorage();
    const first = await loadStore();
    first.hintStore.getState().setEnabled(false);

    expect(storage.get("universum.hintsEnabled")).toBe("0");
    const second = await loadStore();
    expect(second.hintStore.getState().enabled).toBe(false);
  });

  it("reads a missing or unknown switch value as on", async () => {
    stubStorage();
    storage.set("universum.hintsEnabled", "garbage");
    const { hintStore } = await loadStore();

    expect(hintStore.getState().enabled).toBe(true);
  });

  it("resets the seen set and turns hints on", async () => {
    stubStorage();
    const first = await loadStore();
    first.hintStore.getState().dismiss("offer");
    first.hintStore.getState().dismiss("erasmus");
    first.hintStore.getState().setEnabled(false);

    first.hintStore.getState().reset();
    expect([...first.hintStore.getState().seen]).toEqual([]);
    expect(first.hintStore.getState().enabled).toBe(true);
    expect(storedSeen()).toEqual([]);
    expect(storage.get("universum.hintsEnabled")).toBe("1");

    const second = await loadStore();
    expect(second.hintStore.getState().seen.size).toBe(0);
    expect(second.hintStore.getState().enabled).toBe(true);
  });
});
