/**
 * A Player in the game: a corner card on desktop (figure in the timer ring,
 * name, cash, Field count; the current Player's card is larger) and a compact
 * chip on phone (the active one gets the ring).
 */
import { PlayerToken } from "#components/PlayerToken.tsx";
import { TimerRing } from "#components/TimerRing.tsx";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

export type PlayerSummary = {
  seat: number;
  name: string;
  /** Formatted cash. */
  cash: string;
  fields: number;
  current: boolean;
  you: boolean;
  bankrupt: boolean;
  /** The Turn clock while it's this Player's Turn (see TimerRing). */
  clock?: { progress: number; secondsLeft: number | null } | null;
};

export function PlayerCard({ player, className }: { player: PlayerSummary; className?: string }) {
  const { seat, name, cash, fields, current, you, bankrupt, clock } = player;
  return (
    <li
      data-testid="player-card"
      data-current={current || undefined}
      aria-current={current || undefined}
      className={cn(
        "sticker flex w-64 items-center gap-3 rounded-ui bg-card p-3 text-card-foreground transition-transform",
        current && "scale-110 border-4! border-primary!",
        bankrupt && "opacity-50 grayscale",
        className,
      )}
    >
      <TimerRing
        seat={seat}
        size={56}
        progress={current ? (clock?.progress ?? 1) : null}
        secondsLeft={current ? (clock?.secondsLeft ?? null) : null}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PlayerToken seat={seat} size={18} />
          <span className="truncate font-black">{name}</span>
        </div>
        <div className="tnum truncate text-xl leading-tight font-black" aria-label={m.game_cash()}>
          {cash}
        </div>
        <div className="text-xs font-bold text-ink/70">
          {m.game_fields({ count: fields })}
          {you && ` · ${m.lobby_you()}`}
        </div>
      </div>
    </li>
  );
}

export function PlayerChip({ player, className }: { player: PlayerSummary; className?: string }) {
  const { seat, name, cash, current, you, bankrupt, clock } = player;
  return (
    <li
      data-testid="player-chip"
      data-current={current || undefined}
      aria-current={current || undefined}
      className={cn(
        "sticker-sm flex min-w-0 flex-col items-center rounded-2xl bg-card px-1 py-1.5 text-card-foreground",
        current && "outline-[3px] outline-offset-1 outline-primary outline-solid",
        bankrupt && "opacity-50 grayscale",
        className,
      )}
    >
      <TimerRing
        seat={seat}
        size={40}
        progress={current ? (clock?.progress ?? 1) : null}
        secondsLeft={current ? (clock?.secondsLeft ?? null) : null}
      />
      <div className="mt-0.5 flex max-w-full items-center gap-0.5">
        <PlayerToken seat={seat} size={14} />
        <span className={cn("truncate text-[11px] font-extrabold", you && "underline")}>
          {name}
        </span>
      </div>
      <div className="tnum text-sm leading-none font-black" aria-label={m.game_cash()}>
        {cash}
      </div>
    </li>
  );
}
