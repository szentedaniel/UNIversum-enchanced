/**
 * The Wealth chart (spec #177, tickets #237 and #238): plain SVG drawn from
 * `pick/wealth-chart.ts`, one line per Player in their `playerLook` colour
 * with a marker at the final sample, and a list of each Player's start and end
 * Wealth as the `role="img"` chart's text alternative. No chart library (#41):
 * the series is small, static and the geometry is already pure code.
 */
import type { PlayerView, WealthSample } from "@universum/rules";
import { PlayerToken } from "#components/PlayerToken.tsx";
import { wealthChart } from "#pick/wealth-chart.ts";
import { INK, playerLook } from "#players.ts";
import { formatCompactMoney, formatCount, formatMoney, m, playerName } from "#text.ts";

/** A portrait phone's width, a third of it tall: the whole chart fits one screen. */
const SIZE = { width: 360, height: 240 } as const;

const TICK_FONT = 9;
const LABEL_FONT = 10;

export function WealthChart({
  series,
  players,
}: {
  /** The final Summary's Wealth series, as the view carries it. */
  series: readonly WealthSample[];
  /** The view's Players: their order, names and colours. */
  players: readonly PlayerView[];
}) {
  const chart = wealthChart(series, players, SIZE);
  const { plot } = chart;
  const axisX = plot.x + plot.width;
  const axisY = plot.y + plot.height;

  return (
    <figure
      data-testid="wealth-chart"
      className="sticker m-0 flex flex-col gap-2 rounded-ui bg-card p-2.5 text-card-foreground"
    >
      <figcaption className="text-sm font-extrabold">{m.summary_chart_title()}</figcaption>
      {chart.players.length === 0 ? (
        <p data-testid="wealth-chart-empty" className="m-0 text-sm font-bold text-ink/70">
          {m.summary_chart_empty()}
        </p>
      ) : (
        <>
          <svg
            data-testid="wealth-chart-svg"
            role="img"
            aria-label={m.summary_chart_label()}
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            className="block h-auto w-full"
          >
            {chart.yTicks.map((tick) => (
              <g key={tick.value} className="tnum">
                <line
                  x1={plot.x}
                  x2={axisX}
                  y1={tick.position}
                  y2={tick.position}
                  stroke={INK}
                  strokeOpacity={0.14}
                />
                <text
                  x={plot.x - 6}
                  y={tick.position}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={TICK_FONT}
                  fill={INK}
                  fillOpacity={0.7}
                >
                  {formatCompactMoney(tick.value)}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <text
                key={tick.value}
                className="tnum"
                x={tick.position}
                y={axisY + 12}
                textAnchor="middle"
                fontSize={TICK_FONT}
                fill={INK}
                fillOpacity={0.7}
              >
                {formatCount(tick.value)}
              </text>
            ))}
            <line x1={plot.x} x2={plot.x} y1={plot.y} y2={axisY} stroke={INK} strokeOpacity={0.4} />
            <line x1={plot.x} x2={axisX} y1={axisY} y2={axisY} stroke={INK} strokeOpacity={0.4} />
            <text
              x={plot.x + plot.width / 2}
              y={chart.height - 3}
              textAnchor="middle"
              fontSize={LABEL_FONT}
              fill={INK}
            >
              {m.summary_chart_minute()}
            </text>
            <text
              transform={`rotate(-90 10 ${plot.y + plot.height / 2})`}
              x={10}
              y={plot.y + plot.height / 2}
              textAnchor="middle"
              fontSize={LABEL_FONT}
              fill={INK}
            >
              {m.summary_chart_wealth()}
            </text>
            {chart.players.map((entry) => {
              const { color } = playerLook(entry.player.seat);
              return (
                <g key={entry.player.id}>
                  {/* An ink underlay keeps the pale colours visible on cream. */}
                  <polyline
                    points={entry.points}
                    fill="none"
                    stroke={INK}
                    strokeOpacity={0.18}
                    strokeWidth={5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <polyline
                    data-testid="chart-line"
                    data-player={entry.player.id}
                    points={entry.points}
                    fill="none"
                    stroke={color}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle
                    data-testid="chart-marker"
                    data-player={entry.player.id}
                    cx={entry.marker.x}
                    cy={entry.marker.y}
                    r={4}
                    fill={color}
                    stroke={INK}
                    strokeWidth={2}
                  />
                </g>
              );
            })}
          </svg>
          <ul
            aria-label={m.summary_chart_alt()}
            className="m-0 flex list-none flex-col gap-1 p-0 text-sm font-bold"
          >
            {chart.players.map((entry) => (
              <li
                key={entry.player.id}
                data-testid="chart-player"
                data-player={entry.player.id}
                className="flex items-center gap-1.5"
              >
                <PlayerToken seat={entry.player.seat} size={14} />
                <span>
                  {m.summary_chart_player_line({
                    name: playerName(entry.player.name),
                    start: formatMoney(entry.start),
                    end: formatMoney(entry.end),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
