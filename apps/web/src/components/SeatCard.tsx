/**
 * A Lobby Seat card. Every card has the 4-Seat size whatever the Player count
 * (fewer Seats just centre). A taken Seat is a sticker in the Player colour
 * with the shape, the alien figure on a cream disc and the Player name; the
 * creator's has a crown and mine says "you". An open Seat is dashed.
 */
import { Crown, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { PlayerFigure, PlayerToken } from "#components/PlayerToken.tsx";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";
import { INK, playerLook } from "#players.ts";

const SIZE = "aspect-[4/5] w-[calc(50%-0.5rem)] md:w-[calc(25%-0.75rem)]";

export type SeatCardProps =
  | { open: true }
  | {
      open?: false;
      seat: number;
      name: string;
      you?: boolean;
      creator?: boolean;
      /** Shown while the Seat is held for a dropped Player (e.g. "Reconnecting… 0:42"). */
      held?: ReactNode;
    };

export function SeatCard(props: SeatCardProps) {
  if (props.open) {
    return (
      <li
        data-testid="seat"
        data-open
        className={cn(
          SIZE,
          "flex flex-col items-center justify-center gap-2 rounded-ui border-[3px] border-dashed border-current p-3 text-center opacity-70",
        )}
      >
        <span
          aria-hidden
          className="flex size-16 items-center justify-center rounded-full border-[3px] border-dashed border-current text-3xl font-black md:size-20"
        >
          ?
        </span>
        <span className="font-extrabold">{m.lobby_open_seat()}</span>
      </li>
    );
  }

  const { seat, name, you, creator, held } = props;
  return (
    <li
      data-testid="seat"
      className={cn(
        SIZE,
        "sticker relative flex flex-col items-center justify-center gap-2 rounded-ui p-3 text-center",
      )}
      style={{ background: playerLook(seat).color, color: INK }}
    >
      {creator && (
        <span className="absolute top-2 left-2" title={m.lobby_creator()}>
          <Crown size={24} strokeWidth={2.5} fill="#ffcc00" aria-hidden />
          <span className="sr-only">{m.lobby_creator()}</span>
        </span>
      )}
      <PlayerToken seat={seat} size={28} className="absolute top-2 right-2" />
      <PlayerFigure
        seat={seat}
        size={88}
        className={cn(held && "animate-pulse opacity-50 grayscale")}
      />
      <span className="text-lg leading-tight font-black">{name}</span>
      {held ? (
        <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase">
          <WifiOff size={12} aria-hidden />
          {held}
        </span>
      ) : (
        you && (
          <span className="rounded-full border-2 border-ink bg-[#fffaf3] px-2 text-xs font-extrabold uppercase">
            {m.lobby_you()}
          </span>
        )
      )}
    </li>
  );
}
