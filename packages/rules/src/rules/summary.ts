/**
 * The end-of-game summary counters (spec #177, ticket #235): the biggest Rent
 * paid, the Fields each Player bought, the Monopolies formed and the
 * Bankruptcies. The engine keeps them in `GameState.summary` while the game
 * runs, so the result screen needs no event log at the end (spec decision 4);
 * `summaryOf` folds a finished game's events into the same record, which is
 * how the tests prove the counters and the events agree.
 *
 * Only the events that buy a Field count as a purchase: `LevelBought` on an
 * unowned Field, `BoughtOut` and `MuseumBought`. A Deal moves Fields between
 * Players and a Bankruptcy hands them back to the Bank, so neither is a
 * purchase, and a build on a Field the Player already owns is not one either.
 *
 * A Monopoly has no event of its own: it is recorded when a purchase, a
 * Buyout or an accepted Deal completes a Group (R29), and never twice for the
 * same change of owner. The figure counts formations, not the Groups a Player
 * holds at the end: a Group lost to a Deal and completed again is a second
 * formation, so the result screen shows that part of the game's story.
 */
import { FIELDS, type FieldId, type GroupId } from "#board.ts";
import type { GameEvent } from "#events.ts";
import { ownsGroup } from "#rules/pricing.ts";
import type { PlayerId } from "#state.ts";

/** The biggest Rent paid so far (R56), with the Field it was paid on. */
export type BiggestRent = {
  payer: PlayerId;
  owner: PlayerId;
  field: FieldId;
  amount: number;
};

/** One Monopoly formed while the game ran: the Player and the Group (R29). */
export type MonopolyFormed = { player: PlayerId; group: GroupId };

/**
 * The four summary figures (spec #177). Plain JSON: a Player who bought no
 * Field is absent from `fieldsBought`, and there is no Rent until one is paid.
 */
export type GameSummary = {
  biggestRent: BiggestRent | null;
  /** How many Fields each Player bought. */
  fieldsBought: Record<PlayerId, number>;
  /** The Monopolies formed, in the order they were completed. */
  monopolies: MonopolyFormed[];
  /** The Bankrupt Players, in the order they went Bankrupt (R70). */
  bankruptcies: PlayerId[];
};

/** The counters a game starts with: nothing has happened yet. */
export function emptySummary(): GameSummary {
  return { biggestRent: null, fieldsBought: {}, monopolies: [], bankruptcies: [] };
}

/** Records one Field the Player bought (R50, R52, R53). */
export function recordPurchase(counters: GameSummary, player: PlayerId): void {
  counters.fieldsBought[player] = (counters.fieldsBought[player] ?? 0) + 1;
}

/** Records a Rent payment when it is the biggest so far; an equal one keeps the earlier (R56). */
export function recordRent(counters: GameSummary, rent: BiggestRent): void {
  if (counters.biggestRent === null || rent.amount > counters.biggestRent.amount) {
    counters.biggestRent = rent;
  }
}

/**
 * Records one Monopoly per Group among `fields` that `player` now owns
 * entirely (R29). `fields` are the ones the Player just gained, and `ownerOf`
 * is the owner of each Field after the gain, so a build on a Field the Player
 * already held passes nothing and records nothing. A Group completes only when
 * one of its Fields changes owner, and it changes once here, so one change
 * records at most one Monopoly per Group.
 */
export function recordMonopolies(
  counters: GameSummary,
  ownerOf: (field: FieldId) => PlayerId | null,
  player: PlayerId,
  fields: readonly FieldId[],
): void {
  const groups = new Set<GroupId>();
  for (const field of fields) {
    const group = FIELDS[field]?.group;
    if (group && ownsGroup(ownerOf, group, player)) groups.add(group);
  }
  for (const group of groups) counters.monopolies.push({ player, group });
}

/** Records a Bankruptcy, in the order it happened (R70). */
export function recordBankruptcy(counters: GameSummary, player: PlayerId): void {
  counters.bankruptcies.push(player);
}

/**
 * Folds a game's whole event list into the summary figures (spec decision 4).
 * It tracks who owns each Field from the events themselves, so it needs the
 * events from the game's start: a Field is unowned until an event gives it
 * away, and `FieldsSold`/`WentBankrupt` put it back at the Bank.
 */
export function summaryOf(events: Iterable<GameEvent>): GameSummary {
  const counters = emptySummary();
  const owners: (PlayerId | null)[] = FIELDS.map(() => null);
  const ownerOf = (field: FieldId): PlayerId | null => owners[field] ?? null;
  /** Takes `field` for `player` as a purchase, with any Group it completes. */
  const buys = (field: FieldId, player: PlayerId): void => {
    owners[field] = player;
    recordPurchase(counters, player);
    // A Museum has no Group, so this records nothing for `MuseumBought`.
    recordMonopolies(counters, ownerOf, player, [field]);
  };

  for (const event of events) {
    switch (event.type) {
      case "RentPaid":
        recordRent(counters, {
          payer: event.player,
          owner: event.owner,
          field: event.field,
          amount: event.amount,
        });
        break;
      case "LevelBought":
        if (ownerOf(event.field) === null) buys(event.field, event.player);
        else owners[event.field] = event.player; // A build on an owned Field buys nothing.
        break;
      case "BoughtOut":
        buys(event.field, event.player);
        break;
      case "MuseumBought":
        buys(event.field, event.player);
        break;
      case "DealAccepted":
        for (const field of event.give.fields) owners[field] = event.recipient;
        for (const field of event.take.fields) owners[field] = event.proposer;
        recordMonopolies(counters, ownerOf, event.recipient, event.give.fields);
        recordMonopolies(counters, ownerOf, event.proposer, event.take.fields);
        break;
      case "FieldsSold":
        for (const field of event.fields) owners[field] = null;
        break;
      case "WentBankrupt":
        for (const field of event.fields) owners[field] = null;
        recordBankruptcy(counters, event.player);
        break;
    }
  }
  return counters;
}
