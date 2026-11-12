import { describe, expect, it } from "vitest";
import { inviteLink } from "#invite.ts";

// Spec: every Room is reachable at `/room/:code` (App routing, `Lobby`'s
// `ensureJoined`), so the invite is that address and nothing else: no password,
// no Guest token, and a URL-safe Room code.

describe("a Room's invite link", () => {
  it("puts the Room code in the Room's own address", () => {
    expect(inviteLink("https://universum.test", "123456")).toBe(
      "https://universum.test/room/123456",
    );
  });

  it("does not double the slash when the origin ends with one", () => {
    expect(inviteLink("https://universum.test/", "123456")).toBe(
      "https://universum.test/room/123456",
    );
    expect(inviteLink("https://universum.test///", "123456")).toBe(
      "https://universum.test/room/123456",
    );
  });

  it("encodes the Room code as one URL path segment", () => {
    const link = inviteLink("https://universum.test", "12 34/56?x#y");
    expect(link).toBe("https://universum.test/room/12%2034%2F56%3Fx%23y");

    const url = new URL(link);
    expect(url.pathname).toBe("/room/12%2034%2F56%3Fx%23y");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });
});
