/**
 * A Player in the game: a corner card on desktop (figure in the timer ring,
 * name, cash, Field count; the current Player's card is larger) and a compact
 * chip on phone (the active one gets the ring). On phone the chips form a strip
 * above the Board that expands one Player into the full card, so the cards
 * never cover the Board; the wide screen keeps the corner cards.
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { BotMark } from "#components/BotMark.tsx";
import { PlayerToken } from "#components/PlayerToken.tsx";
import { TimerRing } from "#components/TimerRing.tsx";
import { Button } from "#components/ui/button.tsx";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

export type PlayerSummary = {
  seat: number;
  name: string;
  /** The Room plays this Player (a Bot, ticket #196); the card says so. */
  bot: boolean;
  /** Formatted cash, the full amount. */
  cash: string;
  /** The compact form the phone strip uses when four Players squeeze it. */
  cashShort: string;
  fields: number;
  current: boolean;
  you: boolean;
  bankrupt: boolean;
  /** Short state notes, e.g. "In Quarantine: 2 · PCR test"; empty for none. */
  status?: string;
  /** The Turn timer, on the current Player only (see TimerRing). */
  ring?: ReactNode;
};

export function PlayerCard({
  player,
  className,
  onCollapse,
}: {
  player: PlayerSummary;
  className?: string;
  /** The phone strip's expanded card: adds the button that returns to the chips. */
  onCollapse?: () => void;
}) {
  const { seat, name, bot, cash, fields, current, you, bankrupt, status, ring } = player;
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
      <TimerRing seat={seat} size={56} ring={current ? ring : null} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PlayerToken seat={seat} size={18} />
          <span className="truncate font-black">{name}</span>
          {bot && <BotMark />}
        </div>
        <div className="tnum truncate text-xl leading-tight font-black" aria-label={m.game_cash()}>
          {cash}
        </div>
        <div className="text-xs font-bold text-ink/70">
          {m.game_fields({ count: fields })}
          {you && ` · ${m.lobby_you()}`}
        </div>
        {status && <div className="truncate text-xs font-black text-ink/80">{status}</div>}
      </div>
      {onCollapse !== undefined && (
        <Button
          variant="plain"
          size="icon-sm"
          className="min-h-11 min-w-11"
          aria-label={m.game_hide_card()}
          onClick={onCollapse}
        >
          <X size={18} strokeWidth={3} aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

export function PlayerChip({
  player,
  className,
  onExpand,
  compactMoney = false,
}: {
  player: PlayerSummary;
  className?: string;
  /** Opens this Player's full card in the strip's place. */
  onExpand: () => void;
  /** Shows `cashShort` instead of the full amount (see `stripMoney`). */
  compactMoney?: boolean;
}) {
  const { seat, name, bot, cash, cashShort, current, you, bankrupt, status, ring } = player;
  return (
    <li
      data-testid="player-chip"
      data-current={current || undefined}
      aria-current={current || undefined}
      className={cn("flex min-w-0", className)}
    >
      <button
        type="button"
        aria-label={m.game_show_card({ name })}
        onClick={onExpand}
        className={cn(
          "sticker-sm press flex min-w-0 flex-1 flex-col items-center rounded-2xl bg-card px-1 py-1.5 text-card-foreground",
          current && "outline-[3px] outline-offset-1 outline-primary outline-solid",
          bankrupt && "opacity-50 grayscale",
        )}
      >
        <TimerRing seat={seat} size={40} ring={current ? ring : null} />
        <div className="mt-0.5 flex max-w-full items-center gap-0.5">
          <PlayerToken seat={seat} size={14} />
          {bot && <BotMark className="px-1 text-[9px] leading-tight" />}
          <span className={cn("truncate text-[11px] font-extrabold", you && "underline")}>
            {name}
          </span>
        </div>
        <div className="tnum text-sm leading-none font-black" aria-label={m.game_cash()}>
          {compactMoney ? cashShort : cash}
        </div>
        {/* Always there, empty or not: a chip that grew would shrink the Board below
            it and change its zoom (the camera keeps the zoom steady). */}
        <div className="h-[1.25em] max-w-full truncate text-[10px] leading-tight font-black text-ink/80">
          {status}
        </div>
      </button>
    </li>
  );
}
