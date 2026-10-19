/**
 * The built-in word lists for Player names. The server picks one adjective and
 * one noun when a Guest takes a Seat and sends only these ids; every client
 * shows them in its own language from its message files (`name_adj_<id>`,
 * `name_noun_<id>` in hu/en/de). In German every noun is masculine, so the
 * adjective always takes the `-er` ending.
 */
export const PLAYER_NAME_ADJECTIVES = [
  "brave",
  "busy",
  "calm",
  "clever",
  "cool",
  "curious",
  "eager",
  "fancy",
  "gentle",
  "happy",
  "jolly",
  "kind",
  "lucky",
  "mighty",
  "nimble",
  "polite",
  "proud",
  "quick",
  "quiet",
  "shy",
  "sleepy",
  "sunny",
  "tiny",
  "wise",
] as const;

export const PLAYER_NAME_NOUNS = [
  "badger",
  "bear",
  "beaver",
  "dolphin",
  "eagle",
  "falcon",
  "fox",
  "frog",
  "hamster",
  "hare",
  "hedgehog",
  "koala",
  "lion",
  "lynx",
  "moose",
  "otter",
  "owl",
  "panda",
  "parrot",
  "penguin",
  "raccoon",
  "raven",
  "tiger",
  "wolf",
] as const;

export type PlayerNameAdjective = (typeof PLAYER_NAME_ADJECTIVES)[number];
export type PlayerNameNoun = (typeof PLAYER_NAME_NOUNS)[number];
