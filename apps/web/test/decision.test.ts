import {
  apply,
  publicView,
  setupGame,
  type Applied,
  type FieldState,
  type GameState,
  type Intent,
  type PlayerId,
  type PlayerState,
  type PublicView,
  type Seed,
} from "@universum/rules";
import { FIELD_COUNT, type FieldId } from "@universum/rules/board";
import { describe, expect, it } from "vitest";
import {
  bottomSlot,
  decisionKey,
  fieldTap,
  mySaleOrPick,
  openDecision,
  waitingLine,
} from "#decision/decision.ts";
import type { Frame } from "#playback/playback.ts";
import { playbackOfPush } from "#playback/playback.ts";

// The Decision module (spec #72): which Decision this client shows, what the
// bottom slot shows and what a Board tap does — from plain data, with no
// browser, React or timers. Views come from the real rules; frames from the
// Playback core.

// Field ids (packages/rules/src/board.ts).
const VESZPREM = 1;
const BUDAPEST = 2;
const MUSEUM_1 = 4;
const QUARANTINE = 8;
const VIENNA = 13;
const BERLIN = 15;
const DOUBLER = 16;
const SEATTLE = 17;
const ERASMUS = 24;
const MUSEUM_4 = 28;

const T0 = Date.UTC(2026, 9, 19, 12, 0, 0);
const SEED: Seed = [0x1234_5678, -0x2345_6789, 0x0bad_f00d, 0x7777_1111];

/** A freshly started game. */
function newGame(players = 2): GameState {
  return setupGame({
    seats: Array.from({ length: players }, (_, index) => ({
      playerId: `p${index + 1}`,
      name: { adjective: `adj${index}`, noun: `noun${index}` },
    })),
    settings: { maxPlayers: 4, minuteLimit: 50 },
    seed: SEED,
    now: T0,
  });
}

/** Applies an intent that must be accepted, acting as the current Player. */
function accept(state: GameState, intent: Intent): Applied {
  // Nobody may act before the last Playback ends (ADR-0004).
  const result = apply(state, intent, {
    actor: state.currentPlayer,
    now: Math.max(T0, state.actsAfter),
  });
  if ("code" in result) throw new Error(`${intent.type} was refused: ${result.code}`);
  return result;
}

function withPlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === id ? { ...player, ...patch } : player)),
  };
}

function withField(state: GameState, field: FieldId, patch: Partial<FieldState>): GameState {
  return {
    ...state,
    fields: state.fields.map((own, id) => (id === field ? { ...own, ...patch } : own)),
  };
}

/** `state` with `owner` holding each listed Field at its Level (`museum` stays 0). */
function owning(state: GameState, owner: PlayerId, levels: Record<number, number>): GameState {
  return Object.entries(levels).reduce(
    (next, [field, level]) => withField(next, Number(field), { owner, level }),
    state,
  );
}

/** The current Player rolls and lands on `field` (the dice depend only on the PRNG). */
function rollOnto(state: GameState, field: FieldId): Applied {
  const probe = accept(state, { type: "Roll", turn: state.turn });
  const rolled = probe.events.find((event) => event.type === "DiceRolled");
  if (rolled?.type !== "DiceRolled") throw new Error("the Roll drew no dice");
  const [a, b] = rolled.dice;
  const position = (field - (a + b) + FIELD_COUNT) % FIELD_COUNT;
  return accept(withPlayer(state, state.currentPlayer, { position }), {
    type: "Roll",
    turn: state.turn,
  });
}

/** Plays the current Player's whole Turn, turning down or resolving every decision it opens. */
function playTurn(state: GameState): GameState {
  let current = accept(state, { type: "Roll", turn: state.turn }).state;
  for (let guard = 0; guard < 10; guard++) {
    const { phase, turn } = current;
    if (phase.kind === "offer") {
      current = accept(current, { type: "DeclineOffer", turn }).state;
      continue;
    }
    if (phase.kind === "placingDoubler" || phase.kind === "choosingErasmus") {
      const field = phase.fields[0];
      if (field === undefined) return current;
      current = accept(
        current,
        phase.kind === "placingDoubler"
          ? { type: "PlaceDoubler", turn, field }
          : { type: "TravelErasmus", turn, field },
      ).state;
      continue;
    }
    return current;
  }
  return current;
}

