// PROTOTYPE, throwaway: mock state for the UI visual direction prototype (map ticket #16).
// Everything here is read-only mock data plus timers; nothing is sent anywhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Mark } from '../board/renderer'
import { FIELDS, KIND_NAME, MOCK_PLAYERS, fieldState, mockPrice, mockRent, compact } from '../board/data'

export type Lang = 'en' | 'hu' | 'de'

// ---------- a handful of real strings in all three languages, to see text length in each layout ----------
const S = {
  lobbyList: { en: 'Lobby list', hu: 'Váróterem-lista', de: 'Lobbyliste' },
  createRoom: { en: 'Create Room', hu: 'Szoba létrehozása', de: 'Raum erstellen' },
  joinByCode: { en: 'Join with Room code', hu: 'Csatlakozás szobakóddal', de: 'Mit Raumcode beitreten' },
  join: { en: 'Join', hu: 'Belépés', de: 'Beitreten' },
  full: { en: 'Full', hu: 'Tele', de: 'Voll' },
  seats: { en: 'Seats', hu: 'Helyek', de: 'Plätze' },
  minutes: { en: 'min', hu: 'perc', de: 'Min.' },
  minuteLimit: { en: 'Minute limit', hu: 'Időkorlát', de: 'Zeitlimit' },
  password: { en: 'Password', hu: 'Jelszó', de: 'Passwort' },
  players: { en: 'Players', hu: 'Játékosok', de: 'Spieler' },
  start: { en: 'Start game', hu: 'Játék indítása', de: 'Spiel starten' },
  waiting: { en: 'Waiting for players', hu: 'Várakozás a játékosokra', de: 'Warten auf Spieler' },
  openSeat: { en: 'Open Seat', hu: 'Szabad hely', de: 'Freier Platz' },
  heldSeat: { en: 'Reconnecting…', hu: 'Újracsatlakozik…', de: 'Verbindet neu…' },
  host: { en: 'Host', hu: 'Házigazda', de: 'Gastgeber' },
  you: { en: 'you', hu: 'te', de: 'du' },
  leave: { en: 'Leave', hu: 'Kilépés', de: 'Verlassen' },
  turnOf: { en: 'Turn', hu: 'Kör', de: 'Zug' },
  yourTurn: { en: 'Your Turn', hu: 'Te jössz', de: 'Du bist dran' },
  roll: { en: 'Roll', hu: 'Dobás', de: 'Würfeln' },
  rent: { en: 'Rent', hu: 'Bérleti díj', de: 'Miete' },
  value: { en: 'Value', hu: 'Érték', de: 'Wert' },
  level: { en: 'Level', hu: 'Szint', de: 'Stufe' },
  owner: { en: 'Owner', hu: 'Tulajdonos', de: 'Besitzer' },
  unowned: { en: 'Unowned', hu: 'Szabad', de: 'Frei' },
  sell: { en: 'Sell', hu: 'Eladás', de: 'Verkaufen' },
  autoSell: { en: 'Auto-sell', hu: 'Automatikus eladás', de: 'Automatisch verkaufen' },
  shortfall: { en: 'Shortfall', hu: 'Hiány', de: 'Fehlbetrag' },
  pickHint: { en: 'Tap your Fields to pick them', hu: 'Koppints a mezőidre a kijelöléshez', de: 'Tippe deine Felder an, um sie zu wählen' },
  allFields: { en: 'All your Fields', hu: 'Összes meződ', de: 'Alle deine Felder' },
  events: { en: 'Events', hu: 'Események', de: 'Ereignisse' },
  wealth: { en: 'Wealth', hu: 'Vagyon', de: 'Vermögen' },
  cash: { en: 'Cash', hu: 'Készpénz', de: 'Bargeld' },
  fields: { en: 'Fields', hu: 'Mezők', de: 'Felder' },
  winner: { en: 'Winner', hu: 'Győztes', de: 'Sieger' },
  bankrupt: { en: 'Bankrupt', hu: 'Csődbe ment', de: 'Bankrott' },
  timeUp: { en: 'The Minute limit ran out', hu: 'Lejárt az időkorlát', de: 'Das Zeitlimit ist abgelaufen' },
  playAgain: { en: 'Back to the Lobby list', hu: 'Vissza a listához', de: 'Zurück zur Lobbyliste' },
  inspectHint: { en: 'Tap a Field to inspect it', hu: 'Koppints egy mezőre a részletekért', de: 'Tippe auf ein Feld für Details' },
}
export type StrKey = keyof typeof S
export const t = (lang: Lang, k: StrKey) => S[k][lang]

