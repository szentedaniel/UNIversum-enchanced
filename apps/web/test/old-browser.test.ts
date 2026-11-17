import { readFileSync } from "node:fs";
import { createContext, runInContext, type Context } from "node:vm";
import { describe, expect, it } from "vitest";

// The old-browser notice (spec #22): index.html carries a classic inline script
// before the module bundle, so a browser under the baseline gets the notice
// instead of a page it cannot parse. #337 added the `toSorted` check to it and
// #369 pins that check: this test runs the page's own script in a vm context,
// so deleting the check from index.html turns it red. The script is read, never
// copied, and the vm context has its own Array intrinsic, so deleting
// `toSorted` here never touches the test runner.

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

/** The classic script's body: the one `<script>` tag with no attributes. */
function classicScript(source: string): string {
  const body = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1];
  if (body === undefined) throw new Error("index.html has no classic inline script");
  return body;
}

interface CardStub {
  readonly lang: string;
  hidden: boolean;
  getAttribute(name: string): string | null;
}

interface ElementStub {
  hidden: boolean;
}

interface NoticeStub extends ElementStub {
  getElementsByClassName(name: string): CardStub[];
}

interface DocumentStub {
  readonly documentElement: {
    setAttribute(name: string, value: string): void;
  };
  getElementById(id: string): ElementStub | null;
}

interface Sandbox {
  document: DocumentStub;
  navigator: { language: string };
  CSS: { supports(property: string, value: string): boolean };
  // Absent from a vm context, unlike Array and Object; the script only checks
  // that it is there.
  structuredClone: typeof globalThis.structuredClone;
}

interface Page {
  readonly context: Context;
  readonly notice: NoticeStub;
  readonly root: ElementStub;
  readonly cards: readonly CardStub[];
  /** `data-old-browser`, one entry per name the script sets. */
  readonly attributes: ReadonlyMap<string, string>;
}

/** The page's DOM and globals, with the notice's initial state from index.html. */
function loadPage(options: { language?: string; withoutToSorted?: boolean } = {}): Page {
  const cards: CardStub[] = ["en", "hu", "de"].map((lang) => ({
    lang,
    hidden: true,
    getAttribute: (name) => (name === "lang" ? lang : null),
  }));
  const notice: NoticeStub = {
    hidden: true,
    getElementsByClassName(name) {
      if (name !== "old-browser-card") throw new Error(`unexpected class name: ${name}`);
      return cards;
    },
  };
  const root: ElementStub = { hidden: false };
  const attributes = new Map<string, string>();

  const sandbox: Sandbox = {
    document: {
      documentElement: {
        setAttribute(name, value) {
          attributes.set(name, value);
        },
      },
      getElementById(id) {
        if (id === "old-browser") return notice;
        if (id === "root") return root;
        return null;
      },
    },
    navigator: { language: options.language ?? "en-US" },
    CSS: { supports: () => true },
    structuredClone: globalThis.structuredClone,
  };

  const context = createContext(sandbox);
  if (options.withoutToSorted) runInContext("delete Array.prototype.toSorted", context);
  runInContext(classicScript(html), context);

  return { context, notice, root, cards, attributes };
}

/** The `lang`s of the cards the script left visible. */
function visibleCards(page: Page): string[] {
  return page.cards.filter((card) => !card.hidden).map((card) => card.lang);
}

describe("the old-browser script", () => {
  it("leaves the page alone when the browser passes every check", () => {
    // First, so the harness proves it reaches the supported path.
    const page = loadPage();

    expect(page.notice.hidden).toBe(true);
    expect(page.root.hidden).toBe(false);
    expect(visibleCards(page)).toEqual([]);
    expect(page.attributes.size).toBe(0);
  });

  it("shows the notice when Array.prototype.toSorted is missing", () => {
    const page = loadPage({ withoutToSorted: true });

    expect(page.notice.hidden).toBe(false);
    expect(page.root.hidden).toBe(true);
    expect(page.attributes.get("data-old-browser")).toBe("en");
    expect(visibleCards(page)).toEqual(["en"]);
  });

  it("shows the card matching navigator.language", () => {
    const hu = loadPage({ language: "hu-HU", withoutToSorted: true });
    expect(hu.attributes.get("data-old-browser")).toBe("hu");
    expect(visibleCards(hu)).toEqual(["hu"]);

    const de = loadPage({ language: "de-DE", withoutToSorted: true });
    expect(de.attributes.get("data-old-browser")).toBe("de");
    expect(visibleCards(de)).toEqual(["de"]);
  });

  it("falls back to English for a language index.html does not carry", () => {
    const page = loadPage({ language: "fr-FR", withoutToSorted: true });

    expect(page.attributes.get("data-old-browser")).toBe("en");
    expect(visibleCards(page)).toEqual(["en"]);
  });
});