/** The Roll that opens the second Seat's Sale: 100,000 and two Fields, landing on the first's Level 4 Seattle. */
function sellingRoll(): Applied {
  let state = owning(newGame(), "p2", { [VESZPREM]: 1, [BERLIN]: 4 });
  state = withField(state, SEATTLE, { owner: "p1", level: 4 });
  state = withPlayer(state, "p2", { cash: 100_000 });
  return rollOnto({ ...state, currentPlayer: "p2" }, SEATTLE);
}

/** The state `sellingRoll` leaves: the second Seat's Sale is open. */
function sellingState(): GameState {
  return sellingRoll().state;
}

/** `owner` holds three Fields and lands on the Doubler Field. */
function doublerState(owner: PlayerId = "p1"): GameState {
  const state = owning(newGame(), owner, { [VESZPREM]: 1, [BUDAPEST]: 1, [MUSEUM_1]: 0 });
  return rollOnto({ ...state, currentPlayer: owner }, DOUBLER).state;
}

/** The first Seat lands on the Erasmus Field with every Field on offer. */
function erasmusState(): GameState {
  return rollOnto(newGame(), ERASMUS).state;
}

/** `quarantined` sits in Quarantine and their next Turn starts with the Quarantine choice. */
function quarantinedState(quarantined: PlayerId = "p1"): GameState {
  const start = quarantined === "p1" ? newGame() : { ...newGame(), currentPlayer: quarantined };
  return playTurn(rollOnto(start, QUARANTINE).state);
}

/** The other Seat is bankrupt, so the first Seat's Turn change ends the game. */
function gameOverState(): GameState {
  const state = withField(withPlayer(newGame(), "p2", { bankrupt: true, cash: 0 }), MUSEUM_4, {
    owner: "p1",
    level: 0,
  });
  return rollOnto(state, MUSEUM_4).state;
}

const RECEIVED_AT = 1_000;

/** A frame for `view`, with the gate open or just before it opens. */
function frameOf(view: PublicView, gate: "open" | "shut" = "open"): Frame {
  const playback = playbackOfPush({
    view,
    events: [],
    reveals: [],
    seq: 1,
    clockOffset: 0,
    receivedAt: RECEIVED_AT,
  });
  return playback.frameAt(gate === "open" ? playback.opensAt : playback.opensAt - 1);
}

/** This client's Decision in `view` (the current Player is `me` unless a test says otherwise). */
const myDecision = (view: PublicView, inFlight = false) =>
  openDecision(frameOf(view), view.currentPlayer, inFlight);

/** The bottom-slot UI state, with nothing open unless a test says otherwise. */
const uiOf = (patch: Partial<{ selectedField: FieldId | null; inspect: boolean }> = {}) => ({
  selectedField: null,
  inspect: false,
  ...patch,
});

