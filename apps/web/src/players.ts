/**
 * How each Seat looks (spec: Client → Player colours): v1's four colours, the
 * same in both themes, ink on top of them, a required shape so Players are
 * told apart without colour, and v1's alien figure. Screens use `playerLook`;
 * the Board's numeric copies are in `board/colors.ts` (a test keeps them equal).
 */
import alienBlue from "#assets/images/moreenemiesanimations/Alien sprites/alienBlue.png";
import alienGreen from "#assets/images/moreenemiesanimations/Alien sprites/alienGreen.png";
import alienPink from "#assets/images/moreenemiesanimations/Alien sprites/alienPink.png";
import alienYellow from "#assets/images/moreenemiesanimations/Alien sprites/alienYellow.png";

/** The ink on Player colours and on cream surfaces. */
export const INK = "#2b2238";

export type PlayerLook = {
  /** The Player colour, `#rrggbb`. */
  color: string;
  /** The shape shown on every Player token and over the pawn. */
  shape: string;
  /** The alien figure's image URL. */
  figure: string;
};

const LOOKS: readonly PlayerLook[] = [
  { color: "#f29db6", shape: "●", figure: alienPink },
  { color: "#8db5e7", shape: "▲", figure: alienBlue },
  { color: "#70c4a8", shape: "■", figure: alienGreen },
  { color: "#ffcc00", shape: "★", figure: alienYellow },
];

/** The look of a Seat (0–3, join order). */
export function playerLook(seat: number): PlayerLook {
  const look = LOOKS[seat];
  if (!look) throw new RangeError(`no Seat ${seat}`);
  return look;
}
