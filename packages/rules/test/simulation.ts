/**
 * A seeded full-game driver (spec: Testing Decisions). It plays random legal
 * games through the public interface only: every move is an option the current
 * phase lists, or one of the Player's Fields as the public view shows them,
 * plus the Room server's `TurnTimedOut` at a random moment. Tests assert the
 * engine's invariants on every accepted step.
 *
 * This is not a rule module: it imports `#index.ts`, like a test.
 */
import {
  apply,
  botIntent,
  isRejection,
  publicView,
  SYSTEM,
  type DealSide,
  type FieldId,
  type GameEvent,
  type GameState,
  type Intent,
  type PlayerId,
  type PublicView,
} from "#index.ts";
import { deadlineOf, newGame, T0, type GameOptions } from "./helpers.ts";

/** A deterministic choice source: `pick(n)` returns an integer in `0…n−1`. */
export type Pick = (n: number) => number;

/** A small deterministic PRNG for the driver's choices (not the game's own). */
export function chooser(seed: number): Pick {
  let x = seed >>> 0;
  return (n) => {
    if (n <= 0) throw new Error(`pick(${n}) has no options`);
    x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0;
    return (x >>> 8) % n;
  };
}

export type SimulationOptions = GameOptions & {
  /** Seed for the driver's own choices; defaults to 1. */
  choiceSeed?: number;
  /** One in `timeoutEvery` decisions is a Turn timeout; defaults to 8. */
  timeoutEvery?: number;
  /** A hard cap on accepted intents, so a broken game cannot loop forever. */
  steps?: number;
  /** The driver's choice source; overrides `choiceSeed`. */
  pick?: Pick;
};

/** One accepted intent, with the states before and after it. */
export type Step = {
  before: GameState;
  after: GameState;
  intent: Intent;
  /** The `ctx.now` the intent was applied with. */
  now: number;
  events: GameEvent[];
};

export type Simulation = {
  state: GameState;
  steps: Step[];
  /** Whether the game reached `gameOver` inside the step cap. */
  ended: boolean;
};

/** A legal move for the current decision, or `null` once the game is over. */
export type Move = { intent: Intent; now: number };

/**
 * The Fields to sell by hand in a Sale: the Player's Fields in a random order,
 * taken until their Bank sale value covers the Shortfall. Every pick it
 * returns is one the player could make by hand.
 */
function sellFor(view: PublicView, playerId: PlayerId, shortfall: number, pick: Pick): FieldId[] {
  const own = view.fields.flatMap((field, id) =>
    field.owner === playerId ? [{ id, sale: field.sale }] : [],
  );
  for (let i = own.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [own[i], own[j]] = [own[j]!, own[i]!];
  }
  const fields: FieldId[] = [];
  let total = 0;
  for (const field of own) {
    if (total >= shortfall) break;
    fields.push(field.id);
    total += field.sale;
  }
  if (fields.length === 0) throw new Error("a Sale with no Field to sell");
  return fields;
}

/**
 * The next legal move the phase and the view offer, or a timeout. The driver
 * never sends an intent the engine would refuse: an option list is built from
 * the phase exactly.
 */