describe("openDecision", () => {
  it("offers me the Roll", () => {
    const view = publicView(newGame());

    expect(myDecision(view)).toEqual({ owner: "me", kind: "roll" });
  });

  it("offers me the Offer the phase lists", () => {
    const view = publicView(rollOnto(newGame(), VIENNA).state);

    expect(view.phase.kind).toBe("offer");
    expect(myDecision(view)).toEqual({ owner: "me", kind: "offer", offer: view.phase });
  });

  it("offers me the Quarantine choice the phase lists", () => {
    const view = publicView(quarantinedState());

    expect(view.phase.kind).toBe("quarantineChoice");
    expect(myDecision(view)).toEqual({ owner: "me", kind: "quarantine", choice: view.phase });
  });

  it("offers me my Sale with its key, Shortfall and pickable Fields", () => {
    const view = publicView(sellingState());

    expect(view.phase.kind).toBe("selling");
    const decision = myDecision(view);
    expect(decision).toMatchObject({ owner: "me", kind: "sale", busy: false });
    const mine = mySaleOrPick(decision);
    if (mine?.kind !== "sale") throw new Error("no Sale opened");
    expect(mine.sale.key).toBe(`${view.turn}:${view.turnDeadline}`);
    expect(mine.sale.shortfall).toBe(824_000);
    expect(mine.sale.pickable).toEqual([VESZPREM, BERLIN]);
  });

  it("offers me my Doubler pick", () => {
    const view = publicView(doublerState());

    expect(view.phase.kind).toBe("placingDoubler");
    const decision = myDecision(view);
    expect(decision).toMatchObject({ owner: "me", kind: "pick", busy: false });
    const mine = mySaleOrPick(decision);
    if (mine?.kind !== "pick") throw new Error("no pick opened");
    expect(mine.pick.kind).toBe("doubler");
    expect(mine.pick.pickable).toEqual([VESZPREM, BUDAPEST, MUSEUM_1]);
  });

  it("offers me my Erasmus pick", () => {
    const view = publicView(erasmusState());

    expect(view.phase.kind).toBe("choosingErasmus");
    const decision = myDecision(view);
    expect(decision).toMatchObject({ owner: "me", kind: "pick", busy: false });
    const mine = mySaleOrPick(decision);
    if (mine?.kind !== "pick") throw new Error("no pick opened");
    expect(mine.pick.kind).toBe("erasmus");
    expect(mine.pick.pickable.length).toBeGreaterThan(0);
  });

  it("shows another Player's Sale as a waiting line", () => {
    const view = publicView(sellingState());

    expect(openDecision(frameOf(view), "p1", false)).toEqual({ owner: "p2", kind: "sale" });
  });

  it("shows another Player's pick as a waiting line", () => {
    const view = publicView(doublerState("p2"));

    expect(openDecision(frameOf(view), "p1", false)).toEqual({ owner: "p2", kind: "pick" });
  });

  it("shows no Decision for another Player's Roll, Offer or Quarantine choice", () => {
    const roll = publicView(newGame());
    expect(openDecision(frameOf(roll), "p2", false)).toBeNull();

    const offer = publicView(rollOnto({ ...newGame(), currentPlayer: "p2" }, VIENNA).state);
    expect(offer.phase.kind).toBe("offer");
    expect(openDecision(frameOf(offer), "p1", false)).toBeNull();

    const quarantine = publicView(quarantinedState());
    expect(openDecision(frameOf(quarantine), "p2", false)).toBeNull();
  });

  it("ADR-0004: opens no Decision while the gate is shut", () => {
    const offer = publicView(rollOnto(newGame(), VIENNA).state);
    expect(openDecision(frameOf(offer, "shut"), offer.currentPlayer, false)).toBeNull();

    const sale = publicView(sellingState());
    expect(openDecision(frameOf(sale, "shut"), "p2", false)).toBeNull();
  });

  it("opens no Decision on the result screen", () => {
    const view = publicView(gameOverState());

    expect(view.phase.kind).toBe("gameOver");
    expect(openDecision(frameOf(view), view.currentPlayer, false)).toBeNull();
  });

  it("hides a one-tap Decision while its intent is in flight", () => {
    const views = [
      publicView(newGame()),
      publicView(rollOnto(newGame(), VIENNA).state),
      publicView(quarantinedState()),
    ];

    for (const view of views) expect(myDecision(view, true)).toBeNull();
  });

  it("keeps my Sale and pick open and busy while an intent is in flight", () => {
    expect(myDecision(publicView(sellingState()), true)).toMatchObject({
      owner: "me",
      kind: "sale",
      busy: true,
    });
    expect(myDecision(publicView(doublerState()), true)).toMatchObject({
      owner: "me",
      kind: "pick",
      busy: true,
    });
  });

  it("keeps another Player's waiting line while an intent is in flight", () => {
    const view = publicView(sellingState());

    expect(openDecision(frameOf(view), "p1", true)).toEqual({ owner: "p2", kind: "sale" });
  });
});

