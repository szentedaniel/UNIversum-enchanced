import type { RoomIntent } from "@universum/protocol/messages";
import type { PlayerId, PlayerView, Standing } from "@universum/rules";

/** One Player on the result screen, with their place (1 is the winner). */
export type PodiumEntry = { player: PlayerView; place: number };

/**
 * The result screen's ranking (R80): the server's standings order (the winner
 * first, then by Wealth, the Bankrupt last), looked up in the view's Players
 * for their figure, name and colour. The client holds no rule logic.
 */
export function podiumOrder(
  players: readonly PlayerView[],
  standings: readonly Standing[],
): PodiumEntry[] {
  const byId = new Map(players.map((player) => [player.id, player]));
  return standings.flatMap((standing, index) => {
    const player = byId.get(standing.player);
    return player ? [{ player, place: index + 1 }] : [];
  });
}

/** The two Room intents a rematch vote sends (ticket #223). */
export type RematchIntent = Extract<RoomIntent, { type: "Rematch" | "WithdrawRematch" }>;

/** One Guest's vote as the result screen's chip shows it. */
export type RematchVote = { player: PlayerView; agreed: boolean };

/** The result screen's rematch vote: a chip per Guest and this client's button. */
export type PodiumRematch = {
  /** One chip per Guest in Seat order; a Bot cannot vote (GLOSSARY: Rematch vote). */
  votes: readonly RematchVote[];
  /** This client's button, or `null` when they hold no Seat. */
  mine: { agreed: boolean; intent: RematchIntent } | null;
};

/**
 * The result screen's rematch vote (spec #175, stories 1–3): the votes the
 * push carries, as one chip per Guest, and this client's own vote with the
 * intent its button sends. The server owns the vote list; an absent one (an
 * older push) reads as every Guest waiting.
 */
export function podiumRematch(
  players: readonly PlayerView[],
  me: PlayerId | null,
  agreed: readonly PlayerId[] | undefined,
): PodiumRematch {
  const votes = new Set(agreed ?? []);
  const seat = players.find((player) => player.id === me);
  const agreedMine = seat !== undefined && votes.has(seat.id);
  return {
    votes: players
      .filter((player) => !player.bot)
      .map((player) => ({ player, agreed: votes.has(player.id) })),
    mine:
      seat === undefined
        ? null
        : {
            agreed: agreedMine,
            intent: agreedMine ? { type: "WithdrawRematch" } : { type: "Rematch" },
          },
  };
}
