import { describe, expect, it } from "vitest";
import {
  publicView,
  SYSTEM,
  TURN_LIMIT_MS,
  TURN_SLACK_MS,
  type Applied,
  type DealSide,
  type GameState,
  type PlayerState,
} from "#index.ts";
import {
  accept,
  deadlineOf,
  newGame,
  player,
  reject,
  rollOnto,
  withField,
  withPlayer,
} from "./helpers.ts";
import { ledgerOf } from "./simulation.ts";

// Field ids (packages/rules/src/board.ts).
const VESZPREM = 1;
const BUDAPEST = 2;
const MUSEUM_1 = 4;
const QUARANTINE = 8;
const VIENNA = 13;
const LONDON = 21;

const PROPOSER = "p1";
const RECIPIENT = "p2";

/** A 2-Player game: `p1` owns Vienna at Level 2, `p2` owns London at Level 1. */
function twoPlayerGame(): GameState {
  return withField(
    withField(newGame({ players: 2 }), VIENNA, { owner: PROPOSER, level: 2 }),
    LONDON,
    { owner: RECIPIENT, level: 1 },
  );
}

const GIVE: DealSide = { fields: [VIENNA], cash: 100_000 };
const TAKE: DealSide = { fields: [LONDON], cash: 50_000 };

/** A `ProposeDeal` intent for `state`'s Turn, with the Deal's terms overridden by `patch`. */
function proposal(
  state: GameState,
  patch: { recipient?: string; give?: DealSide; take?: DealSide } = {},
) {
  return {
    type: "ProposeDeal" as const,
    turn: state.turn,
    recipient: patch.recipient ?? RECIPIENT,
    give: patch.give ?? GIVE,
    take: patch.take ?? TAKE,
  };
}

/** The current Player (the proposer) puts a Deal to `RECIPIENT`. */
function propose(
  state: GameState,
  patch: { recipient?: string; give?: DealSide; take?: DealSide } = {},
): Applied {
  return accept(state, proposal(state, patch), state.currentPlayer);
}

/** The recipient answers the pending Deal. */
function answer(state: GameState, type: "AcceptDeal" | "DeclineDeal"): Applied {
  return accept(state, { type, turn: state.turn }, state.currentPlayer, state.actsAfter);
}

const timeOut = (state: GameState) =>
  accept(state, { type: "TurnTimedOut", turn: state.turn }, SYSTEM, deadlineOf(state));

/**
 * A 2-Player game on `p2`'s quarantined Turn: `p2` stands on the Quarantine
 * Field with rounds left, and `p1`'s Turn times out (no dice drawn).
 */
function quarantinedTurn(
  patch: Partial<PlayerState> = {},
  base: GameState = newGame({ players: 2 }),
): GameState {
  const state = withPlayer(base, "p2", {
    position: QUARANTINE,
    quarantineRounds: 2,
    ...patch,
  });
  return timeOut(state).state;
}

/** The fresh Turn timer a decision reopened after its Playback gets (ADR-0004). */
const freshDeadline = (state: GameState): number => state.actsAfter + TURN_LIMIT_MS + TURN_SLACK_MS;

