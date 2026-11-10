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
  it.each([
    [{ type: "Start" }],
    [{ type: "AddBot" }],
    [{ type: "RemoveBot", playerId: "abc123" }],
    [{ type: "Roll", turn: 1 }],
    [{ type: "Roll", turn: 42 }],
    [{ type: "BuyLevel", turn: 3, level: 1 }],
    [{ type: "BuyLevel", turn: 3, level: 4 }],
    [{ type: "DeclineOffer", turn: 3 }],
    [{ type: "Buyout", turn: 3 }],
    [{ type: "BuyMuseum", turn: 3 }],
    [{ type: "RollForTwelve", turn: 3 }],
    [{ type: "BuyPcrTest", turn: 3 }],
    [{ type: "UsePcrTest", turn: 3 }],
    [{ type: "SellFields", turn: 3, fields: [1] }],
    [{ type: "SellFields", turn: 3, fields: [0, 15, 31] }],
    [{ type: "AutoSell", turn: 3 }],
    [{ type: "PlaceDoubler", turn: 3, field: 2 }],
    [{ type: "TravelErasmus", turn: 3, field: 21 }],
    [
      {
        type: "ProposeDeal",
        turn: 3,
        recipient: "p2",
        give: { fields: [13], cash: 100_000 },
        take: { fields: [21], cash: 0 },
      },
    ],
    [
      {
        type: "ProposeDeal",
        turn: 3,
        recipient: "p2",
        give: { fields: [], cash: 100_000 },
        take: { fields: [], cash: 0 },
      },
    ],
    [{ type: "AcceptDeal", turn: 3 }],
    [{ type: "DeclineDeal", turn: 3 }],
  ])("accepts %j", (message) => {
    expect(intentSchema.safeParse(message)).toEqual({ success: true, data: message });
  });

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
    ["an AddBot naming a Seat", { type: "AddBot", seat: 1 }],
    ["a RemoveBot without a Player", { type: "RemoveBot" }],
    ["a RemoveBot with an empty Player id", { type: "RemoveBot", playerId: "" }],
    ["a RemoveBot with a numeric Player id", { type: "RemoveBot", playerId: 7 }],
    ["a RemoveBot with extra keys", { type: "RemoveBot", playerId: "p1", seat: 1 }],
    ["a BuyLevel without a level", { type: "BuyLevel", turn: 1 }],
    ["Level 0", { type: "BuyLevel", turn: 1, level: 0 }],
    ["Level 5", { type: "BuyLevel", turn: 1, level: 5 }],
    ["a Level that is not an integer", { type: "BuyLevel", turn: 1, level: 1.5 }],
    ["a BuyLevel naming a Field", { type: "BuyLevel", turn: 1, level: 1, field: 3 }],
    ["a Buyout naming a price", { type: "Buyout", turn: 1, price: 1 }],
    ["a BuyMuseum naming a Field", { type: "BuyMuseum", turn: 1, field: 4 }],
    ["a PCR test bought without a turn", { type: "BuyPcrTest" }],
    ["a PCR test with a price", { type: "BuyPcrTest", turn: 1, amount: 0 }],
    ["a Sale without Fields", { type: "SellFields", turn: 1 }],
    ["a Sale of no Field", { type: "SellFields", turn: 1, fields: [] }],
    ["a Sale of a Field off the Board", { type: "SellFields", turn: 1, fields: [32] }],
    ["a Sale of a negative Field", { type: "SellFields", turn: 1, fields: [-1] }],
    ["a Sale of a Field by name", { type: "SellFields", turn: 1, fields: ["paris"] }],
    [
      "a Sale of more Fields than the Board has",
      { type: "SellFields", turn: 1, fields: Array.from({ length: 33 }, () => 1) },
    ],
    ["an Auto-sell naming Fields", { type: "AutoSell", turn: 1, fields: [1] }],
    ["a Doubler placement without a Field", { type: "PlaceDoubler", turn: 1 }],
    ["a Doubler placement off the Board", { type: "PlaceDoubler", turn: 1, field: 32 }],
    ["a Doubler placement by name", { type: "PlaceDoubler", turn: 1, field: "budapest" }],
    ["an Erasmus travel without a Field", { type: "TravelErasmus", turn: 1 }],
    ["an Erasmus travel off the Board", { type: "TravelErasmus", turn: 1, field: -1 }],
    ["a Deal without a recipient", { type: "ProposeDeal", turn: 1, give: {}, take: {} }],
    ["a Deal without its terms", { type: "ProposeDeal", turn: 1, recipient: "p2" }],
    [
      "a Deal whose recipient is empty",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "",
        give: { fields: [], cash: 0 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal with negative cash",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: [], cash: -1 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal with cash that is not an integer",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: [], cash: 1.5 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal of a Field off the Board",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: [32], cash: 0 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal of a Field by name",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: ["vienna"], cash: 0 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal side with an extra key",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: [], cash: 0, level: 1 },
        take: { fields: [], cash: 0 },
      },
    ],
    [
      "a Deal with an extra key",
      {
        type: "ProposeDeal",
        turn: 1,
        recipient: "p2",
        give: { fields: [], cash: 0 },
        take: { fields: [], cash: 0 },
        price: 1,
      },
    ],
    ["an accepted Deal naming a Field", { type: "AcceptDeal", turn: 1, field: 3 }],
    ["a declined Deal naming a Field", { type: "DeclineDeal", turn: 1, field: 3 }],
  ])("refuses %s", (_, message) => {
    expect(intentSchema.safeParse(message).success).toBe(false);
  });
});

