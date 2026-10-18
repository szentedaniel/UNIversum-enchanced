// PROTOTYPE, throwaway. Direction C · Campus HUD (ticket #16): neutral, quiet, the Board is the hero.
// Lobby list = one command-palette input + dense rows · Lobby = Seats list + settings form + sticky action bar ·
// Game = full-bleed Board with glass HUD clusters in the corners (phone: one top bar) · result = a data table.

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Lock, Minus, Plus, Maximize, X, Search, CornerDownLeft, List, Crown, WifiOff, Hourglass } from 'lucide-react'
import { GROUP_COLORS } from '../board/data'
import { useViewport } from '../shared'
import {
  AUTO_SELL, CASH, CHARGE, GUESTS, LOBBIES, LOBBY, ME, RESULT, SALE_IDS, SHORTFALL, fieldInfo, fieldName, fieldValue, money, mmss, ownedBy,
  players, saleValue, t, useLiveRoom, useSalePick,
} from './model'
import { Token, hexOf, useGameBoard } from './board'
import { type GameProps, type ScreenProps } from './dirs'

const Btn = ({ kind = 'primary', size = 'md', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }) => (
  <button
    {...p}
    className={`inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--radius)-4px)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
      (size === 'sm' ? 'h-9 text-sm ' : 'h-11 text-sm ') + (/\bpx-/.test(className) ? '' : size === 'sm' ? 'px-3' : 'px-4')
    } ${kind === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : kind === 'secondary' ? 'border border-border bg-secondary text-secondary-foreground hover:bg-muted' : 'hover:bg-muted'} ${className}`}
  />
)
const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded border border-border bg-muted px-1.5 font-num text-[11px] text-muted-foreground">{children}</kbd>
const Wordmark = () => <div className="text-sm font-semibold tracking-tight"><span className="text-primary">UNI</span>versum</div>

// ---------------- Lobby list: command palette ----------------
export function LobbyListC({ lang, go }: ScreenProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [noPw, setNoPw] = useState(false)
  const [mins, setMins] = useState<number | null>(null)
  const rows = LOBBIES.filter((l) => (!q || l.code.startsWith(q) || l.name.toLowerCase().includes(q.toLowerCase())) && (!open || l.seats < l.max) && (!noPw || !l.locked) && (!mins || l.minutes === mins))
  const chip = (on: boolean, label: string, fn: () => void) => (
    <button onClick={fn} className={`h-8 rounded-full border px-3 text-xs font-medium ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>{label}</button>
  )
  return (
    <div className="min-h-dvh overflow-auto pb-bar">
      <div className="mx-auto max-w-2xl px-4 pt-6 md:pt-16">
        <div className="flex items-center justify-between"><Wordmark /><Btn kind="secondary" size="sm" onClick={() => go('lobby')}><Plus size={16} />{t(lang, 'createRoom')}</Btn></div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight md:text-3xl">{t(lang, 'lobbyList')}</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (rows[0]) go('lobby') }} className="mt-4 flex h-14 items-center gap-3 rounded-ui border border-border bg-card px-4 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
          <Search size={18} className="text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t(lang, 'joinByCode')} · search`} className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" autoFocus />
          <span className="hidden md:inline"><Kbd>↵</Kbd></span>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {chip(open, 'Open Seats', () => setOpen(!open))}
          {chip(noPw, `No ${t(lang, 'password').toLowerCase()}`, () => setNoPw(!noPw))}
          {[15, 30, 50].map((m) => chip(mins === m, `${m} ${t(lang, 'minutes')}`, () => setMins(mins === m ? null : m)))}
        </div>
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-ui border border-border bg-card">
          {rows.map((l, i) => {
            const full = l.seats >= l.max
            return (
              <li key={l.code}>
                <button disabled={full} onClick={() => go('lobby')} className={`group flex h-14 w-full items-center gap-3 px-4 text-left hover:bg-muted disabled:opacity-45 ${i === 0 ? 'bg-muted/60' : ''}`}>
                  <span className="w-11 font-num text-sm text-muted-foreground">{l.code}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                  {l.locked && <Lock size={14} className="text-muted-foreground" />}
                  <span className="w-12 text-right font-num text-xs text-muted-foreground">{l.minutes}m</span>
                  <span className="flex w-14 items-center justify-end gap-0.5">
                    {Array.from({ length: l.max }, (_, k) => <span key={k} className={`h-1.5 w-2.5 rounded-full ${k < l.seats ? 'bg-foreground' : 'bg-border'}`} />)}
                  </span>
                  <span className="hidden w-16 justify-end text-xs text-primary group-hover:flex md:flex">{full ? t(lang, 'full') : <>{t(lang, 'join')} <CornerDownLeft size={12} className="ml-1" /></>}</span>
                </button>
              </li>
            )
          })}
          {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No Lobby matches. Enter a Room code to join a private Room.</li>}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Rooms whose game has started aren’t listed.</p>
      </div>
    </div>
  )
}

