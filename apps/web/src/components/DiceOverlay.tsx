/**
 * The two dice of a Roll, shown on every screen for the Roll's own Playback
 * step (ADR-0004): pips drawn in the Tabletop tokens, no art needed. The sound
 * still starts on `DiceRolled` in `Game.tsx`, never here.
 */
import { m } from "#text.ts";

/** Pip positions by face on a 3 × 3 grid, left to right, top to bottom. */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function Die({ face }: { face: number }) {
  const pips = PIPS[face] ?? [];
  return (
    <div className="sticker grid size-16 shrink-0 grid-cols-3 grid-rows-3 gap-1 rounded-xl bg-card p-2.5 sm:size-20">
      {CELLS.map((cell) => (
        <span key={cell} className="flex items-center justify-center">
          {pips.includes(cell) && <span className="size-2.5 rounded-full bg-ink sm:size-3" />}
        </span>
      ))}
    </div>
  );
}

/** The Roll's two dice: `data-testid="dice"` is what the e2e frame probe samples. */
export function DiceOverlay({ dice }: { dice: readonly [number, number] }) {
  return (
    <figure
      data-testid="dice"
      aria-label={m.dice_rolled({ first: dice[0], second: dice[1] })}
      className="pop-in m-0 flex items-center gap-3"
    >
      <Die face={dice[0]} />
      <Die face={dice[1]} />
    </figure>
  );
}
