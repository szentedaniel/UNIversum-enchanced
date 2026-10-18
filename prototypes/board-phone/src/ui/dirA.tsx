// PROTOTYPE, throwaway. Direction A · Yearbook (ticket #16): paper, ink and a serif.
// Lobby list = a course catalogue table · Lobby = a seminar table + syllabus · Game = Board + a ruled side ledger
// (phone: Player strip on top, card at the bottom) · result = a diploma.

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Lock, LockOpen, Minus, Plus, Maximize, X, ChevronUp, ChevronDown } from 'lucide-react'
import { GROUP_COLORS } from '../board/data'
import { useViewport } from '../shared'
import {
  AUTO_SELL, CASH, CHARGE, GUESTS, LOBBIES, LOBBY, ME, RESULT, SALE_IDS, SHORTFALL, fieldInfo, fieldName, money, mmss, players,
  saleValue, t, useLiveRoom, useSalePick,
} from './model'
import { Token, alien, hexOf, useGameBoard } from './board'
import { DIRS, type GameProps, type ScreenProps } from './dirs'

const Btn = ({ kind = 'primary', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'outline' }) => (
  <button
    {...p}
    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-ui ${/\bpx-/.test(className) ? '' : 'px-4'} text-sm font-semibold tracking-wide disabled:opacity-40 ${
      kind === 'primary' ? 'bg-primary text-primary-foreground hover:brightness-110'
        : kind === 'outline' ? 'border border-foreground/70 hover:bg-secondary' : 'hover:bg-secondary'
    } ${className}`}
  />
)

// ---------------- Lobby list: a course catalogue ----------------
export function LobbyListA({ lang, go }: ScreenProps) {
  const [code, setCode] = useState('')
  return (
    <div className="min-h-dvh overflow-auto pb-bar">
      <header className="mx-auto max-w-5xl px-4 pt-6 md:pt-12">
        <div className="smallcaps text-xs text-muted-foreground">UNIversum · Est. 2022 · hu / en / de</div>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-foreground pb-3">
          <h1 className="font-display text-4xl font-semibold italic md:text-6xl">{t(lang, 'lobbyList')}</h1>
          <Btn onClick={() => go('lobby')}>{t(lang, 'createRoom')}</Btn>
        </div>
        <form className="mt-3 flex flex-wrap items-center gap-2 border-b border-border pb-3" onSubmit={(e) => { e.preventDefault(); go('lobby') }}>
          <label className="smallcaps text-sm text-muted-foreground" htmlFor="a-code">{t(lang, 'joinByCode')}</label>
          <input
            id="a-code" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="0000"
            className="tnum h-11 w-24 rounded-ui border border-border bg-card px-3 text-center font-display text-xl tracking-[0.3em] outline-none focus:border-primary"
          />
          <Btn kind="outline" disabled={code.length < 4}>{t(lang, 'join')}</Btn>
        </form>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        {/* desktop: a real table */}
        <table className="mt-2 hidden w-full border-collapse md:table">
          <thead>
            <tr className="smallcaps border-b border-foreground text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">No.</th><th className="font-normal">Room</th><th className="font-normal">{t(lang, 'seats')}</th>
              <th className="font-normal">{t(lang, 'minuteLimit')}</th><th />
            </tr>
          </thead>
          <tbody>
            {LOBBIES.map((l) => {
              const full = l.seats >= l.max
              return (
                <tr key={l.code} className="border-b border-border hover:bg-card">
                  <td className="tnum py-3 font-display text-lg text-muted-foreground">{l.code}</td>
                  <td>
                    <div className="font-display text-xl">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{l.players.join(' · ')}</div>
                  </td>
                  <td><Pips n={l.seats} max={l.max} /></td>
                  <td className="tnum">{l.minutes} {t(lang, 'minutes')}</td>
                  <td className="text-right">
                    <span className="mr-3 inline-flex text-muted-foreground">{l.locked ? <Lock size={16} aria-label={t(lang, 'password')} /> : null}</span>
                    <Btn kind="outline" disabled={full} onClick={() => go('lobby')}>{full ? t(lang, 'full') : t(lang, 'join')}</Btn>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {/* phone: the same rows, two lines each */}
        <ul className="ruled md:hidden">
          {LOBBIES.map((l) => {
            const full = l.seats >= l.max
            return (
              <li key={l.code}>
                <button disabled={full} onClick={() => go('lobby')} className="flex w-full items-center gap-3 py-3 text-left disabled:opacity-50">
                  <span className="tnum w-12 font-display text-muted-foreground">{l.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-lg">{l.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Pips n={l.seats} max={l.max} /> {l.minutes} {t(lang, 'minutes')} {l.locked && <Lock size={12} />}
                    </span>
                  </span>
                  <span className="smallcaps text-sm text-primary">{full ? t(lang, 'full') : `${t(lang, 'join')} →`}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}

const Pips = ({ n, max }: { n: number; max: number }) => (
  <span className="inline-flex items-center gap-1" aria-label={`${n} of ${max}`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} className={`inline-block h-2.5 w-2.5 rounded-full border border-foreground ${i < n ? 'bg-foreground' : ''}`} />
    ))}
  </span>
)

// ---------------- Lobby: seminar table + syllabus ----------------
export function LobbyA({ dir, theme, lang, go }: ScreenProps) {
  const [max, setMax] = useState(LOBBY.max)
  const [mins, setMins] = useState(LOBBY.minutes)
  const [locked, setLocked] = useState(LOBBY.locked)
  const seats = LOBBY.seats.slice(0, max)
  const filled = seats.filter(Boolean).length
  const pos = ['left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', 'right-0 top-1/2 translate-x-1/3 -translate-y-1/2', 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', 'left-0 top-1/2 -translate-x-1/3 -translate-y-1/2']
  return (
    <div className="min-h-dvh overflow-auto pb-bar">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-2 border-b-2 border-foreground px-4 pt-6 pb-3 md:pt-10">
        <button className="smallcaps text-sm text-muted-foreground hover:text-foreground" onClick={() => go('list')}>← {t(lang, 'leave')}</button>
        <div className="smallcaps text-sm text-muted-foreground">Room No. <span className="tnum font-display text-2xl text-foreground not-italic">{LOBBY.code}</span>
          <button className="ml-1 align-middle text-muted-foreground hover:text-foreground" aria-label="copy Room code"><Copy size={16} /></button>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-6 md:grid-cols-[1.2fr_1fr] md:py-10">
        <section>
          <h1 className="font-display text-3xl font-semibold italic md:text-5xl">{LOBBY.name}</h1>
          <p className="mt-1 text-muted-foreground">{t(lang, 'waiting')} · {filled}/{max}</p>
          <div className="relative mx-auto mt-14 mb-16 aspect-[16/10] w-[78%] max-w-md">
            <div className="absolute inset-0 rounded-[50%] border-2 border-foreground bg-card shadow-[inset_0_0_0_10px_var(--muted)]" />
            <div className="absolute inset-0 flex items-center justify-center font-display text-lg italic text-muted-foreground">UNIversum</div>
            {seats.map((s, i) => (
              <div key={i} className={`absolute flex w-28 flex-col items-center text-center ${pos[i]}`}>
                {s ? (
                  <>
                    <span className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-foreground bg-background ${s.held ? 'opacity-50' : ''}`}>
                      <img src={alien(s.color)} alt="" className="h-11" />
                      <Token dir={dir} theme={theme} p={s.color} size={22} className="absolute -right-1 -bottom-1 ring-2 ring-background" />
                    </span>
                    <span className="mt-1 text-sm leading-tight font-semibold">{s.name}</span>
                    <span className="smallcaps text-[11px] text-muted-foreground">
                      {s.held ? t(lang, 'heldSeat') : [s.host && t(lang, 'host'), s.me && t(lang, 'you')].filter(Boolean).join(' · ')}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground font-display text-2xl text-muted-foreground">{i + 1}</span>
                    <span className="smallcaps mt-1 text-[11px] text-muted-foreground">{t(lang, 'openSeat')}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="self-start border border-border bg-card p-5">
          <h2 className="smallcaps border-b border-foreground pb-2 text-sm text-muted-foreground">Syllabus · {t(lang, 'host')}</h2>
          <dl className="ruled text-sm">
            <Row label={t(lang, 'players')}>
              <Seg value={max} options={[2, 3, 4]} onChange={setMax} />
            </Row>
            <Row label={t(lang, 'minuteLimit')}>
              <Seg value={mins} options={[15, 30, 50]} onChange={setMins} suffix={` ${t(lang, 'minutes')}`} />
            </Row>
            <Row label={t(lang, 'password')}>
              <button onClick={() => setLocked(!locked)} className="inline-flex items-center gap-2 underline decoration-dotted underline-offset-4">
                {locked ? <><Lock size={14} /> ••••••</> : <><LockOpen size={14} /> —</>}
              </button>
            </Row>
          </dl>
          <Btn className="mt-5 w-full" disabled={filled < 2} onClick={() => go('game')}>{t(lang, 'start')}</Btn>
          <p className="mt-2 text-center text-xs text-muted-foreground">A Seat is held for 60 s if its Player drops.</p>
        </section>
      </main>
    </div>
  )
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex min-h-12 items-center justify-between gap-3 py-2"><dt className="font-display text-base">{label}</dt><dd>{children}</dd></div>
)
function Seg<T extends number>({ value, options, onChange, suffix = '' }: { value: T; options: T[]; onChange: (v: T) => void; suffix?: string }) {
  return (
    <div className="inline-flex border border-foreground/60">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`tnum min-h-9 min-w-11 px-2 text-sm ${o === value ? 'bg-foreground text-background' : 'hover:bg-secondary'}`}>{o}{o === value ? suffix : ''}</button>
      ))}
    </div>
  )
}

