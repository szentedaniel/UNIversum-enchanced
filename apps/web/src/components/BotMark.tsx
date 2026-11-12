/**
 * The "BOT" mark a Bot wears on its Seat card, Player card and Podium place
 * (spec: Bots, story 4; ticket #196). The text is a Paraglide message, so a
 * Guest reads it in their own language.
 */
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

export function BotMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="bot-mark"
      className={cn(
        "inline-block shrink-0 rounded-full border-2 border-ink bg-[#fffaf3] px-1.5 text-[10px] leading-tight font-extrabold text-ink uppercase",
        className,
      )}
    >
      {m.bot_mark()}
    </span>
  );
}