describe("Room options", () => {
  it("creates a Room with 4 Players, a 50-minute Minute limit and 2,500,000 starting cash by default", () => {
    expect(createOptionsSchema.parse({})).toEqual({
      maxPlayers: 4,
      minuteLimit: 50,
      startingCash: 2_500_000,
    });
  });

  it("takes 2, 3 or 4 Players and a 15, 30 or 50-minute Minute limit", () => {
    expect(createOptionsSchema.parse({ maxPlayers: 2, minuteLimit: 15 })).toEqual({
      maxPlayers: 2,
      minuteLimit: 15,
      startingCash: 2_500_000,
    });
  });

  it.each([{ startingCash: 1_500_000 }, { startingCash: 2_500_000 }, { startingCash: 4_000_000 }])(
    "takes a starting cash of %j",
    (options) => {
      expect(createOptionsSchema.parse(options).startingCash).toBe(options.startingCash);
    },
  );

  it.each([
    { maxPlayers: 5 },
    { maxPlayers: 1 },
    { minuteLimit: 20 },
    { maxPlayers: "4" },
    { startingCash: 3_000_000 },
    { startingCash: "2500000" },
  ])("refuses create options %j", (options) => {
    expect(createOptionsSchema.safeParse(options).success).toBe(false);
  });

  it("takes a raw Room name and a password (the server checks the name itself)", () => {
    expect(
      createOptionsSchema.parse({ roomName: "  Friday  ", password: "secret", maxPlayers: 2 }),
    ).toEqual({
      roomName: "  Friday  ",
      password: "secret",
      maxPlayers: 2,
      minuteLimit: 50,
      startingCash: 2_500_000,
    });
  });

  it("takes a password of up to 64 bytes", () => {
    expect(createOptionsSchema.safeParse({ password: "x".repeat(64) }).success).toBe(true);
    expect(createOptionsSchema.safeParse({ password: "ő".repeat(32) }).success).toBe(true);
  });

  it.each([
    ["a password over 64 bytes", { password: "x".repeat(65) }],
    ["a password of 33 two-byte letters", { password: "ő".repeat(33) }],
    ["a password that is not a string", { password: 1234 }],
    ["a Room name that is not a string", { roomName: ["a"] }],
    ["a huge Room name", { roomName: "x".repeat(1000) }],
  ])("refuses %s", (_, options) => {
    expect(createOptionsSchema.safeParse(options).success).toBe(false);
  });

  it("joins with the Room code and an optional password", () => {
    expect(joinOptionsSchema.parse({ code: "123456" })).toEqual({ code: "123456" });
    expect(joinOptionsSchema.parse({ code: "123456", password: "pw" })).toEqual({
      code: "123456",
      password: "pw",
    });
  });

  it.each([
    ["no Room code", {}],
    ["a short Room code", { code: "12345" }],
    ["a Room code that is a number", { code: 123456 }],
    ["a password over 64 bytes", { code: "123456", password: "x".repeat(65) }],
  ])("refuses join options with %s", (_, options) => {
    expect(joinOptionsSchema.safeParse(options).success).toBe(false);
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
