import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, KNEE_PROFILE, type LoadProfile } from "#config.ts";
import { dropPlanForGame, kneeRoomPlans, roomPlans, runSeconds, seededRandom } from "#profile.ts";

const sample = (profile: LoadProfile) => roomPlans(profile);

describe("the seeded profile", () => {
  it("is deterministic for a seed", () => {
    expect(sample(DEFAULT_PROFILE)).toEqual(sample(DEFAULT_PROFILE));
    const other = sample({ ...DEFAULT_PROFILE, seed: 7 });
    expect(other).not.toEqual(sample(DEFAULT_PROFILE));
  });

  it("ramps every Room linearly from 0 to the ramp length", () => {
    const plans = sample({ ...DEFAULT_PROFILE, rooms: 100 });
    expect(plans).toHaveLength(100);
    expect(plans[0]?.startAtMs).toBe(0);
    expect(plans.at(-1)?.startAtMs).toBe(DEFAULT_PROFILE.rampSeconds * 1_000);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.startAtMs).toBeGreaterThan(plans[i - 1]!.startAtMs);
    }
  });

  it("gives every 4th Room a password, about 10% of the time", () => {
    const plans = sample(DEFAULT_PROFILE);
    const withPassword = plans.filter((plan) => plan.password).length;
    expect(withPassword / plans.length).toBeGreaterThan(0.07);
    expect(withPassword / plans.length).toBeLessThan(0.13);
  });

  it("brings each Room's other three Guests in over 5–30 s", () => {
    for (const plan of sample({ ...DEFAULT_PROFILE, rooms: 50 })) {
      expect(plan.joinDelaysMs).toHaveLength(3);
      for (const delay of plan.joinDelaysMs) {
        expect(delay).toBeGreaterThanOrEqual(5_000);
        expect(delay).toBeLessThanOrEqual(30_000);
      }
    }
    expect(
      sample({ ...DEFAULT_PROFILE, rooms: 5, playersPerRoom: 2 })[0]?.joinDelaysMs,
    ).toHaveLength(1);
  });

  it("runs the ramp and then the hold", () => {
    expect(runSeconds(DEFAULT_PROFILE)).toBe(40 * 60);
    expect(runSeconds({ ...DEFAULT_PROFILE, rampSeconds: 60, holdSeconds: 120 })).toBe(180);
  });
});

describe("the per-game drop plan", () => {
  const profile: LoadProfile = DEFAULT_PROFILE;
  const plans = Array.from({ length: 5_000 }, (_, game) =>
    dropPlanForGame(seededRandom(profile.seed + game), profile),
  );
  const drops = plans.flat();

  it("drops about 10% of the Players once per game", () => {
    const players = 5_000 * profile.playersPerRoom;
    expect(drops.length / players).toBeGreaterThan(0.08);
    expect(drops.length / players).toBeLessThan(0.12);
  });

  it("sends 2% of the drops away for more than a minute, by Guest token", () => {
    const long = drops.filter((drop) => drop.long);
    expect(long.length / drops.length).toBeGreaterThan(0.01);
    expect(long.length / drops.length).toBeLessThan(0.035);
    for (const drop of long) {
      expect(drop.returnMs).toBeGreaterThanOrEqual(60_000);
      expect(drop.returnMs).toBeLessThanOrEqual(120_000);
    }
  });

  it("returns a short drop in 2–30 s by reconnection token", () => {
    for (const drop of drops.filter((planned) => !planned.long)) {
      expect(drop.returnMs).toBeGreaterThanOrEqual(2_000);
      expect(drop.returnMs).toBeLessThanOrEqual(30_000);
    }
  });

  it("drops once per Player, within the drop window, before the game ends", () => {
    for (const plan of plans) {
      expect(new Set(plan.map((drop) => drop.player)).size).toBe(plan.length);
      for (const drop of plan) {
        expect(drop.atMs).toBeGreaterThanOrEqual(profile.dropWindowMs[0]);
        // A 15-minute game still has 30 s of play after the Player is back.
        expect(drop.atMs + drop.returnMs).toBeLessThanOrEqual(15 * 60_000 - 30_000);
      }
    }
  });

  it("never schedules a drop for a Player who is not in the Room", () => {
    const plan = dropPlanForGame(seededRandom(1), { ...profile, playersPerRoom: 2 });
    for (const drop of plan) expect(drop.player).toBeLessThan(2);
  });
});

describe("the find-knee schedule", () => {
  it("adds 100 Rooms a minute from the starting count", () => {
    const plans = kneeRoomPlans({ ...KNEE_PROFILE, maxRooms: 300 });
    expect(plans).toHaveLength(300);
    expect(plans[0]?.startAtMs).toBe(0);
    expect(plans[99]?.startAtMs).toBe(59_400);
    expect(plans[100]?.startAtMs).toBe(60_000);
    expect(plans[299]?.startAtMs).toBe(179_400);
  });
});
