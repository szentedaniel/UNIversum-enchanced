/**
 * A Spectator's one badge (spec #179): its Lobby and Game screen are
 * read-only, and the badge says so. The Lobby's header row and the Game's
 * status row both draw it.
 */
import { m } from "#text.ts";

export function WatchingMark() {
  return (
    <span
      data-testid="watching"
      className="sticker-sm shrink-0 rounded-full bg-card px-2 py-1 text-xs font-black text-card-foreground"
    >
      {m.watching()}
    </span>
  );
}
