import { GAME_CONFIG } from "../gameConfig"

export const calcCoords = (id) => {
  const g = GAME_CONFIG
  const WIDTH_NORMAL = (2 * g.PIECE_HEIGHT + g.PIECE_BOTTOM_HEIGHT) * g.scale
  const HEIGHT_NORMAL = WIDTH_NORMAL / 2
  const WIDTH_CORNER = (3 * g.PIECE_HEIGHT + g.PIECE_BOTTOM_HEIGHT) * g.scale
  const HEIGHT_CORNER = WIDTH_CORNER / 2
  const correctId = id % 32

  if (correctId === 0 || correctId === 32) {
    return {
      x: 0,
      y: HEIGHT_NORMAL * 7 + g.SPACE_Y * 8 + HEIGHT_CORNER
    }
  } else if (correctId === 8) {
    return {
      x: -((WIDTH_NORMAL + g.SPACE_X) * 8 + WIDTH_NORMAL / 2),
      y: (0 - g.SPACE_Y * 2)
    }
  } else if (correctId === 16) {
    return {
      x: 0,
      y: -HEIGHT_NORMAL * 7 - g.SPACE_Y * 12 - HEIGHT_CORNER
    }
  } else if (correctId === 24) {
    return {
      x: ((WIDTH_NORMAL + g.SPACE_X) * 8 + WIDTH_NORMAL / 2),
      y: (0 - g.SPACE_Y * 2)
    }

  } else if (correctId >= 1 && correctId < 9) {
    return {
      x: (-WIDTH_NORMAL - g.SPACE_X) * (correctId),
      y: (HEIGHT_NORMAL * (8 - correctId) + g.SPACE_Y * (8 - correctId))
    }
  } else if (correctId >= 9 && correctId < 17) {
    return {
      x: -((WIDTH_NORMAL + g.SPACE_X) * (7 - (correctId % 9)) + WIDTH_NORMAL / 2),
      y: (-HEIGHT_NORMAL * (2 + (correctId % 9)) - g.SPACE_Y * (1 + (correctId % 9)) + HEIGHT_NORMAL / 2)
    }
  } else if (correctId >= 17 && correctId < 25) {
    return {
      x: ((WIDTH_NORMAL + g.SPACE_X) * (1 + correctId % 17) + WIDTH_NORMAL / 2),
      y: (-HEIGHT_NORMAL * (8 - (correctId % 17)) - g.SPACE_Y * (7 - (correctId % 17)) + HEIGHT_NORMAL / 2)
    }
  } else if (correctId >= 25 && correctId < 32) {
    return {
      x: ((WIDTH_NORMAL + g.SPACE_X) * (7 - (correctId % 25))),
      y: (HEIGHT_NORMAL * ((1 + correctId % 25)) + g.SPACE_Y * (1 + correctId % 25))
    }
  } else return { x: 0, y: 0 }
}