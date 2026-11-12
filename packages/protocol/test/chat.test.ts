import { describe, expect, it } from "vitest";
import { chatSchema } from "#index.ts";
import { CHAT_EMOTES, CHAT_IDS, CHAT_LINES, MESSAGE } from "#messages.ts";

describe("chat catalogue", () => {
  it("pins eight lines and six emotes, their ids fixed forever", () => {
    expect(CHAT_LINES).toEqual([
      "good_luck",
      "well_played",
      "nice_move",
      "thanks",
      "hurry_up",
      "oops",
      "good_game",
      "rematch",
    ]);
    expect(CHAT_EMOTES).toEqual(["cheer", "groan", "thinking", "laugh", "shock", "heart"]);
  });

  it("lists every line and emote once in CHAT_IDS", () => {
    expect(CHAT_IDS).toEqual([...CHAT_LINES, ...CHAT_EMOTES]);
    expect(new Set(CHAT_IDS).size).toBe(CHAT_IDS.length);
  });

  it("sends and broadcasts chat under the `chat` message name", () => {
    expect(MESSAGE.chat).toBe("chat");
  });
});

describe("chatSchema", () => {
  it.each([...CHAT_IDS])("accepts the catalogue id %s", (id) => {
    const message = { id };
    expect(chatSchema.parse(message)).toEqual(message);
  });

  it.each([
    ["an unknown id", { id: "teleport" }],
    ["a missing id", {}],
    ["a numeric id", { id: 3 }],
    ["an id that is not a string", { id: ["good_luck"] }],
    ["the sender in the payload", { id: "good_luck", seat: 1 }],
    ["free text", { id: "good_luck", text: "nice try" }],
    ["only free text", { text: "nice try" }],
    ["no object", "good_luck"],
    ["null", null],
  ])("refuses %s", (_, message) => {
    expect(chatSchema.safeParse(message).success).toBe(false);
  });
});
