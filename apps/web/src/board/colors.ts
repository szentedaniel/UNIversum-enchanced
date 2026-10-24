import type { FieldKind, GroupId } from "@universum/rules/board";

/** v1's Player colours by Seat, the same in both themes. */
export const PLAYER_COLORS = [0xf29db6, 0x8db5e7, 0x70c4a8, 0xffcc00] as const;

export const INK = 0x2b2238;

/** v1's Group colours. */
export const GROUP_COLORS: Record<GroupId, number> = {
  1: 0x915537,
  2: 0xaddefe,
  3: 0xd43b90,
  4: 0xf49424,
  5: 0xea1c25,
  6: 0xfbf204,
  7: 0x1db458,
  8: 0x0572bb,
};

/** Tile colours for the Fields that have no Group. */
export const KIND_COLORS: Record<FieldKind, number> = {
  start: 0xffd3a1,
  university: 0xfffaf3,
  museum: 0xc7b3c9,
  chance: 0x7ee0c3,
  tax: 0xff9f43,
  quarantine: 0xff6b6b,
  doubler: 0xffbb6c,
  erasmus: 0x8db5e7,
};
