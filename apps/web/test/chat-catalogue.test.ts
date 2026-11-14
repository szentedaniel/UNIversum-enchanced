import {
  CHAT_EMOTES,
  CHAT_IDS,
  CHAT_LINES,
  type ChatEmoteId,
  type ChatLineId,
} from "@universum/protocol/messages";
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import { bubbleOf } from "#chat/catalogue.ts";

// The quick-chat catalogue (#176, #230): one bubble face per protocol id, in
// the viewer's language. A line shows its message; an emote shows a glyph and
// an accessible label, so the same emote reads the same in every language.

const LOCALES: Locale[] = ["hu", "en", "de"];

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

afterEach(() => {
  inLanguage(baseLocale);
});

/** The line's text in the active language (a failed kind check fails the test). */
function lineText(id: ChatLineId): string {
  const face = bubbleOf(id);
  expect(face.kind).toBe("line");
  return face.kind === "line" ? face.text.trim() : "";
}

/** The emote's glyph and label in the active language (a failed kind check fails the test). */
function emoteFace(id: ChatEmoteId): { glyph: string; label: string } {
  const face = bubbleOf(id);
  expect(face.kind).toBe("emote");
  return face.kind === "emote" ? { glyph: face.glyph.trim(), label: face.label.trim() } : { glyph: "", label: "" };
}

describe("the quick-chat catalogue", () => {
  it("covers every protocol id, a line as text and an emote as a glyph and a label", () => {
    inLanguage("en");
    const lineIds = new Set<string>(CHAT_LINES);
    expect([...CHAT_IDS].every((id) => (bubbleOf(id).kind === "line") === lineIds.has(id))).toBe(
      true,
    );
  });

  it("has a non-empty, distinct line for every line id in hu, en and de", () => {
    for (const locale of LOCALES) {
      inLanguage(locale);
      const texts = CHAT_LINES.map(lineText);
      expect(texts.filter((text) => text === "")).toEqual([]);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("gives every emote a language-free glyph and a non-empty label in hu, en and de", () => {
    const glyphs: string[][] = [];
    for (const locale of LOCALES) {
      inLanguage(locale);
      const faces = CHAT_EMOTES.map(emoteFace);
      expect(faces.filter((face) => face.glyph === "" || face.label === "")).toEqual([]);
      glyphs.push(faces.map((face) => face.glyph));
    }
    expect(glyphs[1]).toEqual(glyphs[0]);
    expect(glyphs[2]).toEqual(glyphs[0]);
  });

  it("shows each viewer their own language", () => {
    inLanguage("hu");
    expect(lineText("good_luck")).toBe("Sok szerencsét!");
    inLanguage("en");
    expect(lineText("good_luck")).toBe("Good luck!");
    inLanguage("de");
    expect(lineText("good_luck")).toBe("Viel Glück!");
  });

  it("labels an emote accessibly in every language", () => {
    inLanguage("hu");
    expect(emoteFace("cheer")).toEqual({ glyph: "🎉", label: "Ujjongás" });
    inLanguage("en");
    expect(emoteFace("cheer")).toEqual({ glyph: "🎉", label: "Cheer" });
    inLanguage("de");
    expect(emoteFace("cheer")).toEqual({ glyph: "🎉", label: "Jubel" });
  });
});
