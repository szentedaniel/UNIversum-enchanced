/**
 * The Wealth series (spec #177): one sample per passed Turn, plus the final
 * one at game end, so the result screen can chart how the game went. Only the
 * engine can compute Wealth with every rule applied (ADR-0001), so it records
 * the samples in the state and the view hands them out (ticket #236).
 *
 * The Minute comes from the state and the intent's clock only (ADR-0003):
 * `endsAt` is the game's start plus the Room's Minutes, so `minuteMs` is all
 * the start needs to be derived from what the state holds.
 */
import { wealthOf } from "#rules/pricing.ts";
import type { PlayerId, WealthSample } from "#state.ts";
import type { Tx } from "#tx.ts";

/** The game Minute `now` falls in, counted from the game's start at 0. */
function minuteAt(tx: Tx): number {
  const { state } = tx;
  const start = state.endsAt - state.settings.minuteLimit * state.minuteMs;
  return Math.floor((tx.ctx.now - start) / state.minuteMs);
}

/**
 * Appends the current Wealth of every Player (R77), at the game Minute of the
 * intent's clock. A Bankrupt Player holds no cash and no Fields, so their
 * Wealth is 0 from then on and their series stays there.
 */
export function recordWealthSample(tx: Tx): void {
  const wealth: Record<PlayerId, number> = {};
  for (const player of tx.state.players) wealth[player.id] = wealthOf(tx.state, player.id);
  const sample: WealthSample = { minute: minuteAt(tx), wealth };
  tx.state.wealthSamples.push(sample);
}
