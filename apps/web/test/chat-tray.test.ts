import { CHAT_EMOTES, CHAT_IDS, CHAT_LINES, type ChatId } from "@universum/protocol/messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatOpenTo, CLOSED_TRAY, closeTray, cooldownOver, openTray, tapChat } from "#chat/tray.ts";
import { ChatChoices, ChatTray } from "#components/ChatTray.tsx";
import { baseLocale, overwriteGetLocale, type Locale } from "#paraglide/runtime.js";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import hu from "../messages/hu.json" with { type: "json" };
import { viewOf } from "./playback-fixtures.ts";

// The quick-chat tray (#176, #231): a seated Guest picks one catalogue line or
// emote and the Room shows it by their card. The tray offers no text input, its
// buttons refuse a second send for CHAT_COOLDOWN_MS, and a tap sends the id and
// closes the tray. The tap itself is pinned through `tapChat` with an injected
// sender: the house has no DOM test environment (#224), so the real press is
// the two-Guest e2e spec (#233).

const inLanguage = (locale: Locale) => overwriteGetLocale(() => locale);

beforeEach(() => inLanguage("en"));
afterEach(() => inLanguage(baseLocale));

const CLOSED = CLOSED_TRAY;

/** The tray body as the Game screen's tray draws it. */
const renderChoices = (cooling = false) =>
  renderToStaticMarkup(createElement(ChatChoices, { cooling, onPick: () => {} }));

/** Every send button's id, in the order the tray lists them. */
const sentIds = (html: string) =>
  [...html.matchAll(/data-testid="chat-send-([a-z_]+)"/g)].map((match) => match[1]);

/** Each send button's opening tag, by id. */
const buttonTags = (html: string) =>
  new Map(
    [...html.matchAll(/<button[^>]*data-testid="chat-send-([a-z_]+)"[^>]*>/g)].map((match) => [
      match[1],
      match[0],
    ]),
  );

describe("the tray's catalogue", () => {
  it("lists exactly the protocol's ids, every line and every emote, once", () => {
    expect(sentIds(renderChoices())).toEqual([...CHAT_IDS]);
    expect([...CHAT_LINES, ...CHAT_EMOTES]).toEqual([...CHAT_IDS]);
  });

  it("offers no text input", () => {
    const html = renderChoices();

    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("contenteditable");
  });

  it("shows each line's text from the catalogue", () => {
    const html = renderChoices();

    for (const id of CHAT_LINES) {
      expect(html).toContain(en[`chat_line_${id}`]);
    }
  });

  it("shows each emote's glyph with its accessible label", () => {
    const html = renderChoices();

    expect(html).toContain(`aria-label="${en.chat_emote_cheer}"`);
    expect(html).toContain("🎉");
    for (const id of CHAT_EMOTES) {
      expect(html).toContain(en[`chat_emote_${id}`]);
    }
  });

  it("heads the lines and the emotes in the viewer's language", () => {
    for (const [locale, messages] of [
      ["hu", hu],
      ["en", en],
      ["de", de],
    ] as const) {
      inLanguage(locale);
      const html = renderChoices();

      expect(html).toContain(messages.chat_lines);
      expect(html).toContain(messages.chat_emotes);
    }
  });

  it("refuses every send button while the cooldown runs", () => {
    const tags = buttonTags(renderChoices(true));

    expect(tags.size).toBe(CHAT_IDS.length);
    expect([...tags.values()].filter((tag) => !tag.includes("disabled"))).toEqual([]);
  });
});

describe("a tap in the tray", () => {
  it("sends each catalogue id and closes the tray", () => {
    for (const id of CHAT_IDS) {
      const send = vi.fn<(id: ChatId) => void>();

      const next = tapChat({ open: true, cooling: false }, id, send);

      expect(send).toHaveBeenCalledExactlyOnceWith(id);
      expect(next).toEqual({ open: false, cooling: true });
    }
  });

  it("sends nothing while the cooldown runs and leaves the tray as it was", () => {
    const send = vi.fn<(id: ChatId) => void>();

    expect(tapChat({ open: true, cooling: true }, "good_luck", send)).toEqual({
      open: true,
      cooling: true,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the tray's open state", () => {
  it("opens and closes on the toggle", () => {
    const open = openTray(CLOSED);

    expect(open).toEqual({ open: true, cooling: false });
    expect(closeTray(open)).toEqual(CLOSED);
  });

  it("closes on Escape or an outside tap, keeping a running cooldown", () => {
    expect(closeTray({ open: true, cooling: true })).toEqual({ open: false, cooling: true });
  });

  it("lets the buttons send again once the cooldown is over", () => {
    expect(cooldownOver({ open: true, cooling: true })).toEqual({ open: true, cooling: false });
  });
});

describe("who the tray is offered to", () => {
  it("offers it to a seated Guest in a running game, in any phase", () => {
    expect(chatOpenTo(viewOf(), "p1", false)).toBe(true);
    expect(
      chatOpenTo(
        viewOf(undefined, { phase: { kind: "placingDoubler", fields: [1] } }),
        "p2",
        false,
      ),
    ).toBe(true);
  });

  it("refuses it to a Guest with no Seat and to a Seat the view does not carry", () => {
    expect(chatOpenTo(viewOf(), null, false)).toBe(false);
    expect(chatOpenTo(viewOf(), "gone", false)).toBe(false);
  });

  it("refuses it on the result screen", () => {
    const gameOver = viewOf(undefined, {
      phase: { kind: "gameOver", winner: "p1", reason: "timeUp" },
      standings: [{ player: "p1", wealth: 100_000 }],
    });

    expect(chatOpenTo(gameOver, "p1", false)).toBe(false);
  });
});

describe("the tray's toggle", () => {
  it("draws the quick-chat button with the tray closed", () => {
    inLanguage("en");

    const html = renderToStaticMarkup(createElement(ChatTray, { send: () => {} }));

    expect(html).toContain('data-testid="chat-toggle"');
    expect(html).toContain(`aria-label="${en.chat_open}"`);
    expect(html).not.toContain("chat-send-good_luck");
  });
});