export function nextMove(state: GameState, pick: Pick, timeoutEvery = 8): Move | null {
  if (state.phase.kind === "gameOver") return null;

  const { turn, phase } = state;
  // A random timeout: the server's system intent, a millisecond past the deadline.
  if (pick(timeoutEvery) === 0) {
    return { intent: { type: "TurnTimedOut", turn }, now: deadlineOf(state) + 1 };
  }
  const now = deadlineOf(state) - 1;

  switch (phase.kind) {
    case "awaitingRoll":
      return { intent: { type: "Roll", turn }, now };
    case "offer": {
      const options: Intent[] = phase.levels.map(({ level }) => ({
        type: "BuyLevel",
        turn,
        level,
      }));
      if (phase.museum !== undefined) options.push({ type: "BuyMuseum", turn });
      if (phase.buyout !== undefined) options.push({ type: "Buyout", turn });
      options.push({ type: "DeclineOffer", turn });
      return { intent: options[pick(options.length)]!, now };
    }
    case "selling": {
      if (pick(3) === 0) return { intent: { type: "AutoSell", turn }, now };
      const view = publicView(state);
      return {
        intent: {
          type: "SellFields",
          turn,
          fields: sellFor(view, state.currentPlayer, phase.shortfall, pick),
        },
        now,
      };
    }
    case "quarantineChoice": {
      const options: Intent[] = [{ type: "RollForTwelve", turn }];
      if (phase.canBuyPcrTest) options.push({ type: "BuyPcrTest", turn });
      if (phase.canUsePcrTest) options.push({ type: "UsePcrTest", turn });
      return { intent: options[pick(options.length)]!, now };
    }
    case "placingDoubler": {
      const field = phase.fields[pick(phase.fields.length)];
      if (field === undefined) throw new Error("the Doubler pick offers no Field");
      return { intent: { type: "PlaceDoubler", turn, field }, now };
    }
    case "choosingErasmus": {
      const field = phase.fields[pick(phase.fields.length)];
      if (field === undefined) throw new Error("the Erasmus pick offers no Field");
      return { intent: { type: "TravelErasmus", turn, field }, now };
    }
    case "dealAnswer":
      return { intent: { type: pick(2) === 0 ? "AcceptDeal" : "DeclineDeal", turn }, now };
    default: {
      const unhandled: never = phase;
      throw new Error(`the driver has no move for phase ${JSON.stringify(unhandled)}`);
    }
  }
}

export type BotGameOptions = GameOptions & {
  /** A hard cap on accepted intents, so a broken game cannot loop forever. */
  steps?: number;
  /**
   * One Deal is put to the current Player every `dealEvery` Turns; 0 (the
   * default) never. The driver stands in for a Guest proposer: the policy
   * itself never proposes a Deal (spec #171).
   */
  dealEvery?: number;
};

/**
 * A legal Deal the driver puts to the current Player's next active opponent: a
 * gift on an even Turn and a demand on an odd one, so the Bot's accept and
 * decline paths both run. `null` when the phase does not allow a proposal or
 * neither side has a Field or cash to move.
 */
function dealProposal(view: PublicView): Intent | null {
  const { phase } = view;
  if (phase.kind !== "awaitingRoll" && phase.kind !== "quarantineChoice") return null;
  const proposer = view.currentPlayer;
  const recipient = view.players.find((player) => player.id !== proposer && !player.bankrupt);
  if (!recipient) return null;
  const turn = view.turn;
  if (turn % 2 === 0) {
    const mine = view.fields.flatMap((field, id) => (field.owner === proposer ? [id] : []));
    const cash = view.players.find((player) => player.id === proposer)?.cash ?? 0;
    const give: DealSide =
      mine.length > 0
        ? { fields: [mine[0]!], cash: 0 }
        : cash > 0
          ? { fields: [], cash: 1 }
          : { fields: [], cash: 0 };
    if (give.fields.length === 0 && give.cash === 0) return null;
    return {
      type: "ProposeDeal",
      turn,
      recipient: recipient.id,
      give,
      take: { fields: [], cash: 0 },
    };
  }
  const theirs = view.fields.flatMap((field, id) => (field.owner === recipient.id ? [id] : []));
  const take: DealSide =
    theirs.length > 0
      ? { fields: [theirs[0]!], cash: 0 }
      : recipient.cash > 0
        ? { fields: [], cash: 1 }
        : { fields: [], cash: 0 };
  if (take.fields.length === 0 && take.cash === 0) return null;
  return {
    type: "ProposeDeal",
    turn,
    recipient: recipient.id,
    give: { fields: [], cash: 0 },
    take,
  };
}

/**
 * Plays one seeded game with every Decision answered by the Bot policy, with
 * no Turn timeout: the policy must cover every Decision on its own.
 */
