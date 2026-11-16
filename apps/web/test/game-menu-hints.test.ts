import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintList, HintsToggle } from "#components/GameMenu.tsx";
import { HINTS, type HintId } from "#hints/hints.ts";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { hintStore } from "#stores/hint-store.ts";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };

// The Game menu's hints parts (#257): the switch that turns hints off and on,
// and the list that re-reads every hint with a reset. The table and `nextHint`
// tests live in hints.test.ts, unmocked; this file takes the seam below.

// React's server renderer reads a zustand store's *initial* state
// (`getServerSnapshot`), not the state a test has written. The menu's two hint
// parts read the store through `useStore`; this hands them the state the store
// holds, as a mounted client reads it (same seam as chat-mute.test.ts).
vi.mock("zustand", () => ({
  useStore: <T, U>(api: { getState: () => T }, selector?: (state: T) => U): U | T =>
    selector ? selector(api.getState()) : api.getState(),
}));

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => {
  inLanguage("en");
  hintStore.setState({ seen: new Set<HintId>(), enabled: true });
});
afterEach(() => inLanguage(baseLocale));

describe("the menu's hint list", () => {
  it("shows every hint's text in the current language, whether seen or not", () => {
    inLanguage("de");
    // The list is a re-read list: the switch and the seen set do not filter it.
    hintStore.setState({ seen: new Set<HintId>(["offer", "sale"]), enabled: false });

    const list = renderToStaticMarkup(createElement(HintList));
    const rows = [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);

    expect(rows).toEqual(HINTS.map((row) => de[row.messageKey]));
    expect(list).toContain('data-testid="hint-list"');
    expect(list).toContain(de.hints_list_title);
    expect(list).toContain('data-testid="hints-reset"');
    expect(list).toContain(de.hints_reset);
  });

  it("labels the switch with the current setting", () => {
    hintStore.setState({ enabled: true });
    const on = renderToStaticMarkup(createElement(HintsToggle));
    expect(on).toContain('data-testid="hints-toggle"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain(en.hints_on);

    hintStore.setState({ enabled: false });
    const off = renderToStaticMarkup(createElement(HintsToggle));
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain(en.hints_off);
  });
});

type MenuControlProps = {
  "data-testid"?: string;
  onClick?: () => void;
  children?: ReactNode;
};

/** The first element under `tree` carrying `testId`, depth first. */
function controlWith(tree: ReactNode, testId: string): ReactElement<MenuControlProps> | null {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<MenuControlProps>(node)) continue;
    if (node.props["data-testid"] === testId) return node;
    const nested = controlWith(node.props.children, testId);
    if (nested !== null) return nested;
  }
  return null;
}

/** Presses a component's control by test id: vitest has no DOM to click. */
function press(tree: ReactNode, testId: string): void {
  const onClick = controlWith(tree, testId)?.props.onClick;
  if (onClick === undefined) throw new Error(`no clickable control with data-testid="${testId}"`);
  onClick();
}

describe("the menu's hint controls", () => {
  it("turns hints off and back on from the switch", () => {
    press(HintsToggle(), "hints-toggle");
    expect(hintStore.getState().enabled).toBe(false);

    press(HintsToggle(), "hints-toggle");
    expect(hintStore.getState().enabled).toBe(true);
  });

  it("clears the seen hints and turns hints on from the reset", () => {
    hintStore.setState({ seen: new Set<HintId>(["offer", "sale"]), enabled: false });

    press(HintList(), "hints-reset");

    expect(hintStore.getState().seen).toEqual(new Set());
    expect(hintStore.getState().enabled).toBe(true);
  });
});