describe("proposing a Deal", () => {
  it("puts the Deal to the recipient, whose answer Decision opens with the Turn timer", () => {
    const before = twoPlayerGame();
    const proposed = propose(before);

    expect(proposed.state.deal).toEqual({
      proposer: PROPOSER,
      recipient: RECIPIENT,
      give: GIVE,
      take: TAKE,
    });
    expect(proposed.events).toEqual([
      { type: "DealProposed", proposer: PROPOSER, recipient: RECIPIENT, give: GIVE, take: TAKE },
    ]);
    // The recipient decides now; the proposer's own Roll waits behind the answer.
    expect(proposed.state).toMatchObject({
      currentPlayer: RECIPIENT,
      phase: { kind: "dealAnswer" },
    });
    expect(proposed.state.turnDeadline).toBe(freshDeadline(proposed.state));
    expect(proposed.state.turnDeadline).toBeGreaterThan(deadlineOf(before));
    // Nothing moves until the recipient answers.
    expect(proposed.state.fields).toEqual(before.fields);
  });

  it("the view carries the pending Deal and the answer Decision", () => {
    const proposed = propose(twoPlayerGame());

    expect(publicView(proposed.state)).toMatchObject({
      currentPlayer: RECIPIENT,
      phase: { kind: "dealAnswer" },
      deal: { proposer: PROPOSER, recipient: RECIPIENT, give: GIVE, take: TAKE },
    });
  });

  it("only the current Player may propose, and only at a Roll or Quarantine choice", () => {
    const state = twoPlayerGame();

    expect(reject(state, proposal(state), "p2")).toEqual({ code: "NOT_YOUR_TURN" });

    // A landing that opens an Offer is not a Roll choice.
    const offered = rollOnto(state, VESZPREM).state;
    expect(offered.phase.kind).toBe("offer");
    expect(reject(offered, proposal(offered), "p1")).toEqual({ code: "NOT_OFFERED" });

    // The Quarantine choice is one.
    const quarantined = quarantinedTurn({}, twoPlayerGame());
    expect(quarantined.phase.kind).toBe("quarantineChoice");
    const proposed = propose(quarantined, {
      recipient: PROPOSER,
      give: { fields: [LONDON], cash: 0 },
      take: { fields: [VIENNA], cash: 0 },
    });
    expect(proposed.state).toMatchObject({
      currentPlayer: PROPOSER,
      phase: { kind: "dealAnswer" },
    });
  });

  it("a second Deal in the same Turn is refused", () => {
    const declined = answer(propose(twoPlayerGame()).state, "DeclineDeal");
    expect(declined.state).toMatchObject({ currentPlayer: PROPOSER, dealUsed: true });
    expect(publicView(declined.state).dealUsed).toBe(true);
    expect(reject(declined.state, proposal(declined.state), PROPOSER)).toEqual({
      code: "DEAL_ALREADY_PROPOSED",
    });

    const accepted = answer(propose(twoPlayerGame()).state, "AcceptDeal");
    expect(
      reject(
        accepted.state,
        proposal(accepted.state, {
          give: { fields: [LONDON], cash: 0 },
          take: { fields: [VIENNA], cash: 0 },
        }),
        PROPOSER,
      ),
    ).toEqual({ code: "DEAL_ALREADY_PROPOSED" });

    const expired = timeOut(propose(twoPlayerGame()).state);
    expect(reject(expired.state, proposal(expired.state), PROPOSER)).toEqual({
      code: "DEAL_ALREADY_PROPOSED",
    });
  });

  it("the next Turn may propose a Deal again", () => {
    const declined = answer(propose(twoPlayerGame()).state, "DeclineDeal");
    const nextTurn = timeOut(declined.state).state;

    expect(nextTurn).toMatchObject({ currentPlayer: RECIPIENT, dealUsed: false });
    expect(publicView(nextTurn).dealUsed).toBe(false);
    const proposed = propose(nextTurn, {
      recipient: PROPOSER,
      give: { fields: [LONDON], cash: 0 },
      take: { fields: [VIENNA], cash: 0 },
    });
    expect(proposed.state.deal).toMatchObject({ proposer: RECIPIENT, recipient: PROPOSER });
  });

  it("the recipient must be another, active Player", () => {
    const state = twoPlayerGame();

    expect(reject(state, proposal(state, { recipient: PROPOSER }), "p1")).toEqual({
      code: "DEAL_RECIPIENT_INVALID",
    });
    expect(reject(state, proposal(state, { recipient: "p9" }), "p1")).toEqual({
      code: "DEAL_RECIPIENT_INVALID",
    });
    const bankrupt = withPlayer(state, RECIPIENT, { bankrupt: true });
    expect(reject(bankrupt, proposal(bankrupt), "p1")).toEqual({
      code: "DEAL_RECIPIENT_INVALID",
    });
  });

  it("every offered Field must be the proposer's and every asked Field the recipient's", () => {
    const state = twoPlayerGame();
    const cash = { fields: [], cash: 0 };

    // The recipient's London cannot be offered by the proposer.
    expect(
      reject(state, proposal(state, { give: { fields: [LONDON], cash: 0 }, take: cash }), "p1"),
    ).toEqual({ code: "DEAL_FIELD_NOT_OWNED" });
    // The proposer's Vienna cannot be asked of the recipient.
    expect(
      reject(state, proposal(state, { give: cash, take: { fields: [VIENNA], cash: 0 } }), "p1"),
    ).toEqual({ code: "DEAL_FIELD_NOT_OWNED" });
    // An unowned Field belongs to neither side.
    expect(
      reject(state, proposal(state, { give: { fields: [BUDAPEST], cash: 0 }, take: cash }), "p1"),
    ).toEqual({ code: "DEAL_FIELD_NOT_OWNED" });
  });

  it("a Field can appear only once in a Deal", () => {
    const state = twoPlayerGame();
    const cash = { fields: [], cash: 0 };

    expect(
      reject(
        state,
        proposal(state, { give: { fields: [VIENNA, VIENNA], cash: 0 }, take: cash }),
        "p1",
      ),
    ).toEqual({ code: "DEAL_FIELD_REPEATED" });
    expect(
      reject(
        state,
        proposal(state, {
          give: { fields: [VIENNA], cash: 0 },
          take: { fields: [VIENNA], cash: 0 },
        }),
        "p1",
      ),
    ).toEqual({ code: "DEAL_FIELD_REPEATED" });
  });

  it("a Deal must move at least one Field or some cash", () => {
    const state = twoPlayerGame();
    const nothing = { fields: [], cash: 0 };

    expect(reject(state, proposal(state, { give: nothing, take: nothing }), "p1")).toEqual({
      code: "DEAL_EMPTY",
    });
    // Cash alone is a Deal.
    const cashOnly = propose(state, { give: { fields: [], cash: 100_000 }, take: nothing });
    expect(cashOnly.state.deal).not.toBeNull();
  });

  it("neither side's cash may fall short, and exactly the payer's cash is covered", () => {
    const state = twoPlayerGame();
    const nothing = { fields: [], cash: 0 };

    expect(
      reject(
        state,
        proposal(state, { give: { fields: [], cash: 2_500_001 }, take: nothing }),
        "p1",
      ),
    ).toEqual({ code: "DEAL_CASH_NOT_COVERED" });
    expect(
      reject(
        state,
        proposal(state, { give: nothing, take: { fields: [], cash: 2_500_001 } }),
        "p1",
      ),
    ).toEqual({ code: "DEAL_CASH_NOT_COVERED" });

    const exact = withPlayer(state, PROPOSER, { cash: 100_000 });
    expect(
      propose(exact, { give: { fields: [], cash: 100_000 }, take: nothing }).state.deal,
    ).not.toBeNull();
  });
});