export function playBotGame(options: BotGameOptions = {}): Simulation {
  const maxSteps = options.steps ?? 5_000;
  const dealEvery = options.dealEvery ?? 0;

  let state = newGame({
    players: options.players,
    settings: options.settings,
    seed: options.seed,
    now: options.now ?? T0,
  });
  const steps: Step[] = [];
  /** The Turn whose Deal was already put, so the reopened decision cannot propose another. */
  let dealTurn = 0;

  while (state.phase.kind !== "gameOver" && steps.length < maxSteps) {
    const view = publicView(state);
    const proposal =
      dealEvery > 0 && state.turn !== dealTurn && state.turn % dealEvery === 0
        ? dealProposal(view)
        : null;
    const intent = proposal ?? botIntent(view);
    if (!intent) break;
    const now = state.actsAfter;
    const result = apply(state, intent, { actor: state.currentPlayer, now });
    if (isRejection(result)) {
      throw new Error(
        `${intent.type} on Turn ${state.turn} (${state.phase.kind}) was refused: ${result.code}`,
      );
    }
    steps.push({
      before: state,
      after: result.state,
      intent,
      now,
      events: result.events,
    });
    if (proposal) dealTurn = state.turn;
    state = result.state;
  }

  return { state, steps, ended: state.phase.kind === "gameOver" };
}

/** Plays one seeded game, choosing only legal options, until it ends. */
export function playRandomGame(options: SimulationOptions = {}): Simulation {
  const pick = options.pick ?? chooser(options.choiceSeed ?? 1);
  const timeoutEvery = options.timeoutEvery ?? 8;
  const maxSteps = options.steps ?? 1_000;

  let state = newGame({
    players: options.players,
    settings: options.settings,
    seed: options.seed,
    now: options.now ?? T0,
  });
  const steps: Step[] = [];

  while (state.phase.kind !== "gameOver" && steps.length < maxSteps) {
    const move = nextMove(state, pick, timeoutEvery);
    if (!move) break;
    const actor = move.intent.type === "TurnTimedOut" ? SYSTEM : state.currentPlayer;
    const result = apply(state, move.intent, { actor, now: move.now });
    if (isRejection(result)) {
      throw new Error(
        `${move.intent.type} on Turn ${state.turn} (${state.phase.kind}) was refused: ${result.code}`,
      );
    }
    steps.push({
      before: state,
      after: result.state,
      intent: move.intent,
      now: move.now,
      events: result.events,
    });
    state = result.state;
  }

  return { state, steps, ended: state.phase.kind === "gameOver" };
}

/** Cash after one intent, per Player, and the net amount the Bank paid out. */
export type Ledger = {
  /** Positive when the Bank paid the Players; negative when it took money. */
  bank: number;
  cash: Record<PlayerId, number>;
};

/**
 * The cash movements one intent's event list describes. A Bankrupt payer's
 * Charge event reports what they could raise (cash plus the Bank's purchase
 * of their Fields, F12), not the cash they held, so it is clipped to their
 * cash: the difference is the Bank's payout for the returned Fields.
 */
export function ledgerOf(before: GameState, events: readonly GameEvent[]): Ledger {
  const cash: Record<PlayerId, number> = {};
  for (const player of before.players) cash[player.id] = player.cash;
  let bank = 0;

  const move = (player: PlayerId, amount: number): void => {
    cash[player] = (cash[player] ?? 0) + amount;
  };

  for (const event of events) {
    switch (event.type) {
      case "RoundBonusPaid":
      case "ChanceMoneyReceived":
      case "FieldsSold":
        move(event.player, event.amount);
        bank += event.amount;
        break;
      case "LevelBought":
      case "MuseumBought":
        move(event.player, -event.price);
        bank -= event.price;
        break;
      case "PcrTestBought":
        move(event.player, -event.amount);
        bank -= event.amount;
        break;
      case "BoughtOut":
        move(event.player, -event.price);
        move(event.owner, event.price);
        break;
      case "DealAccepted":
        move(event.proposer, event.take.cash - event.give.cash);
        move(event.recipient, event.give.cash - event.take.cash);
        break;
      case "RentPaid": {
        const paid = Math.min(event.amount, cash[event.player] ?? 0);
        move(event.player, -paid);
        move(event.owner, event.amount);
        bank += event.amount - paid;
        break;
      }
      case "ChanceTransferPaid": {
        const paid = Math.min(event.amount, cash[event.player] ?? 0);
        move(event.player, -paid);
        move(event.payee, event.amount);
        bank += event.amount - paid;
        break;
      }
      case "TaxPaid":
      case "ChanceChargePaid":
      case "TimeoutPenaltyPaid": {
        const paid = Math.min(event.amount, cash[event.player] ?? 0);
        move(event.player, -paid);
        bank -= paid;
        break;
      }
      default:
        break;
    }
  }

  return { bank, cash };
}
