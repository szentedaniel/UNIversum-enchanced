import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "./wcag.ts";

// The Tabletop colour tokens (spec: Client → Visual direction) live in one CSS
// file: light on `:root`, dark in a `prefers-color-scheme: dark` block. These
// tests read that file, so the design tokens can't drift from the spec table
// and the text that must stay readable keeps WCAG AA contrast in both themes.

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function block(source: string, opener: RegExp): Record<string, string> {
  const start = source.search(opener);
  if (start < 0) throw new Error(`no block matching ${opener}`);
  const open = source.indexOf("{", source.indexOf(":root", start));
  const body = source.slice(open + 1, source.indexOf("}", open));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]),
  );
}

const themes = {
  light: block(css, /^:root\s*\{/m),
  dark: block(css, /@media \(prefers-color-scheme: dark\)/),
};

/** Spec table, columns light / dark. */
const SPEC: Record<string, [string, string]> = {
  background: ["#ffe8cc", "#262335"],
  foreground: ["#2b2238", "#fff3e4"],
  card: ["#fffaf3", "#f5ece3"],
  "card-foreground": ["#2b2238", "#2b2238"],
  primary: ["#ff7a1a", "#ff9f43"],
  "primary-foreground": ["#2b2238", "#2b2238"],
  secondary: ["#ffd3a1", "#3b2f44"],
  muted: ["#ffdcb5", "#3b2f44"],
  "muted-foreground": ["#7a5a6a", "#c7b3c9"],
  accent: ["#2bb59a", "#7ee0c3"],
  border: ["#2b2238", "#14111c"],
  ring: ["#ff7a1a", "#ffbb6c"],
  success: ["#1f9d6e", "#5fd38d"],
  warning: ["#e0790b", "#ffb547"],
  danger: ["#d6334a", "#ff6b6b"],
};

/** The body of the `@utility <name> { … }` rule. */
const utility = (name: string) => css.slice(css.indexOf(`@utility ${name} {`)).split("}")[0];

describe.each(["light", "dark"] as const)("the %s theme", (name) => {
  const tokens = themes[name];
  const column = name === "light" ? 0 : 1;

  it("uses the spec's colour tokens", () => {
    const expected = Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, v[column]]));
    const actual = Object.fromEntries(Object.keys(SPEC).map((k) => [k, tokens[k]]));
    expect(actual).toEqual(expected);
  });

  it("paints the Board backdrop as the spec's radial gradient", () => {
    const [from, to] = name === "light" ? ["#fff6ea", "#ffd3a1"] : ["#6a4a62", "#262335"];
    expect(tokens["board-backdrop"]).toMatch(new RegExp(`^radial-gradient\\(.*${from}.*${to}`));
  });

  it.each([
    ["body text", "foreground", "background"],
    ["the primary button", "primary-foreground", "primary"],
    ["text on cards", "card-foreground", "card"],
    ["muted text", "muted-foreground", "background"],
  ])("gives %s WCAG AA contrast (4.5:1)", (_, text, surface) => {
    expect(contrast(tokens[text]!, tokens[surface]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the sticker look", () => {
  it("rounds by 18px", () => {
    expect(themes.light["radius"]).toBe("18px");
  });

  it("has a 3px border with a 4px offset shadow, and 2.5px / 2px on small controls", () => {
    expect(utility("sticker")).toMatch(/border: 3px solid var\(--border\)/);
    expect(utility("sticker")).toMatch(/box-shadow: 4px 4px 0 var\(--border\)/);
    expect(utility("sticker-sm")).toMatch(/border: 2\.5px solid var\(--border\)/);
    expect(utility("sticker-sm")).toMatch(/box-shadow: 2px 2px 0 var\(--border\)/);
  });
});
