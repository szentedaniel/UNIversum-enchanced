/**
 * Invariants over whole games (spec: Testing Decisions). The games are played
 * by `simulation.ts`, a seeded driver that only chooses options the current
 * phase and the public view offer, with random Turn timeouts. fast-check
 * varies the seeds, the Player count, the Minute limit and the timeout rate,
 * so the invariants are checked across many different games rather than one
 * hand-built state.
 */
import { assert, constantFrom, integer, property, record, tuple, type Arbitrary } from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FIELDS,
  publicView,
  TURN_LIMIT_MS,
  TURN_SLACK_MS,
  type GameState,
  type PlayerState,
  type Seed,
} from "#index.ts";
import { ledgerOf, playRandomGame } from "./simulation.ts";

/** A 4-word PRNG seed that is never all zero (the engine refuses that one). */
const seedArb: Arbitrary<Seed> = tuple(
  integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
  integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
  integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
  integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
).map((words) => (words.every((word) => word === 0) ? ([1, 0, 0, 0] as const) : words));

const gameArb = record({
  seed: seedArb,
  choiceSeed: integer({ min: 1, max: 1_000_000 }),
  players: constantFrom<2 | 3 | 4>(2, 3, 4),
  minuteLimit: constantFrom<15 | 30 | 50>(15, 30, 50),
  timeoutEvery: integer({ min: 2, max: 20 }),
});

/** A fixed property seed keeps every run reproducible. */
const RUN = { seed: 20261020, numRuns: 20 };

/** Every key anywhere in a JSON value, so a nested secret cannot hide. */
function keysOf(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, keys);
    return keys;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      keysOf(child, keys);
    }
  }
  return keys;
}

function playerOf(players: readonly PlayerState[], id: string): PlayerState {
  const found = players.find((player) => player.id === id);
  if (!found) throw new Error(`no Player ${id}`);
  return found;
}

/** Whether every Field's owner and Level is legal for its kind. */
function fieldStateIsLegal(state: GameState, field: GameState["fields"][number], id: number) {
  if (field.owner === null) return field.level === 0;
  const owner = playerOf(state.players, field.owner);
  if (owner.bankrupt) return false;
  if (FIELDS[id]?.kind === "university") return field.level >= 1 && field.level <= 4;
  return field.level === 0;
}