// ---------------- Lobby: Seats list + settings form ----------------
export function LobbyC({ dir, theme, lang, go }: ScreenProps) {
  const [max, setMax] = useState(LOBBY.max)
  const [mins, setMins] = useState(LOBBY.minutes)
  const [locked, setLocked] = useState(LOBBY.locked)
  const seats = LOBBY.seats.slice(0, max)
  const filled = seats.filter(Boolean).length
  return (
    <div className="min-h-dvh overflow-auto pb-[calc(var(--bar)+88px)]">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <Btn kind="ghost" size="sm" onClick={() => go('list')} className="-ml-2"><ChevronLeft size={16} />{t(lang, 'leave')}</Btn>
          <span className="text-muted-foreground">/</span><span className="truncate font-medium">{LOBBY.name}</span>
          <button className="ml-auto inline-flex h-9 items-center gap-2 rounded-[calc(var(--radius)-4px)] border border-border px-3 font-num text-sm hover:bg-muted">{LOBBY.code}<Copy size={14} /></button>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-6 md:grid-cols-[1fr_320px]">
        <section>
          <h2 className="text-sm font-medium text-muted-foreground">{t(lang, 'seats')} · {filled}/{max}</h2>
          <ul className="mt-2 divide-y divide-border rounded-ui border border-border bg-card">
            {seats.map((s, i) => (
              <li key={i} className="flex h-16 items-center gap-3 px-4">
                {s ? <Token dir={dir} theme={theme} p={s.color} size={32} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border font-num text-xs text-muted-foreground">{i + 1}</span>}
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-medium ${s ? '' : 'text-muted-foreground'}`}>{s ? s.name : t(lang, 'openSeat')}</div>
                  {s && <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {s.held ? <><WifiOff size={12} className="text-warning" /><span className="text-warning">{t(lang, 'heldSeat')}</span> <span className="font-num">0:42</span></> : <><span className="h-1.5 w-1.5 rounded-full bg-success" />connected</>}
                  </div>}
                </div>
                {s?.host && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"><Crown size={12} />{t(lang, 'host')}</span>}
                {s?.me && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t(lang, 'you')}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className="self-start rounded-ui border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Settings</h2>
          <label className="mt-4 block text-xs text-muted-foreground">Room name
            <input defaultValue={LOBBY.name} className="mt-1 h-10 w-full rounded-[calc(var(--radius)-4px)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40" />
          </label>
          <div className="mt-4 text-xs text-muted-foreground">{t(lang, 'players')}</div>
          <Seg value={max} options={[2, 3, 4]} onChange={setMax} />
          <div className="mt-4 text-xs text-muted-foreground">{t(lang, 'minuteLimit')}</div>
          <Seg value={mins} options={[15, 30, 50]} onChange={setMins} suffix="m" />
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm">{t(lang, 'password')}</span>
            <button role="switch" aria-checked={locked} onClick={() => setLocked(!locked)} className={`relative h-6 w-11 rounded-full transition-colors ${locked ? 'bg-primary' : 'bg-border'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${locked ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {locked && <input type="password" defaultValue="egyetem" className="mt-2 h-10 w-full rounded-[calc(var(--radius)-4px)] border border-border bg-background px-3 text-sm outline-none" />}
        </section>
      </main>
      <div className="bottom-bar fixed inset-x-0 border-t border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-4xl items-center gap-3 px-4">
          <span className="flex-1 text-sm text-muted-foreground">{filled < max ? `${t(lang, 'waiting')} · ${max - filled}` : 'All Seats taken'}</span>
          <Btn disabled={filled < 2} onClick={() => go('game')}>{t(lang, 'start')}</Btn>
        </div>
      </div>
    </div>
  )
}
function Seg<T extends number>({ value, options, onChange, suffix = '' }: { value: T; options: T[]; onChange: (v: T) => void; suffix?: string }) {
  return (
    <div className="mt-1 grid grid-flow-col gap-1 rounded-[calc(var(--radius)-2px)] bg-muted p-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`h-8 rounded-[calc(var(--radius)-5px)] font-num text-sm ${o === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>{o}{suffix}</button>
      ))}
    </div>
  )
}

// ---------------- Game: full-bleed Board + glass HUD ----------------
export function GameC({ dir, theme, lang, go, mode, result }: GameProps) {
  const vp = useViewport()
  const wide = vp.w >= 768 && !vp.portrait
  const live = useLiveRoom(result)
  const sale = useSalePick(live.turnLeft)
  const obstacle = useRef<HTMLDivElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const g = useGameBoard({
    dir, theme, mode, sale, obstacle,
    fitArea: () => (wide ? { x: 60, y: 30, w: vp.w - 120, h: vp.h - 110 } : { x: 0, y: 96, w: vp.w, h: vp.h - 96 - (mode === 'sale' ? 220 : 180) }),
    fitDeps: [wide, vp.w, vp.h, mode],
  })
  const low = live.turnLeft <= 5
  const ring = (size: number) => {
    const r = size / 2 - 3, c = 2 * Math.PI * r
    return (
      <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0 -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={low ? 'var(--danger)' : 'var(--primary)'} strokeWidth={3} strokeDasharray={c} strokeDashoffset={c * (1 - live.turnLeft / 20)} strokeLinecap="round" />
        </svg>
        <span className={`font-num text-sm font-medium ${low ? 'text-danger' : ''}`}>{Math.ceil(live.turnLeft)}</span>
      </span>
    )
  }
  const card = mode === 'sale'
    ? <SaleTrayC sale={sale} lang={lang} open={listOpen} setOpen={setListOpen} turnLeft={live.turnLeft} />
    : g.sel !== null
      ? <FieldCardC id={g.sel} lang={lang} dir={dir} theme={theme} onPrev={() => g.setSel((g.sel! + 31) % 32)} onNext={() => g.setSel((g.sel! + 1) % 32)} onClose={() => g.setSel(null)} />
      : <div className="glass rounded-full px-4 py-2 text-center text-sm text-muted-foreground">{t(lang, 'inspectHint')}</div>
  const cam = (
    <div className="glass flex flex-col overflow-hidden rounded-ui">
      <button className="flex h-11 w-11 items-center justify-center hover:bg-muted" onClick={() => g.cam.zoom(1.5)} aria-label="zoom in"><Plus size={18} /></button>
      <button className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-muted" onClick={() => g.cam.zoom(1 / 1.5)} aria-label="zoom out"><Minus size={18} /></button>
      <button className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-muted" onClick={g.cam.toFit} aria-label="fit"><Maximize size={16} /></button>
    </div>
  )

  return (
    <div className="board-backdrop fixed inset-0 overflow-hidden">
      {g.board}
      {wide ? (
        <>
          <div className="glass absolute top-4 left-4 w-56 rounded-ui p-1.5">
            {players.map((p, i) => {
              const cur = live.turnPlayer === i
              return (
                <div key={i} className={`flex h-12 items-center gap-2.5 rounded-[calc(var(--radius)-4px)] px-2 ${cur ? 'bg-primary/10' : ''}`}>
                  <Token dir={dir} theme={theme} p={i} size={26} ring={cur ? 'var(--primary)' : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}{i === ME && <span className="text-muted-foreground"> · {t(lang, 'you')}</span>}</div>
                    <div className="font-num text-[11px] text-muted-foreground">{p.fields} {t(lang, 'fields').toLowerCase()} · {money(p.wealth)}</div>
                  </div>
                  <span className="font-num text-sm">{money(p.money)}</span>
                </div>
              )
            })}
          </div>
          <div className="glass absolute top-4 right-4 flex items-center gap-3 rounded-ui px-3 py-2">
            {ring(40)}
            <div>
              <div className="text-xs text-muted-foreground">{t(lang, 'turnOf')} · {players[live.turnPlayer].name}</div>
              <div className="flex items-center gap-1.5 font-num text-sm"><Hourglass size={13} className="text-muted-foreground" />{mmss(live.minuteLeft)}</div>
            </div>
          </div>
          <div className="absolute top-24 right-4">{cam}</div>
          <ol className="bottom-bar absolute left-4 mb-4 flex w-72 flex-col-reverse gap-1">
            {live.events.slice(0, 5).map((e, i) => (
              <li key={e.id} className={`glass flex items-start gap-2 rounded-[calc(var(--radius)-4px)] px-2.5 py-1.5 text-xs ${i === 0 ? 'slide-in' : ''}`} style={{ opacity: 1 - i * 0.18 }}>
                {e.who !== null ? <Token dir={dir} theme={theme} p={e.who} size={16} /> : <span className="w-4" />}
                <span className="leading-4">{e.who !== null && <span className="font-medium">{GUESTS[e.who]} </span>}<span className="text-muted-foreground">{e.text}</span></span>
              </li>
            ))}
          </ol>
          <div ref={obstacle} className="bottom-bar absolute right-4 mb-4 w-[380px]">{card}</div>
        </>
      ) : (
        <>
          <div className="glass absolute inset-x-2 top-[max(8px,env(safe-area-inset-top))] flex items-center gap-1 rounded-ui p-1.5">
            <div className="grid flex-1 grid-cols-4 gap-1">
              {players.map((p, i) => (
                <div key={i} className={`flex min-w-0 items-center gap-1 rounded-[calc(var(--radius)-4px)] px-1 py-1 ${live.turnPlayer === i ? 'bg-primary/10' : ''}`}>
                  <Token dir={dir} theme={theme} p={i} size={20} ring={live.turnPlayer === i ? 'var(--primary)' : undefined} />
                  <span className="font-num text-[12px]">{money(p.money)}</span>
                </div>
              ))}
            </div>
            {ring(36)}
          </div>
          <div className="absolute inset-x-2 top-[64px] flex items-center justify-between gap-2">
            {live.events[0] && (
              <div key={live.events[0].id} className="glass slide-in flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                {live.events[0].who !== null && <Token dir={dir} theme={theme} p={live.events[0].who} size={14} />}
                <span className="truncate text-muted-foreground">{live.events[0].text}</span>
              </div>
            )}
            <span className="glass shrink-0 rounded-full px-2.5 py-1 font-num text-xs">{mmss(live.minuteLeft)}</span>
          </div>
          <div className="absolute top-[104px] right-2">{cam}</div>
          <div ref={obstacle} className="bottom-bar absolute inset-x-2 mb-2">{card}</div>
        </>
      )}
      {result && <ResultC dir={dir} theme={theme} lang={lang} go={go} />}
    </div>
  )
}

function FieldCardC({ id, lang, dir, theme, onPrev, onNext, onClose }: { id: number; lang: GameProps['lang']; dir: GameProps['dir']; theme: GameProps['theme']; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const i = fieldInfo(id)
  const band = GROUP_COLORS[i.f.groupId]
  return (
    <div key={id} className="glass pop-in rounded-ui p-3 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 rounded-full" style={{ background: band ? hexOf(band) : 'var(--border)' }} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold tracking-tight">{fieldName(id)}</div>
          <div className="text-xs text-muted-foreground">{i.kind} · <span className="font-num">#{id}</span></div>
        </div>
        <Btn kind="ghost" size="sm" className="-mt-1 -mr-1 w-9 px-0" onClick={onClose} aria-label="close"><X size={16} /></Btn>
      </div>
      {i.ownable && (
        <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
          {[[t(lang, 'owner'), i.owner ? <span className="inline-flex items-center gap-1"><Token dir={dir} theme={theme} p={i.st.owner!} size={14} />{i.owner.name.split(' ')[1]}</span> : '—'],
            [t(lang, 'level'), i.st.level || '—'], [t(lang, 'rent'), i.rent ? money(i.rent) : '—'], [t(lang, 'value'), money(i.value)]].map(([k, v]) => (
            <div key={k as string} className="min-w-0 rounded-[calc(var(--radius)-6px)] bg-muted/70 px-2 py-1.5">
              <dt className="truncate text-muted-foreground">{k}</dt><dd className="truncate font-num text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 grid grid-cols-[44px_1fr_44px] gap-2">
        <Btn kind="secondary" className="px-0" onClick={onPrev} aria-label="previous Field"><ChevronLeft size={18} /></Btn>
        <Btn disabled>{i.ownable && !i.owner ? `Buy · ${money(i.value)}` : 'Not your Turn to act'}</Btn>
        <Btn kind="secondary" className="px-0" onClick={onNext} aria-label="next Field"><ChevronRight size={18} /></Btn>
      </div>
    </div>
  )
}

function SaleTrayC({ sale, lang, open, setOpen, turnLeft }: { sale: ReturnType<typeof useSalePick>; lang: GameProps['lang']; open: boolean; setOpen: (b: boolean) => void; turnLeft: number }) {
  const pct = Math.min(100, (sale.total / SHORTFALL) * 100)
  return (
    <div className="glass rounded-ui shadow-lg">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t(lang, 'shortfall')} <span className="font-num">{money(SHORTFALL)}</span></div>
          <div className="truncate text-xs text-muted-foreground">{t(lang, 'rent')} <span className="font-num">{money(CHARGE)}</span> · {t(lang, 'cash')} <span className="font-num">{money(CASH)}</span></div>
        </div>
        <span className={`font-num text-lg ${turnLeft <= 5 ? 'text-danger' : 'text-muted-foreground'}`}>{Math.ceil(turnLeft)}s</span>
      </div>
      {open && (
        <ul className="scroll-thin max-h-48 divide-y divide-border overflow-auto">
          {SALE_IDS.map((id) => {
            const on = sale.picked.includes(id)
            return (
              <li key={id}>
                <label className="flex h-11 cursor-pointer items-center gap-3 px-3 text-sm hover:bg-muted">
                  <input type="checkbox" checked={on} onChange={() => sale.toggle(id)} className="h-4 w-4 accent-[var(--primary)]" />
                  <span className="h-3 w-1 rounded-full" style={{ background: hexOf(GROUP_COLORS[fieldInfo(id).f.groupId] ?? 0x888888) }} />
                  <span className="flex-1">{fieldName(id)}</span>
                  {AUTO_SELL.includes(id) && <span className="rounded bg-warning/15 px-1.5 text-[10px] text-warning">auto</span>}
                  <span className="font-num text-xs">{money(saleValue(id))}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="p-3">
        <div className="flex min-h-8 flex-wrap gap-1.5">
          {sale.picked.length === 0 && <span className="self-center text-xs text-muted-foreground">{t(lang, 'pickHint')}</span>}
          {sale.picked.map((id) => (
            <button key={id} onClick={() => sale.toggle(id)} className="inline-flex h-7 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 text-xs text-success">
              {fieldName(id)} <span className="font-num">{money(saleValue(id))}</span><X size={12} />
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-border"><div className={`h-full ${sale.canSell ? 'bg-success' : 'bg-warning'}`} style={{ width: `${pct}%` }} /></div>
          <span className="font-num text-xs text-muted-foreground">{money(sale.total)}/{money(SHORTFALL)}</span>
        </div>
        <div className="mt-3 grid grid-cols-[auto_auto_1fr] gap-2">
          <Btn kind="secondary" className="w-11 px-0" onClick={() => setOpen(!open)} aria-label={t(lang, 'allFields')} aria-pressed={open}><List size={16} /></Btn>
          <Btn kind="secondary" onClick={sale.reset}>{t(lang, 'autoSell')}</Btn>
          <Btn disabled={!sale.canSell} onClick={sale.reset}>{t(lang, 'sell')}{sale.total ? <span className="font-num"> {money(sale.total)}</span> : ''}</Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------- result: a data table ----------------
function ResultC({ dir, theme, lang, go }: ScreenProps) {
  const top = Math.max(...RESULT.map((r) => r.wealth))
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-background/60 backdrop-blur-sm md:items-center pb-bar">
      <div className="pop-in w-full max-w-xl rounded-t-ui border border-border bg-background p-5 shadow-2xl md:rounded-ui">
        <div className="text-xs text-muted-foreground">{t(lang, 'timeUp')}</div>
        <div className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Token dir={dir} theme={theme} p={RESULT[0].p} size={28} />{GUESTS[RESULT[0].p]}</div>
        <div className="text-sm text-muted-foreground">{t(lang, 'winner')} · {t(lang, 'wealth')} <span className="font-num text-foreground">{money(RESULT[0].wealth)}</span></div>
        <table className="mt-5 w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-normal">#</th><th className="font-normal">{t(lang, 'players')}</th><th className="font-normal">{t(lang, 'cash')} + {t(lang, 'fields')}</th><th className="text-right font-normal">{t(lang, 'wealth')}</th></tr></thead>
          <tbody className="divide-y divide-border">
            {RESULT.map((r, i) => {
              const fv = r.bankrupt ? 0 : ownedBy(r.p).reduce((a, id) => a + fieldValue(id), 0)
              return (
                <tr key={r.p} className="h-12">
                  <td className="font-num text-muted-foreground">{i + 1}</td>
                  <td><span className="inline-flex items-center gap-2"><Token dir={dir} theme={theme} p={r.p} size={20} /><span className="max-w-28 truncate">{GUESTS[r.p]}</span></span></td>
                  <td className="w-[40%] pr-3">
                    {r.bankrupt ? <span className="text-xs text-danger">{t(lang, 'bankrupt')}</span> : (
                      <div className="flex h-2 overflow-hidden rounded-full bg-muted" title={`${money(r.cash)} + ${money(fv)}`}>
                        <span className="bg-primary" style={{ width: `${(r.cash / top) * 100}%` }} /><span className="bg-primary/40" style={{ width: `${(fv / top) * 100}%` }} />
                      </div>
                    )}
                  </td>
                  <td className="text-right font-num">{r.bankrupt ? '—' : money(r.wealth)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-5 flex justify-end gap-2"><Btn kind="secondary" onClick={() => go('list')}>{t(lang, 'playAgain')}</Btn></div>
      </div>
    </div>
  )
}
