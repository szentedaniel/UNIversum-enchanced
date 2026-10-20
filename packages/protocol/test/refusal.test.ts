import { describe, expect, it } from "vitest";
import { matchmakeRefusal, matchmakeRejection, refusalMessage, REJECTION_CODES } from "#index.ts";

describe("matchmaking refusals", () => {
  it("lists the abuse-protection codes in the closed Rejection list", () => {
    expect(REJECTION_CODES).toEqual(
      expect.arrayContaining([
        "RATE_LIMITED",
        "SERVER_BUSY",
        "ROOM_NAME_BLOCKED",
        "PASSWORD_LOCKED",
        "SLOW_DOWN",
      ]),
    );
  });

  it("carries a bare code as the error message", () => {
    expect(refusalMessage({ code: "ROOM_FULL" })).toBe("ROOM_FULL");
    expect(matchmakeRefusal({ code: 409, message: "ROOM_FULL" })).toEqual({ code: "ROOM_FULL" });
  });

  it("round-trips a wait in whole seconds", () => {
    const message = refusalMessage({ code: "PASSWORD_LOCKED", retryAfter: 42 });

    expect(matchmakeRefusal({ code: 403, message })).toEqual({
      code: "PASSWORD_LOCKED",
      retryAfter: 42,
    });
    expect(matchmakeRejection({ code: 403, message })).toBe("PASSWORD_LOCKED");
  });

  it.each([
    [
      "Colyseus's unknown Room",
      { code: 522, message: 'room "123456" not found' },
      "ROOM_NOT_FOUND",
    ],
    ["an unknown code", { code: 400, message: "NOPE" }, "INTERNAL"],
    ["broken JSON", { code: 429, message: "{not json" }, "INTERNAL"],
    ["a JSON code outside the list", { code: 429, message: '{"code":"NOPE"}' }, "INTERNAL"],
  ])("maps %s", (_, error, code) => {
    expect(matchmakeRefusal(error)).toEqual({ code });
  });

  it("drops a wait that is not a positive whole number", () => {
    expect(
      matchmakeRefusal({ code: 429, message: '{"code":"RATE_LIMITED","retryAfter":"soon"}' }),
    ).toEqual({ code: "RATE_LIMITED" });
  });
});
