/**
 * A Player's marks: the token (their colour plus their shape, so Players are
 * told apart without colour) and their alien figure. The figure always sits on
 * a cream disc, so a pink alien stays visible on a pink Seat card.
 */
import { cn } from "#lib/utils.ts";
import { INK, playerLook } from "#players.ts";

export function PlayerToken({
  seat,
  size = 22,
  className,
}: {
  seat: number;
  size?: number;
  className?: string;
}) {
  const { color, shape } = playerLook(seat);
  return (
    <span
      aria-hidden
      data-shape={shape}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-ink leading-none font-bold",
        className,
      )}
      style={{ width: size, height: size, background: color, color: INK, fontSize: size * 0.55 }}
    >
      {shape}
    </span>
  );
}

export function PlayerFigure({
  seat,
  size = 48,
  className,
}: {
  seat: number;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-ink bg-[#fffaf3]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img src={playerLook(seat).figure} alt="" draggable={false} style={{ height: size * 0.72 }} />
    </span>
  );
}
