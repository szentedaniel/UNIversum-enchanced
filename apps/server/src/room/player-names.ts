import { PLAYER_NAME_ADJECTIVES, PLAYER_NAME_NOUNS } from "@universum/protocol";
import type { PlayerName } from "@universum/rules";
import { randomInt } from "node:crypto";

function pick<T>(words: readonly T[]): T {
  const word = words[randomInt(words.length)];
  if (word === undefined) throw new Error("no word left to pick");
  return word;
}

/**
 * A Player name from the built-in word lists, sharing neither its adjective
 * nor its noun with a name already in the Room, so names are easy to tell apart.
 */
export function newPlayerName(taken: readonly PlayerName[]): PlayerName {
  const adjectives = PLAYER_NAME_ADJECTIVES.filter((a) => !taken.some((t) => t.adjective === a));
  const nouns = PLAYER_NAME_NOUNS.filter((n) => !taken.some((t) => t.noun === n));
  return { adjective: pick(adjectives), noun: pick(nouns) };
}