describe("mySaleOrPick", () => {
  it("reads my Sale's key, pickable Fields and busy state", () => {
    const view = publicView(sellingState());
    const key = `${view.turn}:${view.turnDeadline}`;

    expect(mySaleOrPick(myDecision(view))).toMatchObject({
      kind: "sale",
      key,
      pickable: [VESZPREM, BERLIN],
      busy: false,
      sale: { key, shortfall: 824_000 },
    });
    expect(mySaleOrPick(myDecision(view, true))).toMatchObject({ kind: "sale", busy: true });
  });

  it("reads my pick's key, pickable Fields and busy state", () => {
    const view = publicView(doublerState());
    const key = `${view.turn}:${view.turnDeadline}`;

    expect(mySaleOrPick(myDecision(view))).toMatchObject({
      kind: "pick",
      key,
      pickable: [VESZPREM, BUDAPEST, MUSEUM_1],
      busy: false,
      pick: { kind: "doubler" },
    });
    expect(mySaleOrPick(myDecision(view, true))).toMatchObject({ kind: "pick", busy: true });
  });

  it("is null for every other Decision, a waiting line included", () => {
    const sale = publicView(sellingState());
    const pick = publicView(doublerState("p2"));

    expect(mySaleOrPick(null)).toBeNull();
    expect(mySaleOrPick(myDecision(publicView(newGame())))).toBeNull();
    expect(mySaleOrPick(myDecision(publicView(rollOnto(newGame(), VIENNA).state)))).toBeNull();
    expect(mySaleOrPick(myDecision(publicView(quarantinedState())))).toBeNull();
    expect(mySaleOrPick(openDecision(frameOf(sale), "p1", false))).toBeNull();
    expect(mySaleOrPick(openDecision(frameOf(pick), "p1", false))).toBeNull();
  });
});

describe("waitingLine", () => {
  it("is another Player's Sale or pick", () => {
    const sale = publicView(sellingState());
    const pick = publicView(doublerState("p2"));

    expect(waitingLine(openDecision(frameOf(sale), "p1", false))).toBe("sale");
    expect(waitingLine(openDecision(frameOf(pick), "p1", false))).toBe("pick");
  });

  it("is null for my own Sale and pick", () => {
    expect(waitingLine(myDecision(publicView(sellingState())))).toBeNull();
    expect(waitingLine(myDecision(publicView(doublerState())))).toBeNull();
  });

  it("is null for every other Decision, another Player's included", () => {
    expect(waitingLine(null)).toBeNull();
    expect(waitingLine(myDecision(publicView(newGame())))).toBeNull();
    expect(waitingLine(myDecision(publicView(rollOnto(newGame(), VIENNA).state)))).toBeNull();
    expect(waitingLine(myDecision(publicView(quarantinedState())))).toBeNull();
    expect(waitingLine(openDecision(frameOf(publicView(newGame())), "p2", false))).toBeNull();
  });
});

