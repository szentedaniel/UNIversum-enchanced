// PROTOTYPE, throwaway. Direction B · Tabletop (ticket #16): v1's sunset purple + cream, chunky sticker cards.
// Lobby list = big tiles + digit boxes · Lobby = four big Seat tiles + chunky toggles · Game = Players pinned to the
// four corners like v1, toasts under a Minute pill (phone: a row of chips) · result = a podium.

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Crown, Lock, Minus, Plus, Maximize, X, ListChecks, Timer, WifiOff } from 'lucide-react'
import { GROUP_COLORS } from '../board/data'
import { useViewport } from '../shared'
import {
  AUTO_SELL, CASH, CHARGE, GUESTS, LOBBIES, LOBBY, ME, RESULT, SALE_IDS, SHORTFALL, fieldInfo, fieldName, money, mmss, players,
  saleValue, t, useLiveRoom, useSalePick, type GameEvent,
} from './model'
import { Token, alien, hexOf, useGameBoard } from './board'
import { DIRS, type GameProps, type ScreenProps } from './dirs'

const Btn = ({ kind = 'primary', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'plain' | 'accent' }) => (
  <button
    {...p}
    className={`sticker-sm press inline-flex min-h-12 items-center justify-center gap-2 rounded-ui ${/\bpx-/.test(className) ? '' : 'px-5'} text-base font-extrabold disabled:opacity-40 disabled:shadow-none ${
      kind === 'primary' ? 'bg-primary text-primary-foreground' : kind === 'accent' ? 'bg-accent text-accent-foreground' : 'bg-card text-card-foreground'
    } ${className}`}
  />
)
const Logo = ({ small }: { small?: boolean }) => (
  <div className={`font-display leading-none tracking-wide text-primary ${small ? 'text-2xl' : 'text-5xl md:text-7xl'}`} style={{ WebkitTextStroke: small ? '1px var(--border)' : '2px var(--border)', textShadow: small ? '2px 2px 0 var(--border)' : '4px 4px 0 var(--border)' }}>
    UNIversum
  </div>
)

// ---------------- Lobby list: big tiles ----------------
export function LobbyListB({ dir, theme, lang, go }: ScreenProps) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const refs = useRef<(HTMLInputElement | null)[]>([])
  return (
    <div className="min-h-dvh overflow-auto pb-bar">
      <header className="mx-auto max-w-6xl px-4 pt-8 text-center md:pt-12">
        <Logo />
        <div className="mx-auto mt-6 flex max-w-2xl flex-col items-stretch gap-3 md:flex-row md:items-center">
          <Btn className="min-h-14 flex-1 text-lg" onClick={() => go('lobby')}><Plus size={22} strokeWidth={3} />{t(lang, 'createRoom')}</Btn>
          <form className="sticker flex items-center justify-center gap-2 rounded-ui bg-card p-2 text-card-foreground" onSubmit={(e) => { e.preventDefault(); go('lobby') }}>
            {digits.map((d, i) => (
              <input
                key={i} ref={(el) => { refs.current[i] = el }} value={d} inputMode="numeric" maxLength={1} aria-label={`Room code digit ${i + 1}`}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '')
                  setDigits((x) => x.map((y, j) => (j === i ? v : y)))
                  if (v && i < 3) refs.current[i + 1]?.focus()
                }}
                className="tnum h-12 w-11 rounded-xl border-[2.5px] border-border bg-background text-center text-2xl font-black text-foreground outline-none focus:bg-secondary"
              />
            ))}
            <Btn kind="accent" className="min-h-12 px-4" disabled={digits.some((d) => !d)}>{t(lang, 'join')}</Btn>
          </form>
        </div>
      </header>
      <main className="mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-4 px-4 pb-6 sm:grid-cols-2 lg:grid-cols-3">
        {LOBBIES.map((l, k) => {
          const full = l.seats >= l.max
          return (
            <div key={l.code} className={`sticker flex flex-col gap-3 rounded-ui bg-card p-4 text-card-foreground ${full ? 'opacity-60' : ''}`} style={{ rotate: `${((k * 37) % 5) - 2}deg` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xl font-black">{l.name}</div>
                  <div className="tnum text-sm font-bold opacity-60">#{l.code}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {l.locked && <span className="sticker-sm flex h-8 w-8 items-center justify-center rounded-full bg-secondary"><Lock size={15} strokeWidth={3} /></span>}
                  <span className="sticker-sm rounded-full bg-secondary px-2.5 py-1 text-sm font-extrabold">{l.minutes}′</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {Array.from({ length: l.max }, (_, i) => (
                  <span key={i} className={`flex h-11 w-11 items-center justify-center rounded-full border-[2.5px] ${i < l.seats ? 'border-border' : 'border-dashed border-current opacity-40'}`} style={i < l.seats ? { background: DIRS[dir].players[theme][i] } : undefined}>
                    {i < l.seats && <img src={alien(i)} alt="" className="h-8" />}
                  </span>
                ))}
                <span className="ml-auto text-sm font-extrabold">{l.seats}/{l.max}</span>
              </div>
              <Btn disabled={full} onClick={() => go('lobby')} className="w-full">{full ? t(lang, 'full') : t(lang, 'join')}</Btn>
            </div>
          )
        })}
      </main>
    </div>
  )
}

