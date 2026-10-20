import type { TurnTimer } from "@universum/rules";
import { useState } from "react";
import { m } from "#text.ts";

type Props = {
  timer: TurnTimer;
  /** Server clock minus this client's clock, from the push (`Push.clockOffset`). */
  clockOffset: number;
};

/**
 * The Turn timer (R17): a ring that empties over the 20 s Turn limit and runs
 * out at `timer.endsAt` on the server's clock. The server's slack is never
 * shown. Mount it with a `key` per deadline so every decision restarts it.
 */
export function TurnRing({ timer, clockOffset }: Props) {
  // Read the clock once, when this deadline's ring mounts; CSS animates the rest.
  const [style] = useState(() => {
    // The ring stays full until the Playback ends (`endsAt - limitMs`), then
    // empties over the Turn limit. A ring mounted after it began (a reload, a
    // reconnect) starts partway through with a negative delay.
    const leftMs = Math.max(0, timer.endsAt - (Date.now() + clockOffset));
    return {
      animationDuration: `${timer.limitMs}ms`,
      animationDelay: `${leftMs - timer.limitMs}ms`,
    };
  });
  return (
    <svg
      className="turn-ring"
      viewBox="0 0 36 36"
      role="timer"
      aria-label={m.game_turn_timer()}
      data-testid="turn-timer"
    >
      <circle className="turn-ring-track" cx="18" cy="18" r="16" pathLength={100} />
      <circle className="turn-ring-left" cx="18" cy="18" r="16" pathLength={100} style={style} />
    </svg>
  );
}
