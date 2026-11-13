/**
 * The result screen (R80): a 2-1-3 podium of the top three Players in their
 * own colours (figure and Wealth), the Bankrupt Players greyed below, and the
 * way back to the Lobby list. It overlays the dimmed Board. Once the game has
 * ended the Room offers a rematch: the screen passes the votes the push
 * carries (spec #175) and this client's Player id.
 */
import type { GameEndReason, PhaseOf, PlayerId, PublicView } from "@universum/rules";
import { Link } from "react-router";
import { BotMark } from "#components/BotMark.tsx";
import { PlayerFigure, PlayerToken } from "#components/PlayerToken.tsx";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { sendIntent } from "#connection.ts";
import { cn } from "#lib/utils.ts";
import { podiumOrder, podiumRematch, type PodiumEntry } from "#pick/podium.ts";
import { INK, playerLook } from "#players.ts";
import { formatMoney, m, playerName } from "#text.ts";

/** What the podium says about why the game ended. */
const REASONS: Record<GameEndReason, () => string> = {
  lastPlayer: m.podium_reason_last_player,
  timeUp: m.podium_reason_time_up,
  superMonopoly: m.podium_reason_super_monopoly,
  monopolies: m.podium_reason_monopolies,
};

/** The block's height by display column: second, first, third. */
const HEIGHTS = ["h-24", "h-36", "h-16"];

/** The backdrop's ink and the display text, as in the Tabletop prototype. */
const OVERLAY_BG = "#262335e6";

export function Podium({
  view,
  phase,
  rematch,
  me,
  busy,
}: {
  view: PublicView;
  phase: PhaseOf<"gameOver">;
  /** The Player ids that have agreed to a rematch, from the latest push (ticket #223). */
  rematch?: readonly PlayerId[];
  /** This client's Player id: a client without a Seat gets no rematch button. */
  me: PlayerId | null;
  /** True while this client's intent is unanswered (the in-flight lock). */
  busy: boolean;
}) {
  const ranked = podiumOrder(view.players, view.standings ?? []);
  const winner = ranked[0];
  const [first, second, third] = ranked;
  // The podium stands 2-1-3, as on a real one.
  const columns = [second, first, third].filter((entry) => entry !== undefined);
  const below = ranked.slice(3);
  // Never cached: a vote arrives with a push of its own (empty events).
  const vote = podiumRematch(view.players, me, rematch);
  const mine = vote.mine;

  return (
    <section
      data-testid="podium"
      aria-labelledby="podium-title"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden p-safe-4"
      style={{ background: OVERLAY_BG }}
    >
      {Array.from({ length: 40 }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute top-0 h-3 w-2"
          style={{
            left: `${(i * 53) % 100}%`,
            background: playerLook(i % 4).color,
            animation: `confetti ${3 + (i % 5)}s linear ${-(i % 7)}s infinite`,
          }}
        />
      ))}
      <h2
        id="podium-title"
        data-testid="podium-title"
        className="m-0 max-w-full truncate text-center font-display text-3xl text-[#ffbb6c]"
        style={{ WebkitTextStroke: "2px #14111c", textShadow: "4px 4px 0 #14111c" }}
      >
        {m.podium_wins({ name: winner ? playerName(winner.player.name) : "" })}
      </h2>
      <p className="mt-1 mb-0 text-sm font-bold text-[#fff3e4]/80">{REASONS[phase.reason]()}</p>
      <ol
        data-testid="podium-places"
        className="mt-8 mb-0 flex list-none items-end gap-2 p-0 md:gap-4"
      >
        {columns.map((entry, index) => (
          <PodiumPlace key={entry.player.id} entry={entry} height={HEIGHTS[index] ?? "h-16"} />
        ))}
      </ol>
      {below.length > 0 && (
        <ul
          data-testid="podium-below"
          className="mt-4 mb-0 flex list-none flex-col items-center gap-1 p-0"
        >
          {below.map((entry) => (
            <li
              key={entry.player.id}
              data-bankrupt={entry.player.bankrupt || undefined}
              className={cn(
                "flex items-center gap-2 text-sm font-bold text-[#fff3e4]/80",
                entry.player.bankrupt && "opacity-50 grayscale",
              )}
            >
              <PlayerFigure seat={entry.player.seat} size={24} />
              <span className="max-w-40 truncate">{playerName(entry.player.name)}</span>
              {entry.player.bot && <BotMark />}
              <span className="tnum text-[#ffbb6c]">{formatMoney(entry.player.wealth)}</span>
              {entry.player.bankrupt && <span>{m.game_bankrupt()}</span>}
            </li>
          ))}
        </ul>
      )}
      <ul
        data-testid="rematch-votes"
        aria-label={m.rematch_votes()}
        className="mt-4 mb-0 flex list-none flex-wrap justify-center gap-2 p-0"
      >
        {vote.votes.map(({ player, agreed }) => (
          <li
            key={player.id}
            data-testid="rematch-chip"
            data-player={player.id}
            data-agreed={agreed || undefined}
            className={cn(
              "sticker-sm flex items-center gap-1.5 rounded-2xl bg-card px-2 py-1 text-card-foreground",
              !agreed && "opacity-60",
            )}
          >
            <PlayerToken seat={player.seat} size={14} />
            <span className="max-w-28 truncate text-xs font-extrabold">
              {playerName(player.name)}
            </span>
            <span
              className={cn(
                "text-[10px] leading-none font-black uppercase",
                agreed ? "text-success" : "text-ink/60",
              )}
            >
              {agreed ? m.rematch_agreed() : m.rematch_waiting()}
            </span>
          </li>
        ))}
      </ul>
      {mine !== null && (
        <Button
          data-testid="rematch-button"
          className="mt-4"
          disabled={busy}
          onClick={() => sendIntent(mine.intent)}
        >
          {mine.agreed ? m.rematch_withdraw() : m.rematch_button()}
        </Button>
      )}
      <Link to="/rooms" className={buttonVariants({ className: "mt-6" })}>
        {m.back_to_list()}
      </Link>
    </section>
  );
}

/** One Player on the podium: figure, name, Wealth and the coloured block. */
function PodiumPlace({ entry, height }: { entry: PodiumEntry; height: string }) {
  const { player } = entry;
  return (
    <li
      data-testid="podium-place"
      data-place={entry.place}
      data-player={player.id}
      className="flex w-20 flex-col items-center md:w-32"
    >
      <PlayerFigure seat={player.seat} size={56} className="h-14 md:h-20" />
      <div className="mt-1 flex max-w-full items-center gap-1">
        <PlayerToken seat={player.seat} size={14} />
        <span className="max-w-full truncate text-sm font-black text-[#fff3e4]">
          {playerName(player.name)}
        </span>
      </div>
      {player.bot && <BotMark className="mt-0.5" />}
      <div
        className="tnum text-base font-black text-[#ffbb6c]"
        aria-label={m.podium_wealth({ amount: formatMoney(player.wealth) })}
      >
        {formatMoney(player.wealth)}
      </div>
      {/* The winner's own colour (F28), whichever Seat it is. */}
      <div
        data-testid="podium-block"
        aria-label={m.podium_place({ place: entry.place })}
        className={cn(
          "sticker mt-1 flex w-full items-start justify-center rounded-t-ui pt-2 font-display text-3xl",
          height,
        )}
        style={{ background: playerLook(player.seat).color, color: INK }}
      >
        {entry.place}
      </div>
    </li>
  );
}
