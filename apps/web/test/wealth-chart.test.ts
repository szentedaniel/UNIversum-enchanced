import type { PlayerView, WealthSample } from "@universum/rules";
import { describe, expect, it } from "vitest";
import { wealthChart, type WealthChart } from "#pick/wealth-chart.ts";

// The chart's geometry (spec #177, ticket #237) turns the engine's Wealth
// series into SVG coordinates. The series is the engine's (ADR-0001,
// ADR-0005); this module only scales and draws it.

const SIZE = { width: 600, height: 300 };
// Plot margins: top 12, right 16, bottom 28, left 56.
const LEFT = 56;
const RIGHT = 584;
const TOP = 12;
const BOTTOM = 272;

function player(id: string, seat: number): PlayerView {
  return {
    id,
    name: { adjective: "happy", noun: "tiger" },
    seat,
    cash: 0,
    wealth: 0,
    position: 0,
    bankrupt: false,
    quarantineRounds: null,
    hasPcrTest: false,
    bot: false,
  };
}

const players = [player("p1", 0), player("p2", 1)];

const sample = (minute: number, p1: number, p2: number): WealthSample => ({
  minute,
  wealth: { p1, p2 },
});

/** Every number a value produces, to prove none is NaN or Infinity. */
function positions(chart: WealthChart): number[] {
  return [
    chart.plot.x,
    chart.plot.y,
    chart.plot.width,
    chart.plot.height,
    ...chart.xTicks.flatMap((tick) => [tick.value, tick.position]),
    ...chart.yTicks.flatMap((tick) => [tick.value, tick.position]),
    ...chart.players.flatMap((entry) => [entry.marker.x, entry.marker.y, entry.start, entry.end]),
  ];
}

describe("the Wealth chart's geometry", () => {
  it("maps Minute to x and Wealth to y, inverted for SVG", () => {
    const chart = wealthChart(
      [sample(0, 1_000_000, 2_000_000), sample(5, 3_000_000, 1_000_000), sample(10, 0, 4_000_000)],
      players,
      SIZE,
    );

    expect(chart.plot).toEqual({ x: LEFT, y: TOP, width: 528, height: 260 });
    expect(chart.x).toMatchObject({ min: 0, max: 10 });
    expect(chart.y).toMatchObject({ min: 0, max: 4_000_000 });
    expect(chart.players.map((entry) => entry.points)).toEqual([
      "56,207 320,77 584,272",
      "56,142 320,207 584,12",
    ]);
  });

  it("returns each Player's final sample as the marker and the start and end for the text alternative", () => {
    const chart = wealthChart(
      [sample(0, 1_000_000, 2_000_000), sample(5, 3_000_000, 1_000_000), sample(10, 0, 4_000_000)],
      players,
      SIZE,
    );

    expect(chart.players.map((entry) => entry.marker)).toEqual([
      { x: RIGHT, y: BOTTOM },
      { x: RIGHT, y: TOP },
    ]);
    expect(chart.players.map(({ player: who, start, end }) => [who.id, start, end])).toEqual([
      ["p1", 1_000_000, 0],
      ["p2", 2_000_000, 4_000_000],
    ]);
  });

  it("ticks the Minutes across and the Wealth up", () => {
    const chart = wealthChart(
      [sample(0, 1_000_000, 2_000_000), sample(5, 3_000_000, 1_000_000), sample(10, 0, 4_000_000)],
      players,
      SIZE,
    );

    expect(chart.xTicks).toEqual([
      { value: 0, position: 56 },
      { value: 2, position: 161.6 },
      { value: 4, position: 267.2 },
      { value: 6, position: 372.8 },
      { value: 8, position: 478.4 },
      { value: 10, position: 584 },
    ]);
    expect(chart.yTicks).toEqual([
      { value: 0, position: 272 },
      { value: 1_000_000, position: 207 },
      { value: 2_000_000, position: 142 },
      { value: 3_000_000, position: 77 },
      { value: 4_000_000, position: 12 },
    ]);
  });

  it("an empty series draws no line, no marker and no tick", () => {
    const chart = wealthChart([], players, SIZE);

    expect(chart.players).toEqual([]);
    expect(chart.xTicks).toEqual([]);
    expect(chart.yTicks).toEqual([]);
    expect(chart.x.position(0)).toBe(320);
    expect(chart.y.position(0)).toBe(142);
  });

  it("a one-sample series is one point in the middle of both axes, not a divide by zero", () => {
    const chart = wealthChart([sample(4, 2_000_000, 2_000_000)], players, SIZE);

    expect(chart.players.map((entry) => entry.points)).toEqual(["320,142", "320,142"]);
    expect(chart.players.map((entry) => entry.marker)).toEqual([
      { x: 320, y: 142 },
      { x: 320, y: 142 },
    ]);
    expect(chart.players.map((entry) => [entry.start, entry.end])).toEqual([
      [2_000_000, 2_000_000],
      [2_000_000, 2_000_000],
    ]);
    expect(chart.xTicks).toEqual([{ value: 4, position: 320 }]);
    expect(chart.yTicks).toEqual([{ value: 2_000_000, position: 142 }]);
    expect(positions(chart).every(Number.isFinite)).toBe(true);
  });

  it("equal Wealth everywhere is a flat line through the middle", () => {
    const chart = wealthChart(
      [
        sample(0, 1_000_000, 1_000_000),
        sample(5, 1_000_000, 1_000_000),
        sample(10, 1_000_000, 1_000_000),
      ],
      players,
      SIZE,
    );

    expect(chart.players.map((entry) => entry.points)).toEqual([
      "56,142 320,142 584,142",
      "56,142 320,142 584,142",
    ]);
    expect(chart.yTicks).toEqual([{ value: 1_000_000, position: 142 }]);
  });

  it("a Bankrupt Player's line falls to the bottom at zero", () => {
    const chart = wealthChart(
      [sample(0, 3_000_000, 3_000_000), sample(10, 0, 3_000_000)],
      players,
      SIZE,
    );
    const [first, second] = chart.players;

    expect(first?.points).toBe("56,12 584,272");
    expect(first?.marker).toEqual({ x: RIGHT, y: BOTTOM });
    expect(first?.end).toBe(0);
    expect(second?.points).toBe("56,12 584,12");
    expect(chart.y.position(0)).toBe(BOTTOM);
    expect(positions(chart).every(Number.isFinite)).toBe(true);
  });

  it("ignores a Player the view does not carry, and one with no sample", () => {
    const chart = wealthChart(
      [
        { minute: 0, wealth: { p1: 1_000_000, gone: 50_000_000 } },
        { minute: 10, wealth: { p1: 2_000_000, gone: 99_000_000 } },
      ],
      players,
      SIZE,
    );

    expect(chart.players.map((entry) => entry.player.id)).toEqual(["p1"]);
    expect(chart.y.max).toBe(2_000_000);
  });
});
