import { describe, expect, it } from "vitest";
import { budapestDay } from "#shared/budapest.ts";
import {
  DEFAULT_DAY_REVIEWS,
  daytimeReviewsToday,
  isNightWindow,
  reviewDecision,
} from "#review/window.ts";

const at = (iso: string): Date => new Date(iso);

describe("isNightWindow", () => {
  it("opens at 01:00 and closes at 07:00 Europe/Budapest", () => {
    expect(isNightWindow(at("2026-01-15T00:00:00Z"))).toBe(true); // 01:00 CET
    expect(isNightWindow(at("2026-01-15T05:59:00Z"))).toBe(true); // 06:59 CET
    expect(isNightWindow(at("2026-01-15T06:00:00Z"))).toBe(false); // 07:00 CET
    expect(isNightWindow(at("2026-01-15T23:59:00Z"))).toBe(false); // 00:59 CET
  });

  it("is DST-safe: the window is Budapest local time, not UTC", () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST (01:00 UTC).
    expect(isNightWindow(at("2026-03-29T00:30:00Z"))).toBe(true); // 01:30 CET
    expect(isNightWindow(at("2026-03-29T01:30:00Z"))).toBe(true); // 03:30 CEST
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET (01:00 UTC).
    expect(isNightWindow(at("2026-10-24T23:30:00Z"))).toBe(true); // 01:30 CEST
    expect(isNightWindow(at("2026-10-25T01:30:00Z"))).toBe(true); // 02:30 CET
    expect(isNightWindow(at("2026-10-25T06:30:00Z"))).toBe(false); // 07:30 CET
  });

  it("puts a UTC evening in the next Budapest day", () => {
    expect(budapestDay(at("2026-01-15T22:59:00Z"))).toBe("2026-01-15");
    expect(budapestDay(at("2026-01-15T23:00:00Z"))).toBe("2026-01-16");
  });
});

describe("reviewDecision", () => {
  it("always reviews inside the night window, however many reviews the day has", () => {
    expect(
      reviewDecision({
        at: at("2026-01-15T01:00:00Z"), // 02:00 CET
        reviewsToday: 99,
        dayQuota: DEFAULT_DAY_REVIEWS,
      }),
    ).toEqual({ review: true, reason: "night-window" });
  });

  it("spends the daytime quota while it lasts", () => {
    expect(
      reviewDecision({
        at: at("2026-01-15T13:00:00Z"), // 14:00 CET
        reviewsToday: 1,
        dayQuota: 2,
      }),
    ).toEqual({ review: true, reason: "daytime-quota" });
  });

  it("queues the review once the daytime quota is spent", () => {
    expect(
      reviewDecision({
        at: at("2026-01-15T13:00:00Z"), // 14:00 CET
        reviewsToday: 2,
        dayQuota: 2,
      }),
    ).toEqual({ review: false, reason: "daytime-quota-spent" });
  });

  it("defaults to two daytime reviews a day", () => {
    expect(DEFAULT_DAY_REVIEWS).toBe(2);
    expect(reviewDecision({ at: at("2026-01-15T13:00:00Z"), reviewsToday: 2 })).toEqual({
      review: false,
      reason: "daytime-quota-spent",
    });
  });
});

describe("daytimeReviewsToday", () => {
  const marker = "<!-- factory-review -->";

  it("counts today's marker comments as spent daytime slots", () => {
    const comments = [
      {
        body: `<!-- factory-review -->\n## Factory review: pass`,
        createdAt: "2026-01-15T12:00:00Z",
      },
    ];

    expect(daytimeReviewsToday(comments, at("2026-01-15T13:00:00Z"))).toBe(1);
  });

  it("does not count reviews that ran in the night window", () => {
    const comments = [{ body: marker, createdAt: "2026-01-15T02:00:00Z" }]; // 03:00 CET

    expect(daytimeReviewsToday(comments, at("2026-01-15T13:00:00Z"))).toBe(0);
  });

  it("does not count yesterday's review, nor another day's early hours", () => {
    const comments = [
      { body: marker, createdAt: "2026-01-14T12:00:00Z" },
      { body: marker, createdAt: "2026-01-14T23:30:00Z" }, // 00:30 on the 15th
    ];

    expect(daytimeReviewsToday(comments, at("2026-01-15T13:00:00Z"))).toBe(1);
  });

  it("counts a review from just after Budapest midnight on today's date", () => {
    const comments = [{ body: marker, createdAt: "2026-11-08T23:30:00Z" }]; // 00:30 on the 9th

    expect(daytimeReviewsToday(comments, at("2026-11-09T10:00:00Z"))).toBe(1);
  });

  it("ignores comments without the reviewer's marker", () => {
    const comments = [
      { body: "## Standards\n- one", createdAt: "2026-01-15T12:00:00Z" },
      { body: "<!-- factory-review -->", createdAt: "2026-01-15T12:30:00Z" },
    ];

    expect(daytimeReviewsToday(comments, at("2026-01-15T13:00:00Z"))).toBe(1);
  });
});