describe("played games", () => {
  it("a seeded game never refuses a legal option, never throws, and always ends", () => {
    assert(
      property(gameArb, (game) => {
        const run = playRandomGame(game);

        expect(run.ended).toBe(true);
        expect(run.steps.length).toBeGreaterThan(0);
        // Every move advances the clock ~23 s, so even a 50-minute game ends
        // well inside a few hundred intents.
        expect(run.steps.length).toBeLessThan(500);
        expect(run.state.phase.kind).toBe("gameOver");
      }),
      RUN,
    );
  });

  it("the same seeds replay the same game, so a failing seed is reproducible", () => {
    const options = {
      seed: [1, 2, 3, 4] as const,
      choiceSeed: 7,
      timeoutEvery: 5,
      players: 4 as const,
      settings: { minuteLimit: 30 as const },
    };

    const first = playRandomGame(options);
    const second = playRandomGame(options);

    expect(second.steps.map((step) => [step.intent, step.now])).toEqual(
      first.steps.map((step) => [step.intent, step.now]),
    );
    expect(second.state).toEqual(first.state);
  });

  it("money never goes negative", () => {
    assert(
      property(gameArb, (game) => {
        for (const step of playRandomGame(game).steps) {
          for (const player of step.after.players) {
            expect(Number.isInteger(player.cash)).toBe(true);
            expect(player.cash).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      RUN,
    );
  });

  it("money is conserved apart from the Bank: the events account for every forint", () => {
    assert(
      property(gameArb, (game) => {
        for (const step of playRandomGame(game).steps) {
          const ledger = ledgerOf(step.before, step.events);
          const beforeCash = step.before.players.reduce((sum, player) => sum + player.cash, 0);
          const afterCash = step.after.players.reduce((sum, player) => sum + player.cash, 0);

          // The Bank's net payout is exactly the change in all Players' cash.
          expect(afterCash - beforeCash).toBe(ledger.bank);
          // Every Player's cash moved exactly as the events say it did:
          // Rent and Buyouts between Players, everything else to or from the Bank.
          for (const player of step.after.players) {
            expect(player.cash).toBe(ledger.cash[player.id]);
          }
        }
      }),
      RUN,
    );
  });

  it("a Bankrupt Player is never the current Player, keeps 0 cash and owns nothing", () => {
    assert(
      property(gameArb, (game) => {
        const bankrupt = new Set<string>();

        for (const step of playRandomGame(game).steps) {
          const state = step.after;
          expect(playerOf(state.players, state.currentPlayer).bankrupt).toBe(false);

          for (const player of state.players) {
            if (player.bankrupt) bankrupt.add(player.id);
          }
          for (const id of bankrupt) {
            const player = playerOf(state.players, id);
            expect(player.bankrupt).toBe(true);
            expect(player.cash).toBe(0);
            expect(state.fields.some((field) => field.owner === id)).toBe(false);
          }
        }
      }),
      RUN,
    );
  });

  it("every decision phase has a fresh 20 s deadline; the final phase has none", () => {
    assert(
      property(gameArb, (game) => {
        for (const step of playRandomGame(game).steps) {
          const expected =
            step.after.phase.kind === "gameOver" ? null : step.now + TURN_LIMIT_MS + TURN_SLACK_MS;

          expect(step.after.turnDeadline).toBe(expected);
        }
      }),
      RUN,
    );
  });

  it("every Field has at most one owner: the owner is a live Player, or the Bank", () => {
    assert(
      property(gameArb, (game) => {
        for (const step of playRandomGame(game).steps) {
          const state = step.after;

          for (const [id, field] of state.fields.entries()) {
            expect(fieldStateIsLegal(state, field, id)).toBe(true);
          }

          const { doubler } = state;
          expect(
            doubler === null ||
              FIELDS[doubler.field]?.kind === "university" ||
              FIELDS[doubler.field]?.kind === "museum",
          ).toBe(true);
          expect(doubler === null || doubler.count >= 1).toBe(true);
          expect(doubler === null || state.fields[doubler.field]?.owner !== null).toBe(true);
        }
      }),
      RUN,
    );
  });

  it("exactly one winner at game end, and the game ends only once", () => {
    assert(
      property(gameArb, (game) => {
        const run = playRandomGame(game);
        const { phase } = run.state;

        expect(phase.kind).toBe("gameOver");
        const winner = phase.kind === "gameOver" ? phase.winner : "";
        const winners = run.state.players.filter((player) => player.id === winner);

        expect(winners).toHaveLength(1);
        expect(winners[0]?.bankrupt).toBe(false);
        expect(run.state.currentPlayer).toBe(winner);

        const ended = run.steps.flatMap((step) =>
          step.events.filter((event) => event.type === "GameEnded"),
        );
        expect(ended).toHaveLength(1);
      }),
      RUN,
    );
  });

  it("publicView never carries the PRNG state or a Guest token", () => {
    assert(
      property(gameArb, (game) => {
        for (const step of playRandomGame(game).steps) {
          const view = publicView(step.after);
          const deadline = step.after.turnDeadline;

          expect(view).not.toHaveProperty("rng");
          expect(keysOf(view)).not.toContain("rng");
          for (const secret of ["guestToken", "tokenHash", "reconnectionToken"]) {
            expect(keysOf(view)).not.toContain(secret);
          }
          expect(JSON.stringify(view)).not.toMatch(
            /"(rng|guestToken|tokenHash|reconnectionToken)"/,
          );

          expect(view.turnTimer).toEqual(
            deadline === null ? null : { endsAt: deadline - TURN_SLACK_MS, limitMs: TURN_LIMIT_MS },
          );
        }
      }),
      RUN,
    );
  });
});
