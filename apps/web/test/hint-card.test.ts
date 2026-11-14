import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HintCard } from "#components/HintCard.tsx";
import { HINTS, type HintId, type HintRow } from "#hints/hints.ts";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };

// The hint card (spec #180): one short sentence on the concept the Guest meets
// and a dismiss button, inline so it never takes focus or covers a Decision.

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => inLanguage("en"));
afterEach(() => inLanguage(baseLocale));

const rowOf = (id: HintId): HintRow => {
  const row = HINTS.find((hint) => hint.id === id);
  if (row === undefined) throw new Error(`the hint table has no ${id} row`);
  return row;
};

const render = (hint: HintRow | null) => renderToStaticMarkup(createElement(HintCard, { hint }));

describe("the hint card", () => {
  it("renders nothing while no hint is open", () => {
    expect(render(null)).toBe("");
  });

  it("shows the open hint's sentence with a labelled dismiss button", () => {
    // React writes an apostrophe in a text node as `&#x27;`; the sentence is compared as text.
    const html = render(rowOf("offer")).replaceAll("&#x27;", "'");

    expect(html).toContain('data-testid="hint-card"');
    expect(html).toContain('data-hint="offer"');
    expect(html).toContain(en.hint_offer);
    expect(html).toContain('data-testid="hint-dismiss"');
    expect(html).toContain(`aria-label="${en.hint_dismiss}"`);
  });

  it("reads the sentence in the active language", () => {
    inLanguage("hu");

    const html = render(rowOf("sale"));

    expect(html).toContain(hu.hint_sale);
    expect(html).toContain(`aria-label="${hu.hint_dismiss}"`);
  });
});