// ---------- Guests: v1 generates "Adjective Animal" names ----------
export const GUESTS = ['Agile Otter', 'Brave Heron', 'Calm Lynx', 'Daring Wren']
export const ME = 0

export interface LobbyRow { code: string; name: string; seats: number; max: number; minutes: number; locked: boolean; players: string[] }
export const LOBBIES: LobbyRow[] = [
  { code: '4821', name: 'Esti kör', seats: 3, max: 4, minutes: 30, locked: false, players: ['Brave Heron', 'Calm Lynx', 'Daring Wren'] },
  { code: '1307', name: 'Erasmus crew', seats: 1, max: 4, minutes: 15, locked: false, players: ['Eager Moose'] },
  { code: '5590', name: 'Nur Freunde', seats: 2, max: 3, minutes: 50, locked: true, players: ['Fancy Koala', 'Gentle Yak'] },
  { code: '2246', name: 'Gyors 15 perc', seats: 2, max: 2, minutes: 15, locked: false, players: ['Happy Ibis', 'Icy Newt'] },
  { code: '8812', name: 'Vizsgaidőszak után', seats: 1, max: 4, minutes: 30, locked: false, players: ['Jolly Mole'] },
  { code: '3075', name: 'Lernpause', seats: 3, max: 4, minutes: 50, locked: true, players: ['Keen Puma', 'Lucky Seal', 'Merry Crow'] },
  { code: '6418', name: 'Friday night', seats: 2, max: 4, minutes: 30, locked: false, players: ['Noble Hawk', 'Odd Lemur'] },
  { code: '9930', name: 'BME vs ELTE', seats: 4, max: 4, minutes: 30, locked: false, players: ['Proud Owl', 'Quick Hare', 'Rare Tapir', 'Shy Gecko'] },
]

export type SeatView = { name: string; color: number; host?: boolean; me?: boolean; held?: boolean } | null
export const LOBBY = {
  code: '4821', name: 'Esti kör', max: 4, minutes: 30, locked: true,
  seats: [
    { name: GUESTS[0], color: 0, me: true, host: true },
    { name: GUESTS[1], color: 1 },
    { name: GUESTS[2], color: 2, held: true },
    null,
  ] as SeatView[],
}

// ---------- game ----------
export const TURN_S = 20
export const MINUTES = 30
export const ROUND_BONUS = 250_000

export const fieldName = (id: number) => (FIELDS[id].kind === 'museum' ? `Museum ${id}` : FIELDS[id].label.replace(/(^|\s)\S/g, (c) => c.toUpperCase()))
export const fieldValue = (id: number) => (FIELDS[id].kind === 'museum' ? 400_000 : mockPrice(id) * Math.max(1, fieldState(id).level))
export const ownedBy = (p: number) => FIELDS.filter((f) => fieldState(f.id).owner === p && (f.kind === 'normal' || f.kind === 'museum')).map((f) => f.id)
export const players = MOCK_PLAYERS.map((p, i) => ({
  ...p, name: GUESTS[i], fields: ownedBy(i).length, wealth: p.money + ownedBy(i).reduce((a, id) => a + fieldValue(id), 0),
}))
export type GamePlayer = (typeof players)[number]
export const money = (n: number) => compact.format(n)
export const fullMoney = (n: number) => new Intl.NumberFormat('en-GB').format(n)
export const fieldInfo = (id: number) => {
  const f = FIELDS[id], st = fieldState(id)
  return {
    f, st, kind: KIND_NAME[f.kind], ownable: f.kind === 'normal' || f.kind === 'museum',
    owner: st.owner === null ? null : players[st.owner], rent: mockRent(id, st.level), value: fieldValue(id),
  }
}

// Sale for a Shortfall (same numbers as the Field-picking prototype): Rent 1.67M, cash 1.25M
export const CASH = players[ME].money
export const CHARGE = 1_670_000
export const SHORTFALL = CHARGE - CASH
export const saleValue = (id: number) => Math.round((fieldValue(id) * 0.9) / 1000) * 1000
export const SALE_IDS = ownedBy(ME).sort((a, b) => saleValue(a) - saleValue(b))
export const AUTO_SELL = (() => {
  const out: number[] = []
  let tot = 0
  for (const id of SALE_IDS) { if (tot >= SHORTFALL) break; out.push(id); tot += saleValue(id) }
  return out
})()

