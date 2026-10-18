// PROTOTYPE, throwaway. Board data ported from v1 (client/src/gameConfig.js, config.js,
// Utils/calcCoords.js) so the phone test uses v1's real layout and art, not a lookalike.

export type FieldKind = 'start' | 'quarantine' | 'doubler' | 'erasmus' | 'normal' | 'museum' | 'chance' | 'tax'

export interface FieldDef {
  id: number
  label: string
  kind: FieldKind
  flip: boolean
  groupId: number
  zIndex: number
}

const raw: [number, string, boolean, number, FieldKind, number][] = [
  [0, 'start', false, 0, 'start', -2],
  [1, 'veszprém', false, 1, 'normal', -4],
  [2, 'budapest', false, 1, 'normal', -6],
  [3, 'debrecen', false, 1, 'normal', -8],
  [4, 'museum', false, 0, 'museum', -10],
  [5, 'Zürich', false, 2, 'normal', -12],
  [6, 'Paris', false, 2, 'normal', -14],
  [7, 'edinburgh', false, 2, 'normal', -16],
  [8, 'Karantén', false, 2, 'quarantine', -18],
  [9, 'chicago', true, 3, 'normal', -20],
  [10, 'austin', true, 3, 'normal', -22],
  [11, 'princeton', true, 3, 'normal', -24],
  [12, 'museum', true, 0, 'museum', -26],
  [13, 'vienna', true, 4, 'normal', -28],
  [14, 'esély', true, 0, 'chance', -30],
  [15, 'berlin', true, 4, 'normal', -32],
  [16, 'Talár', false, 0, 'doubler', -34],
  [17, 'seattle', false, 5, 'normal', -32],
  [18, 'esély', false, 0, 'chance', -30],
  [19, 'new haven', false, 5, 'normal', -28],
  [20, 'museum', false, 0, 'museum', -26],
  [21, 'london', false, 6, 'normal', -24],
  [22, 'oxford', false, 6, 'normal', -22],
  [23, 'cambridge uk', false, 6, 'normal', -20],
  [24, 'Erasmus', false, 0, 'erasmus', -18],
  [25, 'esély', true, 0, 'chance', -16],
  [26, 'berkeley', true, 7, 'normal', -14],
  [27, 'new york', true, 7, 'normal', -12],
  [28, 'museum', true, 0, 'museum', -10],
  [29, 'stanford', true, 8, 'normal', -8],
  [30, 'adó', true, 0, 'tax', -6],
  [31, 'cambridge us', true, 8, 'normal', -4],
]

export const FIELDS: FieldDef[] = raw.map(([id, label, flip, groupId, kind, zIndex]) => ({
  id, label, flip, groupId, kind, zIndex,
}))

export const isCorner = (k: FieldKind) => k === 'start' || k === 'quarantine' || k === 'doubler' || k === 'erasmus'

export const GROUP_COLORS: Record<number, number> = {
  1: 0x915537, 2: 0xaddefe, 3: 0xd43b90, 4: 0xf49424,
  5: 0xea1c25, 6: 0xfbf204, 7: 0x1db458, 8: 0x0572bb,
}

export const PLAYER_COLORS = [0xf29db6, 0x8db5e7, 0x70c4a8, 0xffcc00]
export const PLAYER_SPRITES = ['alienPink', 'alienBlue', 'alienGreen', 'alienYellow']

// v1 GAME_CONFIG geometry
export const G = {
  scale: 0.65,
  boardScaleY: 1.1,
  PIECE_HEIGHT: 48,
  PIECE_BOTTOM_HEIGHT: 32,
  SPACE_X: 5,
  SPACE_Y: 2.5,
}
export const WIDTH_NORMAL = (2 * G.PIECE_HEIGHT + G.PIECE_BOTTOM_HEIGHT) * G.scale // 83.2 board px
const HEIGHT_NORMAL = WIDTH_NORMAL / 2
const WIDTH_CORNER = (3 * G.PIECE_HEIGHT + G.PIECE_BOTTOM_HEIGHT) * G.scale
const HEIGHT_CORNER = WIDTH_CORNER / 2

