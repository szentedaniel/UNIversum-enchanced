/**
 * The Seat badge over each pawn: the Player colour with the Seat's shape
 * (● ▲ ■ ★) in ink, like the Player tokens in the DOM, so pawns are told apart
 * without colour. Shapes are drawn, not typeset, so they never depend on a font.
 */
import { Container, Graphics } from "pixi.js";
import { INK, PLAYER_COLORS } from "#board/colors.ts";

const RADIUS = 9;
const BORDER = 2;

/** Draws Seat `seat`'s shape, centred on (0, 0), about `size` across. */
function drawShape(g: Graphics, seat: number, size: number): Graphics {
  const r = size / 2;
  switch (seat) {
    case 0:
      return g.circle(0, 0, r * 0.8);
    case 1:
      return g.poly([0, -r, r * 0.95, r * 0.7, -r * 0.95, r * 0.7]);
    case 2:
      return g.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
    default:
      return g.star(0, 0, 5, r, r * 0.45);
  }
}

export function pawnBadge(seat: number): Container {
  const badge = new Container({ eventMode: "none" });
  badge.addChild(
    new Graphics()
      .circle(0, 0, RADIUS)
      .fill({ color: PLAYER_COLORS[seat] ?? INK })
      .stroke({ width: BORDER, color: INK }),
    drawShape(new Graphics(), seat, RADIUS * 1.1).fill({ color: INK }),
  );
  return badge;
}
