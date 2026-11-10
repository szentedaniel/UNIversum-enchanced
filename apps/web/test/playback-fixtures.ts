import type { FieldView, GameEvent, PlayerView, PublicView, Reveal } from "@universum/rules";

/** A Roll, the walk, the Rent it stopped at and the Turn passing. */
export const ROLL = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [3, 4] },
  { type: "Moved", player: "p1", from: 1, to: 8, steps: 7 },
  { type: "RentPaid", player: "p1", owner: "p2", field: 8, amount: 50_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A Roll from the Field before Start: the walk pays the Round bonus on the way. */
export const PAST_START = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [2, 2] },
  { type: "Moved", player: "p1", from: 30, to: 2, steps: 4 },
  { type: "RoundBonusPaid", player: "p1", amount: 200_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A Roll onto Chance: the card is drawn, then its money arrives. */
export const CHANCE = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [1, 1] },
  { type: "Moved", player: "p1", from: 12, to: 14, steps: 2 },
  { type: "CardDrawn", player: "p1", card: "scholarship" },
  { type: "ChanceMoneyReceived", player: "p1", amount: 300_000 },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A Roll onto Chance: the card's Charge is paid, and its shortfall forces a Sale. */
export const CHANCE_CHARGE = (): GameEvent[] => [
  { type: "DiceRolled", player: "p1", dice: [6, 6] },
  { type: "Moved", player: "p1", from: 5, to: 17, steps: 12 },
  { type: "CardDrawn", player: "p1", card: "failedExams" },
  { type: "ChanceChargePaid", player: "p1", amount: 200_000 },
  { type: "FieldsSold", player: "p1", fields: [3], amount: 100_000, auto: true },
  { type: "TurnPassed", player: "p2", turn: 2 },
];

/** A timeout: the timeout, the Auto-sell it forced and the penalty. */
export const TIMEOUT = (): GameEvent[] => [
  { type: "TimedOut", player: "p1" },
  { type: "FieldsSold", player: "p1", fields: [1], amount: 100_000, auto: true },
  { type: "TimeoutPenaltyPaid", player: "p1", amount: 50_000 },
  { type: "TurnPassed", player: "p2", turn: 3 },
];

const player = (id: string, seat: number, position: number, cash = 100_000) => ({
  id,
  name: { adjective: "happy", noun: "tiger" },
  seat,
  cash,
  position,
  bankrupt: false,
  quarantineRounds: null,
  hasPcrTest: false,
  bot: false,
  wealth: cash,
});

/** Two Players with the given cash (and so Wealth), as a push's final view shows them. */
export const playersWithCash = (
  cash: { p1: number; p2: number },
  positions: { p1: number; p2: number } = { p1: 8, p2: 17 },
): PlayerView[] => [player("p1", 0, positions.p1, cash.p1), player("p2", 1, positions.p2, cash.p2)];

const BASE_VIEW: PublicView = {
  stateVersion: 2,
  version: 1,
  turn: 2,
  currentPlayer: "p1",
  phase: { kind: "awaitingRoll" },
  actsAfter: 0,
  turnDeadline: null,
  turnTimer: null,
  settings: { maxPlayers: 2, minuteLimit: 15, startingCash: 2_500_000 },
  endsAt: 0,
  players: [],
  fields: [],
  doubler: null,
  lastChanceCard: null,
  autoSell: null,
  pickOptions: null,
  standings: null,
};

/** Two Players at the given Fields, with the push's view fields patched in. */
export const viewOf = (
  positions: { p1: number; p2: number } = { p1: 8, p2: 17 },
  patch: Partial<PublicView> = {},
): PublicView => ({
  ...BASE_VIEW,
  players: [player("p1", 0, positions.p1), player("p2", 1, positions.p2)],
  ...patch,
});

/** A Field as a reveal carries it: the state plus the numbers the UI shows. */
export const fieldOf = (patch: Partial<FieldView> = {}): FieldView => ({
  owner: null,
  level: 0,
  value: 0,
  rent: 0,
  sale: 0,
  ...patch,
});

/**
 * A reveal of the two Players' cash, with the board left empty and the pawns
 * one Field behind the final view (a reveal never moves a pawn).
 */
export const revealWithCash = (
  cash: { p1: number; p2: number },
  patch: Partial<Reveal> = {},
): Reveal => ({
  players: playersWithCash(cash, { p1: 1, p2: 16 }),
  fields: [],
  doubler: null,
  ...patch,
});
