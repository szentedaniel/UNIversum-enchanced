import { describe, expect, it } from "vitest";
import { apply, isRejection, migrate, publicView, STATE_VERSION, SYSTEM } from "#index.ts";
import stateV1 from "./fixtures/state-v1.json" with { type: "json" };
import { newGame, roll } from "./helpers.ts";

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
const fixtures: { version: number; state: unknown }[] = [{ version: 1, state: stateV1 }];

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
      { actor: migrated.currentPlayer, now: migrated.turnDeadline - 1 },
    );
    expect(isRejection(rolled)).toBe(false);
    const timedOut = apply(
      migrated,
      { type: "TurnTimedOut", turn: migrated.turn },
      { actor: SYSTEM, now: migrated.turnDeadline },
    );
    expect(isRejection(timedOut)).toBe(false);
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