describe("bottomSlot", () => {
  it("shows nothing on the result screen until the gate opens, then the podium", () => {
    const view = publicView(gameOverState());
    const { phase } = view;
    if (phase.kind !== "gameOver") throw new Error("the game is not over");

    expect(bottomSlot(null, frameOf(view, "shut"), uiOf())).toEqual({ kind: "none" });
    expect(bottomSlot(null, frameOf(view), uiOf())).toEqual({ kind: "podium", phase });
  });

  it("shows the result screen ahead of an open Field card", () => {
    const view = publicView(gameOverState());
    const { phase } = view;
    if (phase.kind !== "gameOver") throw new Error("the game is not over");

    expect(
      bottomSlot(null, frameOf(view), uiOf({ selectedField: SEATTLE, inspect: true })),
    ).toEqual({
      kind: "podium",
      phase,
    });
  });

  it("shows nothing before the first frame", () => {
    expect(bottomSlot(null, null, uiOf({ selectedField: SEATTLE }))).toEqual({ kind: "none" });
  });

  it("shows my Sale tray with the Decision's Sale and busy state", () => {
    const view = publicView(sellingState());

    expect(bottomSlot(myDecision(view), frameOf(view), uiOf())).toMatchObject({
      kind: "sale",
      busy: false,
      sale: { key: `${view.turn}:${view.turnDeadline}`, shortfall: 824_000 },
    });
  });

  it("shows my pick tray with the Decision's pick and busy state", () => {
    const view = publicView(doublerState());

    expect(bottomSlot(myDecision(view), frameOf(view), uiOf())).toMatchObject({
      kind: "pick",
      busy: false,
      pick: { kind: "doubler", pickable: [VESZPREM, BUDAPEST, MUSEUM_1] },
    });
  });

  it("keeps the tray when inspect mode has no Field open", () => {
    const view = publicView(sellingState());

    expect(bottomSlot(myDecision(view), frameOf(view), uiOf({ inspect: true }))).toMatchObject({
      kind: "sale",
      busy: false,
    });
  });

  it("opens the Field card in inspect mode during my Sale, stepping through its pickable Fields", () => {
    const view = publicView(sellingState());

    expect(
      bottomSlot(myDecision(view), frameOf(view), uiOf({ inspect: true, selectedField: SEATTLE })),
    ).toEqual({ kind: "fieldCard", field: SEATTLE, stepThrough: [VESZPREM, BERLIN] });
  });

  it("opens the Field card in inspect mode during my pick, stepping through its pickable Fields", () => {
    const view = publicView(doublerState());

    expect(
      bottomSlot(myDecision(view), frameOf(view), uiOf({ inspect: true, selectedField: SEATTLE })),
    ).toEqual({ kind: "fieldCard", field: SEATTLE, stepThrough: [VESZPREM, BUDAPEST, MUSEUM_1] });
  });

  it("shows the tray ahead of a selected Field outside inspect mode", () => {
    const view = publicView(sellingState());

    expect(
      bottomSlot(myDecision(view), frameOf(view), uiOf({ selectedField: SEATTLE })),
    ).toMatchObject({ kind: "sale", busy: false });
  });

  it("shows a selected Field's card, else the Turn card", () => {
    const view = publicView(newGame());
    const decision = myDecision(view);

    expect(bottomSlot(decision, frameOf(view), uiOf({ selectedField: SEATTLE }))).toEqual({
      kind: "fieldCard",
      field: SEATTLE,
    });
    expect(bottomSlot(decision, frameOf(view), uiOf())).toEqual({ kind: "turnCard" });
  });
});