// ---------------- Lobby: four big Seats ----------------
export function LobbyB({ dir, theme, lang, go }: ScreenProps) {
  const [max, setMax] = useState(LOBBY.max)
  const [mins, setMins] = useState(LOBBY.minutes)
  const [locked, setLocked] = useState(LOBBY.locked)
  const seats = LOBBY.seats.slice(0, max)
  const filled = seats.filter(Boolean).length
  return (
    <div className="min-h-dvh overflow-auto pb-bar">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-5">
        <button onClick={() => go('list')} className="sticker-sm press rounded-full bg-card px-4 py-2 text-sm font-extrabold text-card-foreground">← {t(lang, 'leave')}</button>
        <Logo small />
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6">
        <div className="text-center">
          <div className="text-3xl font-black md:text-4xl">{LOBBY.name}</div>
          <button className="sticker press mt-3 inline-flex items-center gap-3 rounded-ui bg-card px-5 py-2 text-card-foreground">
            <span className="text-sm font-extrabold opacity-60">Room</span>
            <span className="tnum font-display text-4xl tracking-widest">{LOBBY.code}</span><Copy size={20} strokeWidth={2.5} />
          </button>
        </div>
        {/* Seat cards keep the 4-Seat size whatever the Player count; fewer Seats just centre */}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {seats.map((s, i) => (
            <div key={i} className={`sticker relative flex aspect-[4/5] w-[calc(50%-0.5rem)] flex-col md:w-[calc(25%-0.75rem)] items-center justify-center gap-2 rounded-ui p-3 text-center ${s ? '' : 'border-dashed bg-transparent shadow-none'}`}
              style={s ? { background: DIRS[dir].players[theme][s.color], color: '#2b2238' } : undefined}>
              {s ? (
                <>
                  {s.host && <Crown className="absolute top-2 left-2" size={22} strokeWidth={2.5} fill="#ffcc00" />}
                  <Token dir={dir} theme={theme} p={s.color} size={28} className="absolute top-2 right-2 border-2 border-[#2b2238]" />
                  <img src={alien(s.color)} alt="" className={`h-20 md:h-24 ${s.held ? 'animate-pulse opacity-50 grayscale' : ''}`} />
                  <div className="text-lg leading-tight font-black">{s.name}</div>
                  <div className="text-xs font-extrabold uppercase opacity-70">
                    {s.held ? <span className="inline-flex items-center gap-1"><WifiOff size={12} />{t(lang, 'heldSeat')} 0:42</span> : s.me ? t(lang, 'you') : 'ready'}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-dashed border-current text-4xl font-black opacity-40">?</div>
                  <div className="font-extrabold opacity-60">{t(lang, 'openSeat')}</div>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="sticker mt-8 grid gap-4 rounded-ui bg-card p-4 text-card-foreground md:grid-cols-3">
          <Chunky label={t(lang, 'players')} value={max} options={[2, 3, 4]} onChange={setMax} />
          <Chunky label={t(lang, 'minuteLimit')} value={mins} options={[15, 30, 50]} onChange={setMins} suffix="′" />
          <div>
            <div className="mb-1.5 text-sm font-extrabold uppercase opacity-60">{t(lang, 'password')}</div>
            <button onClick={() => setLocked(!locked)} className={`sticker-sm press relative h-12 w-24 rounded-full ${locked ? 'bg-accent' : 'bg-secondary'}`} aria-pressed={locked}>
              <span className={`sticker-sm absolute top-1 flex h-9 w-9 items-center justify-center rounded-full bg-card transition-all ${locked ? 'left-[52px]' : 'left-1'}`}><Lock size={16} strokeWidth={3} /></span>
            </button>
          </div>
        </div>
        <Btn className="mt-6 mb-6 min-h-16 w-full font-display text-2xl tracking-wide" disabled={filled < 2} onClick={() => go('game')}>{t(lang, 'start')}!</Btn>
      </main>
    </div>
  )
}
function Chunky<T extends number>({ label, value, options, onChange, suffix = '' }: { label: string; value: T; options: T[]; onChange: (v: T) => void; suffix?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-extrabold uppercase opacity-60">{label}</div>
      <div className="flex gap-2">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} className={`sticker-sm press h-12 flex-1 rounded-xl text-lg font-black ${o === value ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}>{o}{suffix}</button>
        ))}
      </div>
    </div>
  )
}

// ---------------- Game: Players in the corners ----------------
export function GameB({ dir, theme, lang, go, mode, result }: GameProps) {
  const vp = useViewport()
  const wide = vp.w >= 768 && !vp.portrait
  const live = useLiveRoom(result)
  const sale = useSalePick(live.turnLeft)
  const obstacle = useRef<HTMLDivElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const g = useGameBoard({
    dir, theme, mode, sale, obstacle,
    fitArea: () => (wide ? { x: 110, y: 110, w: vp.w - 220, h: vp.h - 310 } : { x: 0, y: 196, w: vp.w, h: vp.h - 196 - (mode === 'sale' ? 250 : 200) }),
    fitDeps: [wide, vp.w, vp.h, mode],
  })
  const pc = DIRS[dir].players[theme]
  const corners = ['top-3 left-3', 'top-3 right-3', 'bottom-3 right-3', 'bottom-3 left-3']
  const card = mode === 'sale'
    ? <SaleTrayB sale={sale} lang={lang} open={listOpen} setOpen={setListOpen} turnLeft={live.turnLeft} />
    : g.sel !== null
      ? <FieldCardB id={g.sel} lang={lang} dir={dir} theme={theme} onPrev={() => g.setSel((g.sel! + 31) % 32)} onNext={() => g.setSel((g.sel! + 1) % 32)} onClose={() => g.setSel(null)} />
      : <div className="sticker-sm rounded-full bg-card px-4 py-2 text-center text-sm font-extrabold text-card-foreground">👆 {t(lang, 'inspectHint')}</div>
  const cam = (
    <div className="flex flex-col gap-2">
      {[[() => g.cam.zoom(1.5), <Plus key="p" strokeWidth={3} />, 'zoom in'], [() => g.cam.zoom(1 / 1.5), <Minus key="m" strokeWidth={3} />, 'zoom out'], [g.cam.toFit, <Maximize key="f" size={20} strokeWidth={3} />, 'fit']].map(([fn, icon, label]) => (
        <button key={label as string} onClick={fn as () => void} aria-label={label as string} className="sticker-sm press flex h-12 w-12 items-center justify-center rounded-full bg-card text-card-foreground">{icon as React.ReactNode}</button>
      ))}
    </div>
  )
  const toasts = <Toasts events={live.events} dir={dir} theme={theme} max={1} />
  const minutePill = (
    <div className="sticker-sm inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1 text-card-foreground">
      <Timer size={16} strokeWidth={3} /><span className="tnum text-base font-black">{mmss(live.minuteLeft)}</span>
    </div>
  )

  return (
    <div className="board-backdrop fixed inset-0 overflow-hidden">
      {g.board}
      {wide ? (
        <>
          {players.map((p, i) => {
            const cur = live.turnPlayer === i
            return (
              <div key={i} className={`absolute ${corners[i]} ${i >= 2 ? 'mb-[var(--bar)]' : ''}`}>
                <div className={`sticker flex w-60 items-center gap-3 rounded-ui bg-card p-3 text-card-foreground transition-transform ${cur ? 'scale-105' : ''}`} style={{ borderColor: cur ? 'var(--primary)' : undefined, borderWidth: cur ? 4 : undefined }}>
                  <TimerRing left={cur ? live.turnLeft : 0} color={pc[i]}>
                    <img src={alien(i)} alt="" className="h-9" />
                  </TimerRing>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><Token dir={dir} theme={theme} p={i} size={18} className="border-2 border-[#2b2238]" /><span className="truncate font-black">{p.name}</span></div>
                    <div className="tnum text-2xl leading-tight font-black">{money(p.money)}</div>
                    <div className="text-xs font-bold opacity-60">{p.fields} {t(lang, 'fields')} {i === ME && `· ${t(lang, 'you')}`}</div>
                  </div>
                </div>
              </div>
            )
          })}
          {/* Minute pill + the newest event share one row in the band between the top corner cards, above the Board's fit area */}
          <div className="absolute top-6 left-1/2 flex w-[calc(100%-560px)] -translate-x-1/2 items-center justify-center gap-2">
            {minutePill}
            {toasts}
          </div>
          <div className="absolute top-1/2 right-4 -translate-y-1/2">{cam}</div>
          <div ref={obstacle} className="bottom-bar absolute left-1/2 mb-3 w-[min(440px,calc(100%-560px))] -translate-x-1/2">{card}</div>
        </>
      ) : (
        <>
          <div className="absolute inset-x-2 top-[max(8px,env(safe-area-inset-top))] grid grid-cols-4 gap-1.5">
            {players.map((p, i) => {
              const cur = live.turnPlayer === i
              return (
                <div key={i} className={`sticker-sm flex flex-col items-center rounded-2xl bg-card px-1 py-1.5 text-card-foreground ${cur ? 'outline-[3px] outline-offset-1 outline-primary' : ''}`}>
                  <TimerRing left={cur ? live.turnLeft : 0} color={pc[i]} size={40}>
                    <img src={alien(i)} alt="" className="h-6" />
                  </TimerRing>
                  <div className="mt-0.5 flex max-w-full items-center gap-0.5"><Token dir={dir} theme={theme} p={i} size={13} /><span className="truncate text-[11px] font-extrabold">{p.name.split(' ')[1]}</span></div>
                  <div className="tnum text-sm leading-none font-black">{money(p.money)}</div>
                </div>
              )
            })}
          </div>
          <div className="absolute inset-x-2 top-[118px] flex flex-col items-center gap-1.5">{minutePill}{toasts}</div>
          <div className="absolute top-[200px] right-2">{cam}</div>
          <div ref={obstacle} className="bottom-bar absolute inset-x-2 mb-2">{card}</div>
        </>
      )}
      {result && <PodiumB dir={dir} theme={theme} lang={lang} go={go} />}
    </div>
  )
}

function TimerRing({ left, color, size = 52, children }: { left: number; color: string; size?: number; children: React.ReactNode }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r
  return (
    <span className="relative flex shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#2b2238]" style={{ width: size, height: size, background: color }}>
      {children}
      {left > 0 && (
        <svg className="absolute -inset-[2.5px]" width={size} height={size} style={{ rotate: '-90deg' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={left <= 5 ? 'var(--danger)' : 'var(--primary)'} strokeWidth={5} strokeDasharray={c} strokeDashoffset={c * (1 - left / 20)} strokeLinecap="round" />
        </svg>
      )}
      {left > 0 && <span className="tnum absolute -right-1.5 -bottom-1.5 rounded-full border-2 border-[#2b2238] bg-card px-1 text-[11px] leading-4 font-black text-card-foreground">{Math.ceil(left)}</span>}
    </span>
  )
}

function Toasts({ events, dir, theme, max }: { events: GameEvent[]; dir: GameProps['dir']; theme: GameProps['theme']; max: number }) {
  return (
    <div className="flex min-w-0 max-w-md flex-col items-center gap-1.5">
      {events.slice(0, max).map((e, i) => (
        <div key={e.id} className={`sticker-sm pop-in flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
          e.tone === 'good' ? 'bg-accent text-accent-foreground' : e.tone === 'bad' ? 'bg-[#ffd0d0] text-[#2b2238]' : 'bg-card text-card-foreground'
        }`} style={{ opacity: 1 - i * 0.25 }}>
          {e.who !== null && <Token dir={dir} theme={theme} p={e.who} size={18} className="border-2 border-[#2b2238]" />}
          <span className="truncate">{e.who !== null && <b className="font-black">{GUESTS[e.who].split(' ')[1]} </b>}{e.text}</span>
        </div>
      ))}
    </div>
  )
}

function FieldCardB({ id, lang, dir, theme, onPrev, onNext, onClose }: { id: number; lang: GameProps['lang']; dir: GameProps['dir']; theme: GameProps['theme']; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const i = fieldInfo(id)
  const band = GROUP_COLORS[i.f.groupId]
  return (
    <div key={id} className="sticker pop-in overflow-hidden rounded-ui bg-card text-card-foreground">
      <div className="flex items-center justify-between border-b-[3px] border-border px-4 py-2" style={{ background: band ? hexOf(band) : '#c9bfd0', color: '#2b2238' }}>
        <div>
          <div className="text-xs font-extrabold uppercase opacity-70">{i.kind}</div>
          <div className="font-display text-2xl leading-tight">{fieldName(id)}</div>
        </div>
        <button onClick={onClose} aria-label="close" className="sticker-sm press flex h-9 w-9 items-center justify-center rounded-full bg-card text-card-foreground"><X size={18} strokeWidth={3} /></button>
      </div>
      {i.ownable && (
        <div className="grid grid-cols-3 gap-2 px-4 pt-3 text-center">
          <Stat label={t(lang, 'rent')} value={i.rent ? money(i.rent) : '—'} big />
          <Stat label={t(lang, 'level')} value={i.st.level ? '🏠'.repeat(Math.min(i.st.level, 3)) + (i.st.level > 3 ? `+${i.st.level - 3}` : '') : '—'} />
          <Stat label={t(lang, 'value')} value={money(i.value)} />
        </div>
      )}
      {i.ownable && (
        <div className="mx-4 mt-2 flex items-center justify-center gap-2 rounded-xl bg-secondary/40 py-1.5 text-sm font-extrabold">
          {i.owner ? <><Token dir={dir} theme={theme} p={i.st.owner!} size={20} className="border-2 border-[#2b2238]" />{i.owner.name}</> : t(lang, 'unowned')}
        </div>
      )}
      <div className="grid grid-cols-[48px_1fr_48px] gap-2 p-3">
        <Btn kind="plain" className="px-0" onClick={onPrev} aria-label="previous Field"><ChevronLeft strokeWidth={3} /></Btn>
        <Btn disabled>{i.ownable && !i.owner ? `Buy ${money(i.value)}` : 'Not your Turn to act'}</Btn>
        <Btn kind="plain" className="px-0" onClick={onNext} aria-label="next Field"><ChevronRight strokeWidth={3} /></Btn>
      </div>
    </div>
  )
}
const Stat = ({ label, value, big }: { label: string; value: string; big?: boolean }) => (
  <div className="rounded-xl border-2 border-border/20 py-1"><div className="text-[11px] font-extrabold uppercase opacity-60">{label}</div><div className={`tnum font-black ${big ? 'text-xl' : 'text-base'}`}>{value}</div></div>
)

function SaleTrayB({ sale, lang, open, setOpen, turnLeft }: { sale: ReturnType<typeof useSalePick>; lang: GameProps['lang']; open: boolean; setOpen: (b: boolean) => void; turnLeft: number }) {
  const pct = Math.min(100, (sale.total / SHORTFALL) * 100)
  return (
    <div className="sticker rounded-ui bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-xs font-extrabold uppercase text-danger">{t(lang, 'rent')} {money(CHARGE)} · {t(lang, 'cash')} {money(CASH)}</div>
          <div className="text-lg leading-tight font-black">{t(lang, 'shortfall')}: {money(SHORTFALL)}</div>
        </div>
        <span className={`sticker-sm tnum flex h-12 w-12 items-center justify-center rounded-full text-xl font-black ${turnLeft <= 5 ? 'animate-pulse bg-danger text-white' : 'bg-primary text-primary-foreground'}`}>{Math.ceil(turnLeft)}</span>
      </div>
      <div className="mt-2 h-5 overflow-hidden rounded-full border-[2.5px] border-border bg-background">
        <div className={`h-full transition-all ${sale.canSell ? 'bg-success' : 'bg-warning'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="tnum mt-0.5 text-right text-xs font-extrabold">{money(sale.total)} / {money(SHORTFALL)}</div>
      {open && (
        <div className="scroll-thin mt-2 grid max-h-44 grid-cols-2 gap-1.5 overflow-auto">
          {SALE_IDS.map((id) => {
            const on = sale.picked.includes(id)
            return (
              <button key={id} onClick={() => sale.toggle(id)} className={`sticker-sm flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-sm font-extrabold ${on ? 'bg-success text-white' : 'bg-background text-foreground'}`}>
                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-border" style={{ background: hexOf(GROUP_COLORS[fieldInfo(id).f.groupId] ?? 0x888888) }} />
                <span className="flex-1 truncate">{fieldName(id)}</span>
                {AUTO_SELL.includes(id) && <span className="text-[10px]">⚡</span>}
                <span className="tnum">{money(saleValue(id))}</span>
              </button>
            )
          })}
        </div>
      )}
      {!open && (
        <div className="mt-2 flex min-h-10 flex-wrap gap-1.5">
          {sale.picked.length === 0 && <span className="self-center text-sm font-bold opacity-60">👆 {t(lang, 'pickHint')}</span>}
          {sale.picked.map((id) => (
            <button key={id} onClick={() => sale.toggle(id)} className="sticker-sm inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-1 text-sm font-extrabold text-white">
              {fieldName(id)} {money(saleValue(id))} <X size={14} strokeWidth={3} />
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-[auto_auto_1fr] gap-2">
        <Btn kind="plain" className="px-3" onClick={() => setOpen(!open)} aria-label={t(lang, 'allFields')} aria-pressed={open}><ListChecks size={20} strokeWidth={3} /></Btn>
        <Btn kind="plain" className="px-3 text-sm" onClick={sale.reset}>⚡ {t(lang, 'autoSell')}</Btn>
        <Btn disabled={!sale.canSell} onClick={sale.reset}>{t(lang, 'sell')}!</Btn>
      </div>
    </div>
  )
}

// ---------------- result: a podium ----------------
function PodiumB({ dir, theme, lang, go }: ScreenProps) {
  const pc = DIRS[dir].players[theme]
  const order = [RESULT[1], RESULT[0], RESULT[2]]
  const heights = ['h-24', 'h-36', 'h-16']
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden bg-[#262335e6] p-4 pb-bar">
      {Array.from({ length: 40 }, (_, i) => (
        <span key={i} className="pointer-events-none absolute top-0 h-3 w-2" style={{ left: `${(i * 53) % 100}%`, background: pc[i % 4], animation: `confetti ${3 + (i % 5)}s linear ${-(i % 7)}s infinite` }} />
      ))}
      <div className="font-display text-center text-4xl text-[#ffbb6c] md:text-6xl" style={{ WebkitTextStroke: '2px #14111c', textShadow: '4px 4px 0 #14111c' }}>
        {GUESTS[RESULT[0].p].split(' ')[1]} {lang === 'hu' ? 'nyert!' : lang === 'de' ? 'gewinnt!' : 'wins!'}
      </div>
      <div className="mt-1 text-sm font-bold text-[#fff3e4]/80">{t(lang, 'timeUp')}</div>
      <div className="mt-8 flex items-end gap-2 md:gap-4">
        {order.map((r, k) => (
          <div key={r.p} className="flex w-24 flex-col items-center md:w-36">
            <img src={alien(r.p)} alt="" className="h-14 md:h-20" />
            <div className="mt-1 max-w-full truncate text-sm font-black text-[#fff3e4]">{GUESTS[r.p]}</div>
            <div className="tnum text-lg font-black text-[#ffbb6c]">{money(r.wealth)}</div>
            <div className={`sticker mt-1 flex w-full items-start justify-center rounded-t-ui pt-2 font-display text-3xl text-[#2b2238] ${heights[k]}`} style={{ background: pc[r.p] }}>
              {k === 1 ? 1 : k === 0 ? 2 : 3}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm font-bold text-[#fff3e4]/70">
        <img src={alien(RESULT[3].p)} alt="" className="h-6 opacity-50 grayscale" />{GUESTS[RESULT[3].p]} · {t(lang, 'bankrupt')}
      </div>
      <Btn className="mt-6" onClick={() => go('list')}>{t(lang, 'playAgain')}</Btn>
    </div>
  )
}
