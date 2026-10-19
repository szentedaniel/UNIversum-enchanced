import { RULES_REJECTION_CODES } from "@universum/rules";
import { describe, expect, it } from "vitest";
import {
  createOptionsSchema,
  intentSchema,
  joinOptionsSchema,
  PLAYER_NAME_ADJECTIVES,
  PLAYER_NAME_NOUNS,
  REJECTION_CODES,
} from "#index.ts";

describe("intentSchema", () => {
  it.each([[{ type: "Start" }], [{ type: "Roll", turn: 1 }], [{ type: "Roll", turn: 42 }]])(
    "accepts %j",
    (message) => {
      expect(intentSchema.safeParse(message)).toEqual({ success: true, data: message });
    },
  );

  it.each([
    ["no object", "Roll"],
    ["null", null],
    ["an unknown type", { type: "Teleport", turn: 1 }],
    ["a Roll without a turn", { type: "Roll" }],
    ["a turn that is not an integer", { type: "Roll", turn: 1.5 }],
    ["a turn that is a string", { type: "Roll", turn: "1" }],
    ["a negative turn", { type: "Roll", turn: -1 }],
    ["extra keys", { type: "Roll", turn: 1, dice: [6, 6] }],
    ["a system intent", { type: "TurnTimedOut", turn: 1 }],
  ])("refuses %s", (_, message) => {
    expect(intentSchema.safeParse(message).success).toBe(false);
  });
});

describe("Room options", () => {
  it("creates a Room with 4 Players and a 50-minute Minute limit by default", () => {
    expect(createOptionsSchema.parse({})).toEqual({ maxPlayers: 4, minuteLimit: 50 });
  });

  it("takes 2, 3 or 4 Players and a 15, 30 or 50-minute Minute limit", () => {
    expect(createOptionsSchema.parse({ maxPlayers: 2, minuteLimit: 15 })).toEqual({
      maxPlayers: 2,
      minuteLimit: 15,
    });
  });

  it.each([{ maxPlayers: 5 }, { maxPlayers: 1 }, { minuteLimit: 20 }, { maxPlayers: "4" }])(
    "refuses create options %j",
    (options) => {
      expect(createOptionsSchema.safeParse(options).success).toBe(false);
    },
  );

  it("joins with no options", () => {
    expect(joinOptionsSchema.parse({})).toEqual({});
  });
});

describe("Rejection codes", () => {
  it("include every code the rules engine can return", () => {
    expect(REJECTION_CODES).toEqual(expect.arrayContaining([...RULES_REJECTION_CODES]));
  });

  it("include the server's own codes", () => {
    expect(REJECTION_CODES).toEqual(
      expect.arrayContaining(["MALFORMED", "INTERNAL", "ROOM_NOT_FOUND"]),
    );
  });
});

describe("Player name words", () => {
  it("are unique ids, enough for a few hundred distinct names", () => {
    expect(new Set(PLAYER_NAME_ADJECTIVES).size).toBe(PLAYER_NAME_ADJECTIVES.length);
    expect(new Set(PLAYER_NAME_NOUNS).size).toBe(PLAYER_NAME_NOUNS.length);
    expect(PLAYER_NAME_ADJECTIVES.length * PLAYER_NAME_NOUNS.length).toBeGreaterThan(400);
  });
});