describe("answering a Deal", () => {
  it("accepting moves the Fields at their Level and the cash; the Doubler stays on its Field", () => {
    const state = { ...twoPlayerGame(), doubler: { field: VIENNA, count: 1 } };
    const before = withField(state, MUSEUM_1, { owner: PROPOSER, level: 0 });
    const give: DealSide = { fields: [VIENNA, MUSEUM_1], cash: 100_000 };
    const proposed = propose(before, { give });

    const accepted = answer(proposed.state, "AcceptDeal");

    expect(accepted.state.fields[VIENNA]).toEqual({ owner: RECIPIENT, level: 2 });
    expect(accepted.state.fields[MUSEUM_1]).toEqual({ owner: RECIPIENT, level: 0 });
    expect(accepted.state.fields[LONDON]).toEqual({ owner: PROPOSER, level: 1 });
    expect(player(accepted.state, PROPOSER).cash).toBe(2_500_000 - 100_000 + 50_000);
    expect(player(accepted.state, RECIPIENT).cash).toBe(2_500_000 + 100_000 - 50_000);
    // The Doubler stands where it stood, on the Field that changed hands.
    expect(accepted.state.doubler).toEqual({ field: VIENNA, count: 1 });
    expect(accepted.events).toEqual([
      { type: "DealAccepted", proposer: PROPOSER, recipient: RECIPIENT, give, take: TAKE },
    ]);
    // Cash moves between the two Players, never via the Bank.
    expect(ledgerOf(proposed.state, accepted.events)).toEqual({
      bank: 0,
      cash: { p1: 2_450_000, p2: 2_550_000 },
    });
  });

  it("acceptance refuses a Deal whose Fields changed hands meanwhile", () => {
    const proposed = propose(twoPlayerGame());
    const offeredGone = withField(proposed.state, VIENNA, { owner: RECIPIENT });

    expect(reject(offeredGone, { type: "AcceptDeal", turn: offeredGone.turn }, RECIPIENT)).toEqual({
      code: "DEAL_FIELD_NOT_OWNED",
    });

    const askedGone = withField(proposed.state, LONDON, { owner: PROPOSER });
    expect(reject(askedGone, { type: "AcceptDeal", turn: askedGone.turn }, RECIPIENT)).toEqual({
      code: "DEAL_FIELD_NOT_OWNED",
    });
  });

  it("acceptance refuses a Deal whose cash is no longer covered", () => {
    const proposed = propose(twoPlayerGame());
    const poorRecipient = withPlayer(proposed.state, RECIPIENT, { cash: TAKE.cash - 1 });

    expect(
      reject(poorRecipient, { type: "AcceptDeal", turn: poorRecipient.turn }, RECIPIENT),
    ).toEqual({ code: "DEAL_CASH_NOT_COVERED" });

    const poorProposer = withPlayer(proposed.state, PROPOSER, { cash: GIVE.cash - 1 });
    expect(
      reject(poorProposer, { type: "AcceptDeal", turn: poorProposer.turn }, RECIPIENT),
    ).toEqual({ code: "DEAL_CASH_NOT_COVERED" });
  });

  it("the proposer's Roll reopens with a fresh deadline after the answer", () => {
    const proposed = propose(twoPlayerGame());

    const accepted = answer(proposed.state, "AcceptDeal");

    expect(accepted.state).toMatchObject({
      currentPlayer: PROPOSER,
      phase: { kind: "awaitingRoll" },
    });
    expect(accepted.state.deal).toBeNull();
    expect(accepted.state.turnDeadline).toBe(freshDeadline(accepted.state));
    expect(publicView(accepted.state).deal).toBeNull();
    // The Turn carries on: the proposer may roll at once.
    const rolled = accept(
      accepted.state,
      { type: "Roll", turn: accepted.state.turn },
      PROPOSER,
      accepted.state.actsAfter,
    );
    expect(rolled.events.some((event) => event.type === "DiceRolled")).toBe(true);
  });

  it("declining moves nothing and reopens the proposer's Roll with a fresh deadline", () => {
    const state = twoPlayerGame();
    const proposed = propose(state);

    const declined = answer(proposed.state, "DeclineDeal");

    expect(declined.state.fields).toEqual(state.fields);
    expect(declined.state.players).toEqual(proposed.state.players);
    expect(declined.events).toEqual([
      { type: "DealDeclined", proposer: PROPOSER, recipient: RECIPIENT },
    ]);
    expect(declined.state).toMatchObject({
      currentPlayer: PROPOSER,
      phase: { kind: "awaitingRoll" },
      deal: null,
    });
    expect(declined.state.turnDeadline).toBe(freshDeadline(declined.state));
  });

  it("a Quarantine proposer is back at the Quarantine choice, its options recomputed", () => {
    const quarantined = quarantinedTurn({}, twoPlayerGame());
    // p2 gives almost all its cash, so the PCR test is no longer affordable.
    const proposed = propose(quarantined, {
      recipient: PROPOSER,
      give: { fields: [], cash: 2_400_000 },
      take: { fields: [], cash: 0 },
    });

    const accepted = answer(proposed.state, "AcceptDeal");

    expect(player(accepted.state, RECIPIENT).cash).toBe(100_000);
    expect(accepted.state).toMatchObject({
      currentPlayer: RECIPIENT,
      phase: {
        kind: "quarantineChoice",
        canBuyPcrTest: false,
        canUsePcrTest: false,
        pcrTestPrice: 200_000,
      },
      deal: null,
    });
    expect(accepted.state.turnDeadline).toBe(freshDeadline(accepted.state));
  });

  it("only the recipient answers, and only while the Deal is pending", () => {
    const idle = twoPlayerGame();
    expect(reject(idle, { type: "AcceptDeal", turn: idle.turn }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });

    const proposed = propose(idle);
    expect(reject(proposed.state, { type: "AcceptDeal", turn: proposed.state.turn }, "p1")).toEqual(
      { code: "NOT_YOUR_TURN" },
    );
    expect(
      reject(proposed.state, { type: "DeclineDeal", turn: proposed.state.turn }, "p1"),
    ).toEqual({ code: "NOT_YOUR_TURN" });
    // The proposer's own Roll waits behind the answer.
    expect(reject(proposed.state, { type: "Roll", turn: proposed.state.turn }, "p1")).toEqual({
      code: "NOT_YOUR_TURN",
    });

    const accepted = answer(proposed.state, "AcceptDeal");
    expect(reject(accepted.state, { type: "AcceptDeal", turn: accepted.state.turn }, "p1")).toEqual(
      { code: "NOT_OFFERED" },
    );
  });

  it("the recipient's timer running out declines the Deal with no Timeout penalty", () => {
    const proposed = propose(twoPlayerGame());

    const expired = timeOut(proposed.state);

    expect(expired.events).toEqual([
      { type: "TimedOut", player: RECIPIENT },
      { type: "DealExpired", proposer: PROPOSER, recipient: RECIPIENT },
    ]);
    expect(expired.state.fields).toEqual(proposed.state.fields);
    expect(expired.state.players).toEqual(proposed.state.players);
    expect(expired.state).toMatchObject({
      currentPlayer: PROPOSER,
      phase: { kind: "awaitingRoll" },
      deal: null,
    });
    expect(expired.state.turnDeadline).toBe(freshDeadline(expired.state));
    expect(reject(expired.state, { type: "AcceptDeal", turn: expired.state.turn }, "p1")).toEqual({
      code: "NOT_OFFERED",
    });
  });

  it("the Playback shows the proposal and the answer with the board each event left", () => {
    const state = { ...twoPlayerGame(), doubler: { field: VIENNA, count: 1 } };

    const proposed = propose(state);
    expect(proposed.reveals).toHaveLength(1);
    expect(proposed.reveals[0]?.fields[VIENNA]).toMatchObject({ owner: PROPOSER, level: 2 });
    expect(proposed.reveals[0]?.doubler).toEqual({ field: VIENNA, count: 1 });

    const accepted = answer(proposed.state, "AcceptDeal");
    expect(accepted.reveals).toHaveLength(1);
    expect(accepted.reveals[0]?.fields[VIENNA]).toMatchObject({ owner: RECIPIENT, level: 2 });
    expect(accepted.reveals[0]?.fields[LONDON]).toMatchObject({ owner: PROPOSER, level: 1 });
    expect(accepted.reveals[0]?.doubler).toEqual({ field: VIENNA, count: 1 });
  });
});