// Straight port of v1 calcCoords (v2 would replace it with fieldToCell + cellToScreen).
export function calcCoords(id: number): { x: number; y: number } {
  const g = G
  const c = id % 32
  const WN = WIDTH_NORMAL, HN = HEIGHT_NORMAL
  if (c === 0) return { x: 0, y: HN * 7 + g.SPACE_Y * 8 + HEIGHT_CORNER }
  if (c === 8) return { x: -((WN + g.SPACE_X) * 8 + WN / 2), y: 0 - g.SPACE_Y * 2 }
  if (c === 16) return { x: 0, y: -HN * 7 - g.SPACE_Y * 12 - HEIGHT_CORNER }
  if (c === 24) return { x: (WN + g.SPACE_X) * 8 + WN / 2, y: 0 - g.SPACE_Y * 2 }
  if (c >= 1 && c < 9) return { x: (-WN - g.SPACE_X) * c, y: HN * (8 - c) + g.SPACE_Y * (8 - c) }
  if (c >= 9 && c < 17)
    return {
      x: -((WN + g.SPACE_X) * (7 - (c % 9)) + WN / 2),
      y: -HN * (2 + (c % 9)) - g.SPACE_Y * (1 + (c % 9)) + HN / 2,
    }
  if (c >= 17 && c < 25)
    return {
      x: (WN + g.SPACE_X) * (1 + (c % 17)) + WN / 2,
      y: -HN * (8 - (c % 17)) - g.SPACE_Y * (7 - (c % 17)) + HN / 2,
    }
  return { x: (WN + g.SPACE_X) * (7 - (c % 25)), y: HN * (1 + (c % 25)) + g.SPACE_Y * (1 + (c % 25)) }
}

// ---- mock game state (static, read-only) ----

export interface PlayerView { name: string; color: number; field: number; money: number }
export interface FieldState { owner: number | null; level: number }

export const MOCK_PLAYERS: PlayerView[] = [
  { name: 'Anna', color: 0, field: 0, money: 1_250_000 },
  { name: 'Bence', color: 1, field: 6, money: 830_000 },
  { name: 'Csilla', color: 2, field: 13, money: 2_100_000 },
  { name: 'Dávid', color: 3, field: 21, money: 410_000 },
]

export const MOCK_FIELDS: Record<number, FieldState> = {
  1: { owner: 0, level: 1 }, 2: { owner: 0, level: 3 }, 3: { owner: 0, level: 2 },
  5: { owner: 1, level: 4 }, 7: { owner: 1, level: 1 },
  9: { owner: 2, level: 2 }, 10: { owner: 2, level: 5 }, 13: { owner: 2, level: 3 },
  17: { owner: 3, level: 1 }, 21: { owner: 3, level: 2 }, 22: { owner: 1, level: 1 },
  26: { owner: 2, level: 4 }, 29: { owner: 0, level: 2 }, 31: { owner: 0, level: 1 },
  4: { owner: 1, level: 0 }, 20: { owner: 3, level: 0 },
}

export const fieldState = (id: number): FieldState => MOCK_FIELDS[id] ?? { owner: null, level: 0 }

export const mockPrice = (id: number) => 60_000 + id * 18_000
export const mockRent = (id: number, level: number) => (level ? Math.round(mockPrice(id) * 0.12 * level) : 0)

export const KIND_NAME: Record<FieldKind, string> = {
  start: 'Start', quarantine: 'Quarantine (corner)', doubler: 'Doubler / Talár (corner)', erasmus: 'Erasmus (corner)',
  normal: 'University', museum: 'Museum', chance: 'Chance', tax: 'Tax',
}

export const compact = new Intl.NumberFormat('en-GB', { notation: 'compact' })
