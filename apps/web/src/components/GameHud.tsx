/**
 * The game's status row: the Minute pill (time left in the game) and the one
 * event toast. On desktop they share one row above the Board's fit area; on
 * phone they sit between the Player chips and the Board.
 */
import { Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { serverNow } from "#lib/server-clock.ts";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

/** `m:ss` for a number of milliseconds (never negative). */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The game's time left, from `view.endsAt` (server epoch ms), ticking every
 * second on the server's clock, as the pushes carry it (`GameMessage.now`).
 */
export function MinutePill({
  endsAt,
  clockOffset = 0,
  className,
}: {
  endsAt: number;
  /** The server's clock minus this client's, from the push. */
  clockOffset?: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => serverNow(clockOffset));
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow(clockOffset)), 1000);
    return () => clearInterval(timer);
  }, [clockOffset]);
  return (
    <div
      data-testid="minute-pill"
      className={cn(
        "sticker-sm inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1 text-card-foreground",
        className,
      )}
    >
      <Timer size={16} strokeWidth={3} aria-hidden />
      <span className="sr-only">{m.game_time_left()}</span>
      <span className="tnum text-base font-black">{formatClock(endsAt - now)}</span>
    </div>
  );
}

/** One event toast; `tone` colours good and bad news. Empty keeps the row's height. */
export function EventToast({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad";
  className?: string;
}) {
  return (
    <output
      data-testid="toast"
      className={cn("flex min-h-8 max-w-md min-w-0 items-center", className)}
    >
      {children ? (
        <span
          className={cn(
            "sticker-sm pop-in truncate rounded-full px-3 py-1 text-sm font-bold",
            tone === "good" && "bg-accent text-accent-foreground",
            tone === "bad" && "bg-[#ffd0d0] text-ink",
            tone === "neutral" && "bg-card text-card-foreground",
          )}
        >
          {children}
        </span>
      ) : null}
    </output>
  );
}
