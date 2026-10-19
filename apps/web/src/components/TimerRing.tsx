/**
 * A Player's figure inside a ring in their colour. While it's their Turn the
 * ring shows the Turn clock: `progress` (1 = full, 0 = out of time) drawn in
 * primary, in danger for the last 5 seconds, with the seconds in a badge.
 */
import { PlayerFigure } from "#components/PlayerToken.tsx";
import { cn } from "#lib/utils.ts";
import { playerLook } from "#players.ts";

const DANGER_SECONDS = 5;

export function TimerRing({
  seat,
  size = 56,
  progress = null,
  secondsLeft = null,
  className,
}: {
  seat: number;
  size?: number;
  /** The share of the Turn clock left, or null when it isn't this Player's Turn. */
  progress?: number | null;
  secondsLeft?: number | null;
  className?: string;
}) {
  const stroke = Math.max(4, size / 11);
  const radius = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const danger = secondsLeft !== null && secondsLeft <= DANGER_SECONDS;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={{ width: size, height: size, background: playerLook(seat).color }}
      data-active={progress !== null || undefined}
    >
      <PlayerFigure seat={seat} size={size - 2 * stroke} />
      {progress !== null && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 -rotate-90"
          width={size}
          height={size}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={danger ? "var(--danger)" : "var(--primary)"}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
            strokeLinecap="round"
          />
        </svg>
      )}
      {secondsLeft !== null && (
        <span className="tnum absolute -right-1.5 -bottom-1.5 rounded-full border-2 border-ink bg-card px-1 text-[11px] leading-4 font-black text-card-foreground">
          {Math.ceil(secondsLeft)}
        </span>
      )}
    </span>
  );
}
