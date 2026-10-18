// PROTOTYPE, throwaway: the three directions' non-CSS tokens (map ticket #16).
// Player colours live here (not in ui.css) so the HTML and the Board's baked houses use the same values.

import type { RenderOptions } from '../board/renderer'

export type Dir = 'a' | 'b' | 'c'
export type Theme = 'light' | 'dark'

export interface DirMeta {
  key: Dir
  name: string
  pitch: string
  players: Record<Theme, string[]>
  /** the cue that isn't colour: Seat numbers, shapes, or initials, shown on every Player token and over the pawns */
  badge: string[]
  badgeName: string
  rings: Record<Theme, { sel: string; picked: string; auto: string }>
}

export const V1_PLAYERS = ['#f29db6', '#8db5e7', '#70c4a8', '#ffcc00']

export const DIRS: Record<Dir, DirMeta> = {
  a: {
    key: 'a', name: 'Yearbook',
    pitch: 'Paper, ink and a serif: a university yearbook / ledger. Ruled tables, side ledger on desktop. Light-first.',
    players: { light: ['#c2457a', '#2f6db5', '#23856b', '#c28a00'], dark: ['#ee8fb4', '#84b3ec', '#6fcfae', '#f5c84a'] },
    badge: ['1', '2', '3', '4'], badgeName: 'Seat number',
    rings: { light: { sel: '#8a1f2d', picked: '#2f6b3a', auto: '#a8651a' }, dark: { sel: '#e4707d', picked: '#74c58a', auto: '#e6a35a' } },
  },
  b: {
    key: 'b', name: 'Tabletop',
    pitch: "v1's sunset purple and cream, grown up: chunky sticker cards, Players pinned to the corners, a toy you play. Dark-first.",
    players: { light: V1_PLAYERS, dark: V1_PLAYERS },
    badge: ['●', '▲', '■', '★'], badgeName: 'shape',
    rings: { light: { sel: '#ff7a1a', picked: '#1f9d6e', auto: '#d6334a' }, dark: { sel: '#ffbb6c', picked: '#5fd38d', auto: '#ff6b6b' } },
  },
  c: {
    key: 'c', name: 'Campus HUD',
    pitch: 'Neutral and quiet, the Board is the hero: full-bleed canvas, glass HUD clusters in the corners, mono numbers. Both themes equal.',
    players: { light: ['#d16ba5', '#3a9be0', '#0f9d76', '#e6a700'], dark: ['#e58bbd', '#63b3ee', '#2fc59a', '#f2bd2c'] },
    badge: ['A', 'B', 'C', 'D'], badgeName: 'initial',
    rings: { light: { sel: '#3b5bfd', picked: '#15803d', auto: '#b45309' }, dark: { sel: '#7c93ff', picked: '#4ade80', auto: '#fbbf24' } },
  },
}

const num = (h: string) => parseInt(h.slice(1), 16)
/** dark ink or white, whichever reads better on the colour */
export const inkOn = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#1a1624' : '#ffffff'
}

export function boardOptions(d: Dir, theme: Theme): RenderOptions {
  const m = DIRS[d]
  const pc = m.players[theme]
  const rc = m.rings[theme]
  return {
    recolor: 'baked', labels: true, walking: true, continuous: false, resolution: Math.min(2, devicePixelRatio),
    playerColors: pc.map(num),
    rings: { sel: num(rc.sel), picked: num(rc.picked), auto: num(rc.auto) },
    badges: { text: m.badge, fill: pc.map(num), ink: pc.map((c) => num(inkOn(c))) },
  }
}

export type Screen = 'list' | 'lobby' | 'game' | 'sale' | 'result' | 'tokens'
export const SCREENS: { key: Screen; name: string }[] = [
  { key: 'list', name: 'Lobby list' },
  { key: 'lobby', name: 'Lobby' },
  { key: 'game', name: 'Game · inspect' },
  { key: 'sale', name: 'Game · Sale pick' },
  { key: 'result', name: 'Game · result' },
  { key: 'tokens', name: 'Tokens & colours' },
]
export interface ScreenProps {
  dir: Dir
  theme: Theme
  lang: import('./model').Lang
  go: (s: Screen) => void
}
export interface GameProps extends ScreenProps { mode: 'inspect' | 'sale'; result: boolean }
