import { describe, expect, it } from "vitest";
import {
  apply,
  isRejection,
  migrate,
  publicView,
  ROUND_BONUS,
  START_CASH,
  STATE_VERSION,
  SYSTEM,
  TURN_LIMIT_MS,
  TURN_SLACK_MS,
} from "#index.ts";
import stateV1 from "./fixtures/state-v1.json" with { type: "json" };
import stateV2 from "./fixtures/state-v2.json" with { type: "json" };
import stateV3 from "./fixtures/state-v3.json" with { type: "json" };
import stateV4 from "./fixtures/state-v4.json" with { type: "json" };
import stateV5 from "./fixtures/state-v5.json" with { type: "json" };
import stateV6 from "./fixtures/state-v6.json" with { type: "json" };
import stateV7 from "./fixtures/state-v7.json" with { type: "json" };
import stateV8 from "./fixtures/state-v8.json" with { type: "json" };
import { deadlineOf, newGame, roll } from "./helpers.ts";

/**
 * Stored snapshots, one per `stateVersion` the server has ever written
 * (`fixtures/state-v<N>.json`). Never edit an old one: a running game stored
 * at that version must still load after a deploy.
 *
 * When the state's shape changes: bump `STATE_VERSION`, add the migration
 * from the old version to `MIGRATIONS` (migrate.ts), and commit a snapshot of
 * the new shape, `JSON.stringify(playTurn(newGame()).state, null, 2)` (a
 * game one Turn in, waiting for the dice), as `state-v<new>.json` here.
 */
const fixtures: { version: number; state: unknown }[] = [
  { version: 1, state: stateV1 },
  { version: 2, state: stateV2 },
  { version: 3, state: stateV3 },
  { version: 4, state: stateV4 },
  { version: 5, state: stateV5 },
  { version: 6, state: stateV6 },
  { version: 7, state: stateV7 },
  { version: 8, state: stateV8 },
];

/** The keys of an object, and of its first array item or nested object, as paths. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.length ? shape(value[0], `${path}[]`) : [`${path}[]`];
  if (value === null || typeof value !== "object") return [path];
  return Object.entries(value)
    .flatMap(([key, child]) =>
      key === "phase" ? [`${path}.phase`] : shape(child, `${path}.${key}`),
    )
    .toSorted();
}

describe("state migrations", () => {
  it("a snapshot of the current state version is committed", () => {
    expect(fixtures.map((f) => f.version)).toContain(STATE_VERSION);
  });

  it("the current snapshot has the shape a new game has (a changed shape needs a new STATE_VERSION)", () => {
    const current = fixtures.find((f) => f.version === STATE_VERSION);

    expect(shape(current?.state)).toEqual(shape(roll(newGame()).state));
  });

  it.each(fixtures)("a snapshot stored at version $version loads and plays on", ({ state }) => {
    const migrated = migrate(state);

    expect(migrated.stateVersion).toBe(STATE_VERSION);
    expect(() => publicView(migrated)).not.toThrow();
    const rolled = apply(
      migrated,
      { type: "Roll", turn: migrated.turn },
      { actor: migrated.currentPlayer, now: deadlineOf(migrated) - 1 },
    );
    expect(isRejection(rolled)).toBe(false);
    const timedOut = apply(
      migrated,
      { type: "TurnTimedOut", turn: migrated.turn },
      { actor: SYSTEM, now: deadlineOf(migrated) },
    );
    expect(isRejection(timedOut)).toBe(false);
  });

  it("a state stored before the starting cash setting loads with 2,500,000 (story 14)", () => {
    for (const { state } of fixtures.filter((f) => f.version < STATE_VERSION)) {
      expect(migrate(state).settings.startingCash).toBe(START_CASH);
    }
  });

  it("a state stored before the Round bonus setting loads with 250,000 (story 14)", () => {
    for (const { state } of fixtures.filter((f) => f.version < STATE_VERSION)) {
      expect(migrate(state).settings.roundBonus).toBe(ROUND_BONUS);
    }
  });

  it("a state stored before the Turn timer setting loads with 20 s (story 14)", () => {
    for (const { state } of fixtures.filter((f) => f.version < STATE_VERSION)) {
      expect(migrate(state).settings.turnLimitMs).toBe(TURN_LIMIT_MS);
    }
  });

  it("ADR-0004: a version-1 state keeps its deadline and needs no wait", () => {
    const stored = stateV1 as { turnDeadline: number };
    const migrated = migrate(stateV1);

    expect(migrated.turnDeadline).toBe(stored.turnDeadline);
    expect(migrated.actsAfter).toBe(stored.turnDeadline - TURN_LIMIT_MS - TURN_SLACK_MS);
    // The Playback of the decision already ended: the Player may act at once.
    const rolled = apply(
      migrated,
      { type: "Roll", turn: migrated.turn },
      { actor: migrated.currentPlayer, now: migrated.actsAfter },
    );
    expect(isRejection(rolled)).toBe(false);
  });

  it("ADR-0004: a version-1 state with no deadline takes endsAt as its Playback's end", () => {
    const stored = { ...stateV1, turnDeadline: null };

    const migrated = migrate(stored);

    expect(migrated.actsAfter).toBe(stored.endsAt);
  });

  it("a version-2 state seats no Bots: every Player was a Guest", () => {
    const migrated = migrate(stateV2);

    expect(migrated.players.map((p) => p.bot)).toEqual(migrated.players.map(() => false));
  });

  it("spec #172: a version-2 state has no pending Deal, so its Deal slot starts empty", () => {
    expect(migrate(stateV2).deal).toBeNull();
  });

  it("spec #172: a version-7 state keeps this Turn's Deal guard", () => {
    expect(migrate(stateV7).dealUsed).toBe(false);
    const pending = {
      ...stateV7,
      deal: {
        proposer: "p1",
        recipient: "p2",
        give: { fields: [], cash: 0 },
        take: { fields: [], cash: 0 },
      },
    };

    expect(migrate(pending).dealUsed).toBe(true);
  });

  it("a state at the current version comes back unchanged", () => {
    const state = roll(newGame()).state;

    expect(migrate(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("a state from a newer server is refused, not guessed at", () => {
    const state = { ...newGame(), stateVersion: STATE_VERSION + 1 };

    expect(() => migrate(state)).toThrow(/stateVersion/);
  });

  it.each([0, -1, "1", null])("a state with stateVersion %j is refused", (stateVersion) => {
    expect(() => migrate({ ...newGame(), stateVersion })).toThrow(/stateVersion/);
  });
});