export interface GameEvent { id: number; who: number | null; text: string; tone?: 'good' | 'bad' | 'info' }
const EVENT_POOL: Omit<GameEvent, 'id'>[] = [
  { who: 1, text: 'paid 96K Rent to Calm Lynx at Paris', tone: 'bad' },
  { who: 2, text: 'built Level 3 at Vienna', tone: 'info' },
  { who: 3, text: 'drew a Chance card', tone: 'info' },
  { who: 0, text: 'rolled 4 + 3', tone: 'info' },
  { who: 1, text: `passed Start: +${money(ROUND_BONUS)} Round bonus`, tone: 'good' },
  { who: 3, text: 'went to Quarantine', tone: 'bad' },
  { who: 2, text: 'bought Berkeley for 528K', tone: 'info' },
  { who: 0, text: 'put the Doubler on Budapest', tone: 'good' },
  { who: null, text: 'Calm Lynx reconnected', tone: 'info' },
  { who: 3, text: 'ran out of Turn time: 50K timeout penalty', tone: 'bad' },
]

/** Turn timer, Minute limit and a stream of events, ticking like a live Room. */
export function useLiveRoom(paused = false) {
  const [now, setNow] = useState(() => performance.now())
  const t0 = useRef(performance.now())
  const [events, setEvents] = useState<GameEvent[]>(() => EVENT_POOL.slice(0, 4).map((e, i) => ({ ...e, id: i })).reverse())
  const n = useRef(4)
  useEffect(() => {
    if (paused) return
    const a = setInterval(() => setNow(performance.now()), 200)
    const b = setInterval(() => {
      const e = EVENT_POOL[n.current % EVENT_POOL.length]
      setEvents((xs) => [{ ...e, id: n.current++ }, ...xs].slice(0, 30))
    }, 4500)
    return () => { clearInterval(a); clearInterval(b) }
  }, [paused])
  const el = (now - t0.current) / 1000
  const turnLeft = TURN_S - (el % TURN_S)
  const minuteLeft = MINUTES * 60 - 6 * 60 - 19 - el // ~23:41 left
  return { turnLeft, minuteLeft, events, turnPlayer: 0 }
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The Sale pick from ticket #15: tap toggles, tray chips + Shortfall meter, Auto-sell rings in the last 5 s. */
export function useSalePick(turnLeft: number) {
  const [picked, setPicked] = useState<number[]>([])
  const total = picked.reduce((a, id) => a + saleValue(id), 0)
  const canSell = total >= SHORTFALL
  const toggle = (id: number) => { if (SALE_IDS.includes(id)) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])) }
  const warn = turnLeft <= 5 && !canSell
  const marks = useMemo(() => {
    const m: Record<number, Mark> = {}
    for (const f of FIELDS) {
      if (!SALE_IDS.includes(f.id)) m[f.id] = 'off'
      else if (picked.includes(f.id)) m[f.id] = 'picked'
      else if (warn && AUTO_SELL.includes(f.id)) m[f.id] = 'auto'
    }
    return m
  }, [picked, warn])
  return { picked, total, canSell, toggle, marks, warn, reset: () => setPicked([]) }
}
export type SalePick = ReturnType<typeof useSalePick>

export const RESULT = [
  { p: 2, wealth: players[2].wealth, cash: players[2].money },
  { p: 0, wealth: players[0].wealth, cash: players[0].money },
  { p: 1, wealth: players[1].wealth, cash: players[1].money },
  { p: 3, wealth: 0, cash: 0, bankrupt: true },
]

// ---------- colour-vision maths: Machado et al. 2009 (severity 1), in linear RGB, distance in OKLab ----------
export type Cvd = 'none' | 'protan' | 'deutan' | 'tritan' | 'achroma'
export const CVD_MATRIX: Record<Exclude<Cvd, 'none'>, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  achroma: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const rgb = (hex: string) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
function oklab([r, g, b]: number[]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
export function simulate(hex: string, cvd: Cvd) {
  const c = rgb(hex)
  if (cvd === 'none') return c
  const M = CVD_MATRIX[cvd]
  return [0, 1, 2].map((i) => Math.min(1, Math.max(0, M[i * 3] * c[0] + M[i * 3 + 1] * c[1] + M[i * 3 + 2] * c[2])))
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('')
export const simulateHex = (hex: string, cvd: Cvd) => toHex(simulate(hex, cvd))
/** smallest OKLab distance between any two colours (×100; <10 is hard to tell apart at a glance, <5 is a clash) */
export function minDistance(hexes: string[], cvd: Cvd) {
  const labs = hexes.map((h) => oklab(simulate(h, cvd)))
  let min = Infinity, pair: [number, number] = [0, 0]
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const d = Math.hypot(labs[i][0] - labs[j][0], labs[i][1] - labs[j][1], labs[i][2] - labs[j][2]) * 100
    if (d < min) { min = d; pair = [i, j] }
  }
  return { min, pair }
}
/** WCAG contrast ratio */
export function contrast(a: string, b: string) {
  const L = (h: string) => { const [r, g, bl] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
