/**
 * The Wealth chart's geometry (spec #177, ticket #237): the final Summary's
 * series (ADR-0001, ADR-0005) scaled into SVG coordinates, with the axis
 * ticks, one polyline per Player and their final-sample marker. Pure
 * arithmetic: the component draws what this returns, and nothing here derives
 * Wealth — the engine's samples are the numbers.
 */
import type { PlayerId, PlayerView, WealthSample } from "@universum/rules";

/** A point in the chart's SVG coordinates; y grows downwards. */
export type ChartPoint = { x: number; y: number };

/** The area inside the axes, where the lines are drawn. */
export type ChartPlot = { x: number; y: number; width: number; height: number };

/** One axis: its data range and where a value sits in the plot. */
export type ChartScale = {
  min: number;
  max: number;
  /**
   * The value's SVG coordinate on this axis, at two decimals. A flat range
   * maps every value to the plot's middle, so it never divides by zero.
   */
  position: (value: number) => number;
};

/** One axis tick: the data value and its SVG coordinate. */
export type ChartTick = { value: number; position: number };

/** One Player's line and the figures the chart's text alternative lists. */
export type ChartPlayer = {
  player: PlayerView;
  /** The polyline's `points` attribute: `x,y` per sample, space separated. */
  points: string;
  /** The last sample's position, so the end of the game is marked (story 2). */
  marker: ChartPoint;
  /** The first sample's Wealth. */
  start: number;
  /** The last sample's Wealth, which the final standings carry too (R77). */
  end: number;
};

/** Everything the chart component draws, from the final Summary's series. */
export type WealthChart = {
  width: number;
  height: number;
  plot: ChartPlot;
  x: ChartScale;
  y: ChartScale;
  xTicks: ChartTick[];
  yTicks: ChartTick[];
  /** One entry per Player with a sample, in the view's order; empty series, no entries. */
  players: ChartPlayer[];
};

/** Room for the axis labels; the component draws its labels inside it. */
const MARGIN = { top: 12, right: 16, bottom: 28, left: 56 };

/** Roughly this many steps per axis. */
const TICK_COUNT = 5;

/** Coordinates stay at two decimals, so the `points` strings stay stable. */
const round = (value: number): number => Math.round(value * 100) / 100;

/** `values`' range, or 0–0 for none, so a scale always has a domain. */
function extentOf(values: readonly number[]): { min: number; max: number } {
  let min = values[0] ?? 0;
  let max = min;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** A scale from `min`–`max` to `from`–`to`, inverted when `from` is the bottom. */
function scaleOf(min: number, max: number, from: number, to: number): ChartScale {
  const span = max - min;
  return {
    min,
    max,
    position: (value) =>
      round(span === 0 ? (from + to) / 2 : from + ((value - min) / span) * (to - from)),
  };
}

/** A round step near `span / count`: 1, 2 or 5 times a power of ten. */
function stepOf(span: number, count: number): number {
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

/** Whole-number ticks inside the scale, the first at the first step after `min`. */
function ticksOf(scale: ChartScale): ChartTick[] {
  const span = scale.max - scale.min;
  if (span <= 0) return [{ value: scale.min, position: scale.position(scale.min) }];
  const step = Math.max(1, Math.ceil(stepOf(span, TICK_COUNT)));
  const ticks: ChartTick[] = [];
  for (let value = Math.ceil(scale.min / step) * step; value <= scale.max; value += step) {
    ticks.push({ value, position: scale.position(value) });
  }
  return ticks;
}

/**
 * The chart for `series`, in the view's Player order, inside a `width` ×
 * `height` SVG. A Player without a finite sample is left out; a series that
 * starts and ends at the same Minute or Wealth maps to the plot's middle.
 */
export function wealthChart(
  series: readonly WealthSample[],
  players: readonly PlayerView[],
  size: { width: number; height: number },
): WealthChart {
  const plot: ChartPlot = {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(0, size.width - MARGIN.left - MARGIN.right),
    height: Math.max(0, size.height - MARGIN.top - MARGIN.bottom),
  };

  const lines = new Map<PlayerId, { minute: number; wealth: number }[]>();
  const minutes: number[] = [];
  const wealths: number[] = [];
  for (const sample of series.toSorted((a, b) => a.minute - b.minute)) {
    if (!Number.isFinite(sample.minute)) continue;
    minutes.push(sample.minute);
    for (const player of players) {
      const wealth = sample.wealth[player.id];
      if (wealth === undefined || !Number.isFinite(wealth)) continue;
      const line = lines.get(player.id) ?? [];
      line.push({ minute: sample.minute, wealth });
      lines.set(player.id, line);
      wealths.push(wealth);
    }
  }

  const minutesExtent = extentOf(minutes);
  const wealthExtent = extentOf(wealths);
  const x = scaleOf(minutesExtent.min, minutesExtent.max, plot.x, plot.x + plot.width);
  const y = scaleOf(wealthExtent.min, wealthExtent.max, plot.y + plot.height, plot.y);

  const chartPlayers = players.flatMap((player): ChartPlayer[] => {
    const line = lines.get(player.id);
    if (!line) return [];
    const points = line.map((sample) => ({
      x: x.position(sample.minute),
      y: y.position(sample.wealth),
    }));
    return [
      {
        player,
        points: points.map((point) => `${point.x},${point.y}`).join(" "),
        marker: points.at(-1) ?? { x: plot.x, y: plot.y },
        start: line[0]?.wealth ?? 0,
        end: line.at(-1)?.wealth ?? 0,
      },
    ];
  });

  return {
    width: size.width,
    height: size.height,
    plot,
    x,
    y,
    xTicks: chartPlayers.length === 0 ? [] : ticksOf(x),
    yTicks: chartPlayers.length === 0 ? [] : ticksOf(y),
    players: chartPlayers,
  };
}
