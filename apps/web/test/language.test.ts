import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The language a fresh page starts in, for a browser with this saved choice
 * and these preferred languages (spec: saved choice → browser language if
 * hu/en/de → en). The Paraglide runtime reads them when the page loads.
 */
async function startLanguage(saved: string | null, languages: readonly string[]) {
  const storage = new Map(saved === null ? [] : [["PARAGLIDE_LOCALE", saved]]);
  vi.stubGlobal("window", { location: { href: "http://localhost/game/123456" } });
  vi.stubGlobal("navigator", { languages });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  // The runtime derives `isServer` from Vite's `import.meta.env.SSR` first, and
  // Vitest transforms every module for SSR: without this a page load would look
  // like a server render and no browser strategy (saved choice, language) runs.
  vi.stubEnv("SSR", false);
  // The locale is resolved once, when the module loads, so it must load after
  // the stubs: a static import would be evaluated at the top of the file.
  vi.resetModules();
  const { getLocale } = await import("#paraglide/runtime.js");
  return getLocale();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the starting language", () => {
  it("is the saved choice first", async () => {
    expect(await startLanguage("de", ["hu-HU", "en-US"])).toBe("de");
  });

  it("is the browser language when nothing is saved and it is hu, en or de", async () => {
    expect(await startLanguage(null, ["hu-HU", "en-US"])).toBe("hu");
    expect(await startLanguage(null, ["de-AT"])).toBe("de");
    expect(await startLanguage(null, ["fr-FR", "de-DE", "hu"])).toBe("de");
  });

  it("is English otherwise", async () => {
    expect(await startLanguage(null, ["fr-FR", "pl"])).toBe("en");
    expect(await startLanguage(null, [])).toBe("en");
  });

  it("ignores a saved value that is not one of the languages", async () => {
    expect(await startLanguage("fr", ["hu-HU"])).toBe("hu");
  });

  it("never comes from the address", async () => {
    vi.stubGlobal("location", { href: "http://localhost/de/game/123456" });
    expect(await startLanguage(null, ["hu"])).toBe("hu");
  });
});