describe("fieldTap", () => {
  it("toggles a Sale pick for a Field and ignores a tap off the Board", () => {
    const view = publicView(sellingState());
    const decision = myDecision(view);
    const key = `${view.turn}:${view.turnDeadline}`;

    expect(fieldTap(decision, { inspect: false }, SEATTLE)).toEqual({
      kind: "toggleSale",
      key,
      field: SEATTLE,
    });
    expect(fieldTap(decision, { inspect: false }, null)).toEqual({ kind: "ignore" });
  });

  it("chooses a pick Field and ignores a tap off the Board", () => {
    const view = publicView(doublerState());
    const decision = myDecision(view);
    const key = `${view.turn}:${view.turnDeadline}`;

    expect(fieldTap(decision, { inspect: false }, BUDAPEST)).toEqual({
      kind: "choosePick",
      key,
      field: BUDAPEST,
    });
    expect(fieldTap(decision, { inspect: false }, null)).toEqual({ kind: "ignore" });
  });

  it("opens Field cards instead of picking in inspect mode", () => {
    const view = publicView(sellingState());
    const decision = myDecision(view);

    expect(fieldTap(decision, { inspect: true }, SEATTLE)).toEqual({
      kind: "selectField",
      field: SEATTLE,
    });
    expect(fieldTap(decision, { inspect: true }, null)).toEqual({
      kind: "selectField",
      field: null,
    });
  });

  it("ignores picking while my Sale or pick is in flight, but inspect still opens Field cards", () => {
    const sale = myDecision(publicView(sellingState()), true);
    expect(fieldTap(sale, { inspect: false }, SEATTLE)).toEqual({ kind: "ignore" });
    expect(fieldTap(sale, { inspect: true }, SEATTLE)).toEqual({
      kind: "selectField",
      field: SEATTLE,
    });
    expect(fieldTap(sale, { inspect: true }, null)).toEqual({ kind: "selectField", field: null });

    const pick = myDecision(publicView(doublerState()), true);
    expect(fieldTap(pick, { inspect: false }, BUDAPEST)).toEqual({ kind: "ignore" });
    expect(fieldTap(pick, { inspect: true }, BUDAPEST)).toEqual({
      kind: "selectField",
      field: BUDAPEST,
    });
  });

  it("opens a Field card when no Sale or pick is mine", () => {
    const roll = myDecision(publicView(newGame()));
    expect(fieldTap(roll, { inspect: false }, SEATTLE)).toEqual({
      kind: "selectField",
      field: SEATTLE,
    });
    expect(fieldTap(null, { inspect: false }, null)).toEqual({ kind: "selectField", field: null });

    const waiting = publicView(sellingState());
    expect(
      fieldTap(openDecision(frameOf(waiting), "p1", false), { inspect: false }, SEATTLE),
    ).toEqual({ kind: "selectField", field: SEATTLE });
  });
});

describe("decisionKey", () => {
  it("is my Sale's key, whatever the in-flight state", () => {
    const view = publicView(sellingState());
    const key = `${view.turn}:${view.turnDeadline}`;

    expect(decisionKey(myDecision(view))).toBe(key);
    expect(decisionKey(myDecision(view, true))).toBe(key);
  });

  it("is my pick's key", () => {
    const view = publicView(doublerState());

    expect(decisionKey(myDecision(view))).toBe(`${view.turn}:${view.turnDeadline}`);
  });

  it("is null for every other Decision", () => {
    const sale = publicView(sellingState());

    expect(decisionKey(myDecision(publicView(newGame())))).toBeNull();
    expect(decisionKey(openDecision(frameOf(sale), "p1", false))).toBeNull();
    expect(decisionKey(null)).toBeNull();
  });

  it("ADR-0004: is null through the Playback that opens my Sale, then my Sale's key", () => {
    const { state, events } = sellingRoll();
    const view = publicView(state);
    const key = `${view.turn}:${view.turnDeadline}`;
    // The push that opens my Sale carries the Playback that leads to it: the dice and the hop.
    const playback = playbackOfPush({
      view,
      events,
      reveals: [],
      seq: 2,
      clockOffset: 0,
      receivedAt: RECEIVED_AT,
    });
    const keyAt = (clientNow: number) =>
      decisionKey(openDecision(playback.frameAt(clientNow), view.currentPlayer, false));

    expect(events.length).toBeGreaterThan(0);
    expect(playback.frameAt(RECEIVED_AT).overlay).toMatchObject({ kind: "dice" });
    expect(playback.opensAt).toBeGreaterThan(RECEIVED_AT);
    expect(keyAt(RECEIVED_AT)).toBeNull();
    expect(keyAt(playback.opensAt - 1)).toBeNull();
    expect(keyAt(playback.opensAt)).toBe(key);
  });
});