// ---------------- Game: Board + ruled ledger ----------------
export function GameA({ dir, theme, lang, go, mode, result }: GameProps) {
  const vp = useViewport()
  const wide = vp.w >= 768 && !vp.portrait
  const live = useLiveRoom(result)
  const sale = useSalePick(live.turnLeft)
  const obstacle = useRef<HTMLDivElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const g = useGameBoard({
    dir, theme, mode, sale, obstacle,
    fitArea: () => (wide ? undefined : { x: 0, y: 96, w: vp.w, h: vp.h - 96 - (mode === 'sale' ? 250 : 120) }),
    fitDeps: [wide, vp.w, vp.h, mode],
  })
  const ledgerPlayers = (
    <ol className="ruled">
      {players.map((p, i) => {
        const cur = live.turnPlayer === i
        return (
          <li key={i} className={`flex items-center gap-3 py-2.5 pr-1 pl-2 ${cur ? 'border-l-4 border-l-primary bg-background' : 'border-l-4 border-l-transparent'}`}>
            <Token dir={dir} theme={theme} p={i} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg leading-tight">{p.name}{i === ME && <span className="smallcaps ml-1 text-xs text-muted-foreground">({t(lang, 'you')})</span>}</div>
              <div className="text-xs text-muted-foreground">{t(lang, 'fields')} {p.fields} · {t(lang, 'wealth')} {money(p.wealth)}</div>
            </div>
            <div className="tnum text-right font-display text-xl">{money(p.money)}</div>
          </li>
        )
      })}
    </ol>
  )
  const clocks = (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="smallcaps text-xs text-muted-foreground">{t(lang, 'turnOf')} 14 · {players[live.turnPlayer].name}</span>
        <span className={`tnum font-display text-2xl ${live.turnLeft <= 5 ? 'text-danger' : ''}`}>{Math.ceil(live.turnLeft)} s</span>
      </div>
      <div className="mt-1 h-1.5 bg-muted"><div className={`h-full ${live.turnLeft <= 5 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${(live.turnLeft / 20) * 100}%` }} /></div>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="smallcaps text-xs text-muted-foreground">{t(lang, 'minuteLimit')}</span>
        <span className="tnum font-display">{mmss(live.minuteLeft)}</span>
      </div>
    </div>
  )
  const card = mode === 'sale'
    ? <SaleTrayA sale={sale} lang={lang} open={listOpen} setOpen={setListOpen} turnLeft={live.turnLeft} />
    : g.sel !== null
      ? <FieldCardA id={g.sel} lang={lang} dir={dir} theme={theme} onPrev={() => g.setSel((g.sel! + 31) % 32)} onNext={() => g.setSel((g.sel! + 1) % 32)} onClose={() => g.setSel(null)} />
      : <div className="border border-border bg-card px-4 py-3 text-center font-display text-muted-foreground italic">{t(lang, 'inspectHint')}</div>
  const camButtons = (
    <div className="flex flex-col border border-foreground/60 bg-card">
      <button className="flex h-11 w-11 items-center justify-center hover:bg-secondary" onClick={() => g.cam.zoom(1.5)} aria-label="zoom in"><Plus size={18} /></button>
      <button className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-secondary" onClick={() => g.cam.zoom(1 / 1.5)} aria-label="zoom out"><Minus size={18} /></button>
      <button className="flex h-11 w-11 items-center justify-center border-t border-border hover:bg-secondary" onClick={g.cam.toFit} aria-label="fit"><Maximize size={16} /></button>
    </div>
  )

  if (wide) {
    return (
      <div className="fixed inset-0 grid grid-cols-[1fr_360px]">
        <div className="board-backdrop relative overflow-hidden">
          {g.board}
          <div className="absolute top-4 left-4 font-display text-2xl italic opacity-70">{LOBBY.name}</div>
          <div className="absolute top-4 right-4">{camButtons}</div>
          {mode !== 'sale' && <div ref={obstacle} className="bottom-bar absolute left-4 mb-4 w-[min(420px,calc(100%-2rem))]">{card}</div>}
        </div>
        <aside className="flex min-h-0 flex-col border-l-2 border-foreground bg-card pb-bar">
          <div className="border-b border-foreground p-4">{clocks}</div>
          <h3 className="smallcaps px-4 pt-3 text-xs text-muted-foreground">{t(lang, 'players')}</h3>
          <div className="px-2">{ledgerPlayers}</div>
          {mode === 'sale' && <div className="mt-3 border-t border-foreground p-3">{card}</div>}
          <h3 className="smallcaps mt-3 border-t border-foreground px-4 pt-3 text-xs text-muted-foreground">{t(lang, 'events')} · minutes of the meeting</h3>
          <ol className="scroll-thin min-h-0 flex-1 overflow-auto px-4 pb-4 text-sm">
            {live.events.map((e, i) => (
              <li key={e.id} className={`flex gap-2 border-b border-dotted border-border py-1.5 ${i === 0 ? 'slide-in' : ''}`}>
                {e.who !== null ? <Token dir={dir} theme={theme} p={e.who} size={16} className="mt-0.5" /> : <span className="w-4" />}
                <span>{e.who !== null && <b className="font-semibold">{GUESTS[e.who]} </b>}{e.text}</span>
              </li>
            ))}
          </ol>
        </aside>
        {result && <DiplomaA dir={dir} theme={theme} lang={lang} go={go} />}
      </div>
    )
  }
  // phone portrait
  return (
    <div className="board-backdrop fixed inset-0 overflow-hidden">
      {g.board}
      <div className="absolute inset-x-0 top-0 border-b-2 border-foreground bg-card px-2 pt-[max(8px,env(safe-area-inset-top))] pb-2">
        <div className="grid grid-cols-4 gap-1">
          {players.map((p, i) => (
            <div key={i} className={`min-w-0 px-1 pb-1 ${live.turnPlayer === i ? 'border-b-[3px] border-primary' : 'border-b-[3px] border-transparent'}`}>
              <div className="flex items-center gap-1"><Token dir={dir} theme={theme} p={i} size={16} /><span className="truncate text-[11px] font-semibold">{p.name.split(' ')[1]}</span></div>
              <div className="tnum font-display text-base leading-tight">{money(p.money)}</div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 bg-muted"><div className={`h-full ${live.turnLeft <= 5 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${(live.turnLeft / 20) * 100}%` }} /></div>
          <span className={`tnum w-8 text-right text-xs font-semibold ${live.turnLeft <= 5 ? 'text-danger' : ''}`}>{Math.ceil(live.turnLeft)}s</span>
          <span className="tnum text-xs text-muted-foreground">⏳ {mmss(live.minuteLeft)}</span>
        </div>
      </div>
      <div className="absolute top-[104px] right-2">{camButtons}</div>
      <div ref={obstacle} className="bottom-bar absolute inset-x-2 mb-2 flex flex-col gap-1.5">
        {live.events[0] && (
          <div key={live.events[0].id} className="slide-in truncate px-1 font-display text-sm italic">
            {live.events[0].who !== null && <Token dir={dir} theme={theme} p={live.events[0].who} size={14} className="mr-1 align-[-2px]" />}
            {live.events[0].who !== null && `${GUESTS[live.events[0].who]} `}{live.events[0].text}
          </div>
        )}
        {card}
      </div>
      {result && <DiplomaA dir={dir} theme={theme} lang={lang} go={go} />}
    </div>
  )
}

function FieldCardA({ id, lang, dir, theme, onPrev, onNext, onClose }: { id: number; lang: GameProps['lang']; dir: GameProps['dir']; theme: GameProps['theme']; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const i = fieldInfo(id)
  const band = GROUP_COLORS[i.f.groupId]
  return (
    <div className="pop-in border border-foreground/70 bg-card shadow-[4px_4px_0_var(--border)]" key={id}>
      <div className="h-3 border-b border-foreground/70" style={{ background: band ? hexOf(band) : 'var(--muted)' }} />
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="smallcaps text-xs text-muted-foreground">{i.kind} · No. {id}</div>
            <div className="font-display text-2xl leading-tight font-semibold">{fieldName(id)}</div>
          </div>
          <button onClick={onClose} aria-label="close" className="-mr-2 p-2 text-muted-foreground"><X size={18} /></button>
        </div>
        {i.ownable && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 border-t border-border pt-2 text-sm">
            <dt className="text-muted-foreground">{t(lang, 'owner')}</dt>
            <dd className="flex items-center justify-end gap-1 text-right">{i.owner ? <><Token dir={dir} theme={theme} p={i.st.owner!} size={16} />{i.owner.name}</> : t(lang, 'unowned')}</dd>
            <dt className="text-muted-foreground">{t(lang, 'level')}</dt><dd className="tnum text-right">{i.st.level || '—'}</dd>
            <dt className="text-muted-foreground">{t(lang, 'rent')}</dt><dd className="tnum text-right font-display text-lg">{i.rent ? money(i.rent) : '—'}</dd>
            <dt className="text-muted-foreground">{t(lang, 'value')}</dt><dd className="tnum text-right">{money(i.value)}</dd>
          </dl>
        )}
        <div className="mt-3 grid grid-cols-[44px_1fr_44px] gap-2">
          <Btn kind="outline" onClick={onPrev} aria-label="previous Field" className="px-0"><ChevronLeft size={18} /></Btn>
          <Btn kind="outline" disabled>{i.ownable && !i.owner ? `Buy · ${money(i.value)}` : 'Not your Turn to act'}</Btn>
          <Btn kind="outline" onClick={onNext} aria-label="next Field" className="px-0"><ChevronRight size={18} /></Btn>
        </div>
      </div>
    </div>
  )
}

function SaleTrayA({ sale, lang, open, setOpen, turnLeft }: { sale: ReturnType<typeof useSalePick>; lang: GameProps['lang']; open: boolean; setOpen: (b: boolean) => void; turnLeft: number }) {
  const pct = Math.min(100, (sale.total / SHORTFALL) * 100)
  return (
    <div className="border border-foreground/70 bg-card shadow-[4px_4px_0_var(--border)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <div className="smallcaps text-xs text-danger">{t(lang, 'rent')} {money(CHARGE)} · {t(lang, 'cash')} {money(CASH)}</div>
          <div className="font-display text-lg leading-tight">{t(lang, 'shortfall')} {money(SHORTFALL)}</div>
        </div>
        <div className={`tnum font-display text-2xl ${turnLeft <= 5 ? 'text-danger' : ''}`}>{Math.ceil(turnLeft)} s</div>
      </div>
      {open && (
        <ul className="ruled scroll-thin max-h-48 overflow-auto px-4">
          {SALE_IDS.map((id) => {
            const on = sale.picked.includes(id)
            return (
              <li key={id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" checked={on} onChange={() => sale.toggle(id)} className="h-4 w-4 accent-[var(--success)]" />
                  <span className="h-4 w-1.5" style={{ background: hexOf(GROUP_COLORS[fieldInfo(id).f.groupId] ?? 0x888888) }} />
                  <span className="flex-1 font-display">{fieldName(id)}</span>
                  {AUTO_SELL.includes(id) && <span className="smallcaps text-[10px] text-warning">auto</span>}
                  <span className="tnum">{money(saleValue(id))}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="px-4 py-2">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5">
          {sale.picked.length === 0 && <span className="font-display text-sm text-muted-foreground italic">{t(lang, 'pickHint')}</span>}
          {sale.picked.map((id) => (
            <button key={id} onClick={() => sale.toggle(id)} className="inline-flex items-center gap-1 border border-success px-2 py-1 text-xs font-semibold text-success">
              {fieldName(id)} {money(saleValue(id))} <X size={12} />
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <div className="h-1.5 flex-1 bg-muted"><div className={`h-full ${sale.canSell ? 'bg-success' : 'bg-warning'}`} style={{ width: `${pct}%` }} /></div>
          <span className="tnum">{money(sale.total)} / {money(SHORTFALL)}</span>
        </div>
        <div className="mt-2 grid grid-cols-[auto_auto_1fr] gap-2">
          <Btn kind="outline" onClick={() => setOpen(!open)} aria-label={t(lang, 'allFields')} className="px-3">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</Btn>
          <Btn kind="outline" onClick={sale.reset}>{t(lang, 'autoSell')}</Btn>
          <Btn disabled={!sale.canSell} onClick={sale.reset}>{t(lang, 'sell')} {sale.total ? money(sale.total) : ''}</Btn>
        </div>
      </div>
    </div>
  )
}

// ---------------- result: a diploma ----------------
function DiplomaA({ dir, theme, lang, go }: Omit<ScreenProps, 'go'> & { go: ScreenProps['go'] }) {
  const honours = ['summa cum laude', 'magna cum laude', 'cum laude']
  const w = RESULT[0]
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-3 pb-bar">
      <div className="pop-in max-h-full w-full max-w-lg overflow-auto border-[6px] border-double border-foreground bg-card p-6 text-center md:p-10">
        <div className="smallcaps text-xs text-muted-foreground">{t(lang, 'timeUp')}</div>
        <div className="mt-2 font-display text-5xl font-semibold italic">Diploma</div>
        <p className="mt-3 font-display text-lg">UNIversum hereby confers upon</p>
        <div className="mt-2 flex items-center justify-center gap-2 font-display text-3xl font-semibold">
          <Token dir={dir} theme={theme} p={w.p} size={28} />{GUESTS[w.p]}
        </div>
        <p className="font-display text-lg italic">the degree of {t(lang, 'winner')}, {honours[0]}</p>
        <table className="mt-6 w-full text-left text-sm">
          <thead><tr className="smallcaps border-b border-foreground text-xs text-muted-foreground"><th className="py-1 font-normal" /><th className="font-normal">{t(lang, 'players')}</th><th className="text-right font-normal">{t(lang, 'cash')}</th><th className="text-right font-normal">{t(lang, 'wealth')}</th></tr></thead>
          <tbody>
            {RESULT.map((r, i) => (
              <tr key={r.p} className="border-b border-border">
                <td className="tnum py-2 font-display">{i + 1}.</td>
                <td><span className="inline-flex items-center gap-2"><Token dir={dir} theme={theme} p={r.p} size={18} />{GUESTS[r.p]}</span>
                  <div className="smallcaps text-[11px] text-muted-foreground">{r.bankrupt ? t(lang, 'bankrupt') : honours[i]}</div></td>
                <td className="tnum text-right">{money(r.cash)}</td>
                <td className="tnum text-right font-display text-lg">{r.bankrupt ? '—' : money(r.wealth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">{t(lang, 'wealth')} = {t(lang, 'cash')} + {t(lang, 'value')} of {t(lang, 'fields')}</p>
        <Btn className="mt-6" onClick={() => go('list')}>{t(lang, 'playAgain')}</Btn>
      </div>
    </div>
  )
}

export const metaA = DIRS.a
