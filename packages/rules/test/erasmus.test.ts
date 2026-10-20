import { describe, expect, it } from "vitest";
import { FIELDS, publicView, SYSTEM, type GameState } from "#index.ts";
import { accept, deadlineOf, newGame, player, reject, rollOnto, withField } from "./helpers.ts";

const VESZPREM = 1;
const ZURICH = 5;
const LONDON = 21;
const ERASMUS = 24;
const MUSEUM_4 = 28;

/** Every ownable Field (Universities and Museums) owned by `playerId`. */
function owningEveryField(state: GameState, playerId: string): GameState {
  return FIELDS.filter((f) => f.kind === "university" || f.kind === "museum").reduce(
    (next, f) => withField(next, f.id, { owner: playerId }),
    state,
  );
}

describe("landing on Erasmus", () => {
  it("R64: offers every University and Museum no other Player owns", () => {
    let state = withField(newGame({ players: 2 }), LONDON, { owner: "p2", level: 1 });
    state = withField(state, ZURICH, { owner: "p1", level: 1 });

    const landed = rollOnto(state, ERASMUS);
    const phase = landed.state.phase;

    expect(phase.kind).toBe("choosingErasmus");
    if (phase.kind !== "choosingErasmus") return;
    expect(phase.fields).toContain(VESZPREM); // unowned
    expect(phase.fields).toContain(ZURICH); // own
    expect(phase.fields).toContain(MUSEUM_4); // unowned Museum
    expect(phase.fields).not.toContain(LONDON); // another Player's
    expect(phase.fields).not.toContain(ERASMUS);
  });

  it("R64: another Player's Fields are not offered even when the Player owns nothing", () => {
    const state = owningEveryField(newGame({ players: 2 }), "p2");

    const landed = rollOnto(state, ERASMUS);

    // F16: there is nothing to pick, so the Turn passes at once. Owning every
    // ownable Field is also a Super-monopoly, which ends the game there (R78).
    expect(landed.state.phase).toEqual({
      kind: "gameOver",
      winner: "p2",
      reason: "superMonopoly",
    });
    expect(landed.state.currentPlayer).toBe("p2");
  });
});

describe("travelling with Erasmus", () => {
  it("R65: travels forward, pays the Round bonus for passing Start and lands normally", () => {
    const landed = rollOnto(newGame({ players: 2 }), ERASMUS);

    const travelled = accept(
      landed.state,
      { type: "TravelErasmus", turn: landed.state.turn, field: LONDON },
      "p1",
    );

    expect(travelled.events).toContainEqual({
      type: "Moved",
      player: "p1",
      from: ERASMUS,
      to: LONDON,
      steps: 29,
    });
    expect(travelled.events).toContainEqual({
      type: "RoundBonusPaid",
      player: "p1",
      amount: 250_000,
    });
    expect(player(travelled.state, "p1").position).toBe(LONDON);
    expect(player(travelled.state, "p1").cash).toBe(2_750_000);
    // London is unowned: landing normally offers it.
    expect(travelled.state.phase).toMatchObject({ kind: "offer", field: LONDON });
    expect(travelled.state.currentPlayer).toBe("p1");
  });

  it("R65: a destination ahead without passing Start pays no Round bonus", () => {
    const landed = rollOnto(newGame({ players: 2 }), ERASMUS);

    const travelled = accept(
      landed.state,
      { type: "TravelErasmus", turn: landed.state.turn, field: MUSEUM_4 },
      "p1",
    );

    expect(travelled.events).not.toContainEqual(
      expect.objectContaining({ type: "RoundBonusPaid" }),
    );
    expect(player(travelled.state, "p1").position).toBe(MUSEUM_4);
    expect(player(travelled.state, "p1").cash).toBe(2_500_000);
    expect(travelled.state.phase).toMatchObject({ kind: "offer", field: MUSEUM_4 });
  });

  it("R65: landing on the Player's own Museum does nothing and passes the Turn", () => {
    let state = withField(newGame({ players: 2 }), MUSEUM_4, { owner: "p1" });
    state = withField(state, VESZPREM, { owner: "p2", level: 1 });

    const landed = rollOnto(state, ERASMUS);
    const travelled = accept(
      landed.state,
      { type: "TravelErasmus", turn: landed.state.turn, field: MUSEUM_4 },
      "p1",
    );

    expect(travelled.state.currentPlayer).toBe("p2");
    expect(travelled.state.phase).toEqual({ kind: "awaitingRoll" });
  });

  it("R64: a Field another Player owns is refused", () => {
    const state = withField(newGame({ players: 2 }), LONDON, { owner: "p2", level: 1 });
    const landed = rollOnto(state, ERASMUS);

    const refused = reject(
      landed.state,
      { type: "TravelErasmus", turn: landed.state.turn, field: LONDON },
      "p1",
    );

    expect(refused).toMatchObject({ code: "NOT_OFFERED" });
  });

  it("F16: with nothing to pick the Turn passes at once, with no penalty", () => {
    const state = owningEveryField(newGame({ players: 2 }), "p2");

    const landed = rollOnto(state, ERASMUS);

    expect(landed.state.currentPlayer).toBe("p2");
    // The game ends at this Turn change (the Super-monopoly), before a new Turn begins.
    expect(landed.state.phase).toMatchObject({ kind: "gameOver", winner: "p2" });
    expect(player(landed.state, "p1").cash).toBe(2_500_000);
    expect(landed.events.some((event) => event.type === "TimedOut")).toBe(false);
  });

  it("R19: a Timeout on the choice gives the normal penalty and passes the Turn", () => {
    const landed = rollOnto(newGame({ players: 2 }), ERASMUS);

    const timedOut = accept(
      landed.state,
      { type: "TurnTimedOut", turn: landed.state.turn },
      SYSTEM,
      deadlineOf(landed.state),
    );

    expect(player(timedOut.state, "p1").cash).toBe(2_250_000);
    expect(timedOut.state.currentPlayer).toBe("p2");
    expect(timedOut.state.phase).toEqual({ kind: "awaitingRoll" });
  });
});

describe("the Erasmus pick in the view", () => {
  it("lists each destination's Fields ahead and whether it passes Start", () => {
    const state = withField(newGame({ players: 2 }), ZURICH, { owner: "p1", level: 1 });

    const landed = rollOnto(state, ERASMUS);
    const view = publicView(landed.state);

    expect(view.pickOptions).toContainEqual({
      kind: "erasmus",
      field: LONDON,
      steps: 29,
      passesStart: true,
      bonus: 250_000,
    });
    expect(view.pickOptions).toContainEqual({
      kind: "erasmus",
      field: MUSEUM_4,
      steps: 4,
      passesStart: false,
      bonus: null,
    });
  });

  it("is null outside a pick", () => {
    expect(publicView(newGame({ players: 2 })).pickOptions).toBeNull();
  });
});
