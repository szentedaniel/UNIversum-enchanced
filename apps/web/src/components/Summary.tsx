/**
 * The result screen's Summary (spec #177, ticket #238): the four figures the
 * engine counted — the biggest Rent, the Fields bought per Player, the
 * Monopolies formed and the Bankruptcies — and the Wealth chart, joined to the
 * view's Players by `pick/summary.ts` so names and colours follow the Podium.
 * The Podium opens it and its back button returns there; `view.summary` is
 * null until the game is over, and then this renders nothing at all.
 */
import type { PlayerView, PublicView } from "@universum/rules";
import { FIELDS, type GroupId } from "@universum/rules/board";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { GROUP_COLORS } from "#board/colors.ts";
import { PlayerToken } from "#components/PlayerToken.tsx";
import { Button } from "#components/ui/button.tsx";
import { WealthChart } from "#components/WealthChart.tsx";
import { summaryView } from "#pick/summary.ts";
import { fieldName, formatCount, formatMoney, m, playerName } from "#text.ts";

/** The Group's University names in ring order, so a Monopoly names its colour's cities. */
const groupUniversities = (group: GroupId): string =>
  FIELDS.filter((field) => field.group === group)
    .map((field) => fieldName(field.key))
    .join(", ");

const groupColor = (group: GroupId): string =>
  `#${GROUP_COLORS[group].toString(16).padStart(6, "0")}`;

/** One figure's card: its label and its value. */
function Figure({
  figure,
  label,
  children,
}: {
  figure: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      data-figure={figure}
      className="sticker rounded-ui bg-card px-2.5 py-2 text-card-foreground"
    >
      <dt className="text-[11px] font-extrabold tracking-wide uppercase opacity-60">{label}</dt>
      <dd className="m-0 text-sm font-bold">{children}</dd>
    </div>
  );
}

function Names({ players }: { players: readonly PlayerView[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {players.map((player) => (
        <li key={player.id} className="flex items-center gap-1.5">
          <PlayerToken seat={player.seat} size={14} />
          <span>{playerName(player.name)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Summary({ view, onBack }: { view: PublicView; onBack: () => void }) {
  const summary = view.summary;
  if (summary === null) return null;
  const figures = summaryView(view.players, summary);
  const rent = figures.biggestRent;

  return (
    <section
      data-testid="summary"
      aria-labelledby="summary-title"
      className="flex w-full max-w-md flex-col gap-2.5"
    >
      <header className="flex w-full items-center justify-between gap-2">
        <h2
          id="summary-title"
          data-testid="summary-title"
          className="m-0 min-w-0 truncate font-display text-2xl text-[#ffbb6c]"
          style={{ WebkitTextStroke: "1px #14111c" }}
        >
          {m.summary_title()}
        </h2>
        <Button variant="plain" size="sm" data-testid="summary-back" onClick={onBack}>
          <ChevronLeft size={16} strokeWidth={3} aria-hidden />
          {m.summary_back()}
        </Button>
      </header>
      <dl className="m-0 flex w-full flex-col gap-2">
        <Figure figure="rent" label={m.summary_biggest_rent()}>
          {rent === null ? (
            m.summary_biggest_rent_none()
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <PlayerToken seat={rent.payer.seat} size={14} />
              <span>
                {m.summary_biggest_rent_line({
                  payer: playerName(rent.payer.name),
                  amount: formatMoney(rent.amount),
                  owner: playerName(rent.owner.name),
                  field: fieldName(FIELDS[rent.field]?.key ?? ""),
                })}
              </span>
            </span>
          )}
        </Figure>
        <Figure figure="buyer" label={m.summary_top_buyer()}>
          {figures.topBuyer === null ? (
            m.summary_top_buyer_none()
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <PlayerToken seat={figures.topBuyer.player.seat} size={14} />
              <span>
                {m.summary_top_buyer_line({
                  name: playerName(figures.topBuyer.player.name),
                  count: formatCount(figures.topBuyer.count),
                })}
              </span>
            </span>
          )}
        </Figure>
        <Figure figure="monopolies" label={m.summary_monopolies()}>
          {figures.monopolies.length === 0 ? (
            m.summary_monopolies_none()
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {figures.monopolies.map((monopoly, index) => (
                <li
                  key={`${monopoly.player.id}:${monopoly.group}:${index}`}
                  className="flex items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full border-2 border-ink"
                    style={{ background: groupColor(monopoly.group) }}
                  />
                  <span>
                    {m.summary_monopoly_line({
                      name: playerName(monopoly.player.name),
                      group: groupUniversities(monopoly.group),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Figure>
        <Figure figure="bankruptcies" label={m.summary_bankruptcies()}>
          {figures.bankruptcies.length === 0 ? (
            m.summary_bankruptcies_none()
          ) : (
            <Names players={figures.bankruptcies} />
          )}
        </Figure>
      </dl>
      <WealthChart series={summary.series} players={view.players} />
    </section>
  );
}
