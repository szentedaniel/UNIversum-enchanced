/**
 * A watcher's one badge (spec #179): the Room's Lobby and Game screen are
 * read-only for it. The Lobby's header and the Game's status row both draw it,
 * so the Room shows at a glance that nobody here is playing.
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
