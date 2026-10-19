/**
 * A Player's figure (on its cream disc) inside a ring in their colour. While
 * it's their Turn, `ring` is the Turn timer (`screens/TurnRing.tsx`, an SVG
 * that fills this box) drawn over the coloured ring.
 */
import type { ReactNode } from "react";
import { PlayerFigure } from "#components/PlayerToken.tsx";
import { cn } from "#lib/utils.ts";
import { playerLook } from "#players.ts";

export function TimerRing({
  seat,
  size = 56,
  ring = null,
  className,
}: {
  seat: number;
  size?: number;
  /** The Turn timer, only on the current Player. */
  ring?: ReactNode;
  className?: string;
}) {
  // The figure's disc leaves the ring's stroke (4/36 of the box) free.
  const disc = Math.round(size * (1 - 10 / 36));
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={{ width: size, height: size, background: playerLook(seat).color }}
    >
      <PlayerFigure seat={seat} size={disc} />
      {ring}
    </span>
  );
}
