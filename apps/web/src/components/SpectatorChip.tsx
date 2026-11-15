/**
 * How many Guests are watching the Room, as an eye and their number (spec
 * #179, decision 7): a count only, never a name. Nothing renders at zero, so a
 * Room nobody watches looks as it did before. The Lobby and the Game's status
 * row both draw it.
 */
import { Eye } from "lucide-react";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

export function SpectatorChip({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  const label = count === 1 ? m.spectators_count({ count }) : m.spectators_count_plural({ count });
  return (
    <span
      data-testid="spectators"
      className={cn(
        "sticker-sm inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2 py-1 text-xs font-black text-card-foreground",
        className,
      )}
    >
      <Eye size={16} strokeWidth={3} aria-hidden />
      <span className="sr-only">{label}</span>
      <span aria-hidden className="tnum">
        {count}
      </span>
    </span>
  );
}
