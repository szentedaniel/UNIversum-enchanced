// PROTOTYPE, throwaway: picking several Fields with the Field card (map ticket #15).
// Three structurally different pick flows on variant E's camera (pinch / pan, starts fitted):
//   1  Toggle on the card     tap opens the Field card; its button adds / removes; ‹ › steps eligible Fields
//   2  Tap toggles the Board  taps snap to the nearest *eligible* Field and toggle it; chips in a tray
//   3  Checklist in the sheet the sheet lists the eligible Fields; rows and Board taps toggle the same pick
// Each runs three scenarios (?pick= or the top control): a Sale for a Shortfall, Doubler placement, Erasmus.
// Open with ?page=pick&v=1|2|3&pick=sale|doubler|erasmus. Mock state; nothing is sent anywhere.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BoardRenderer, Mark, RenderOptions } from './board/renderer'
import { FIELDS, GROUP_COLORS, KIND_NAME, MOCK_PLAYERS, PLAYER_COLORS, compact, fieldState, mockPrice, mockRent } from './board/data'
import { BoardCanvas, Hud, Switcher, TapTestProvider, useViewport } from './shared'
import { useZoomPan } from './variants'

type Scenario = 'sale' | 'doubler' | 'erasmus'
const SCENARIOS: { key: Scenario; name: string }[] = [
  { key: 'sale', name: 'Sale' },
  { key: 'doubler', name: 'Doubler' },
  { key: 'erasmus', name: 'Erasmus' },
]

// ---------- mock rules state: Anna (Player 0) owes Rent she can't cover in cash ----------
const ME = 0
const CASH = MOCK_PLAYERS[ME].money // 1,250,000
const CHARGE = 1_670_000 // the Rent owed
const SHORTFALL = CHARGE - CASH // 420,000
const ERASMUS_FIELD = 24
const TURN = 20 // Turn timer, s
const AUTO_WARN = 5 // show what Auto-sell would take in the last seconds

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const full = new Intl.NumberFormat('en-GB')
const name = (id: number) => (FIELDS[id].kind === 'museum' ? `MUSEUM ${id}` : FIELDS[id].label.toUpperCase())
const ownerName = (id: number) => { const o = fieldState(id).owner; return o === null ? null : MOCK_PLAYERS.find((p) => p.color === o)!.name }

/** Bank-sale value: 90% of the Value (Museums 400,000). Mock numbers, shape of R30. */
function saleValue(id: number) {
  const f = FIELDS[id], st = fieldState(id)
  const value = f.kind === 'museum' ? 400_000 : mockPrice(id) * Math.max(1, st.level)
  return Math.round((value * 0.9) / 1000) * 1000
}
function eligible(s: Scenario, id: number) {
  const f = FIELDS[id], st = fieldState(id)
  if (f.kind !== 'normal' && f.kind !== 'museum') return false
  return s === 'erasmus' ? st.owner === null || st.owner === ME : st.owner === ME
}
function whyNot(s: Scenario, id: number) {
  const f = FIELDS[id], o = ownerName(id)
  if (f.kind !== 'normal' && f.kind !== 'museum') return `${KIND_NAME[f.kind]} can't be picked`
  if (s === 'erasmus') return `Owned by ${o}`
  return o ? `Owned by ${o}` : 'Not your Field'
}
const ELIGIBLE = (s: Scenario) => FIELDS.map((f) => f.id).filter((id) => eligible(s, id))
/** Auto-sell: cheapest first, stop as soon as proceeds ≥ Shortfall (F9 as fixed). */
const AUTO_SELL = (() => {
  const out: number[] = []
  let t = 0
  for (const id of ELIGIBLE('sale').sort((a, b) => saleValue(a) - saleValue(b))) { if (t >= SHORTFALL) break; out.push(id); t += saleValue(id) }
  return out
})()
const erasmusSteps = (id: number) => (id - ERASMUS_FIELD + 32) % 32
const passesStart = (id: number) => ERASMUS_FIELD + erasmusSteps(id) >= 32

const PROMPT: Record<Scenario, string> = {
  sale: `Rent ${compact.format(CHARGE)}, cash ${compact.format(CASH)}: sell Fields worth ${compact.format(SHORTFALL)}`,
  doubler: 'Put the Doubler on one of your Fields',
  erasmus: 'Erasmus: travel to a University or Museum no other Player owns',
}

// ---------- shared hooks ----------

function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t) }, [msg])
  return [msg, setMsg] as const
}

function useTurnClock(paused: boolean, onExpire: () => void) {
  const [left, setLeft] = useState(TURN)
  const [epoch, setEpoch] = useState(0)
  const cb = useRef(onExpire)
  cb.current = onExpire
  useEffect(() => {
    if (paused) return
    const t0 = performance.now() - (TURN - left) * 1000
    const t = setInterval(() => {
      const l = Math.max(0, TURN - (performance.now() - t0) / 1000)
      setLeft(l)
      if (l <= 0) { clearInterval(t); cb.current() }
    }, 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, epoch])
  return { left, restart: () => { setLeft(TURN); setEpoch((e) => e + 1) } }
}

interface PickApi {
  s: Scenario
  picked: number[]
  total: number
  canConfirm: boolean
  toggle: (id: number) => void
  confirm: () => void
  auto: () => void
  left: number
  toast: string | null
  marks: Record<number, Mark>
  eligibleIds: number[]
}

/** The pick itself, identical across variants: what changes per variant is only how it's driven. */
function usePick(s: Scenario, paused: boolean): PickApi {
  const [picked, setPicked] = useState<number[]>([])
  const [toast, setToast] = useToast()
  const single = s !== 'sale'
  const total = picked.reduce((a, id) => a + saleValue(id), 0)
  const canConfirm = single ? picked.length === 1 : total >= SHORTFALL
  const done = (msg: string) => { setToast(msg); setPicked([]); clock.restart() }
  const clock = useTurnClock(paused, () => {
    if (s === 'sale') done(`Time up → Auto-sell sold ${AUTO_SELL.map(name).join(', ')} (${compact.format(AUTO_SELL.reduce((a, id) => a + saleValue(id), 0))}) + timeout penalty`)
    else done('Time up → timeout penalty, the Turn passes')
  })
  const eligibleIds = useMemo(() => ELIGIBLE(s), [s])
  const toggle = (id: number) => {
    if (!eligible(s, id)) return
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : single ? [id] : [...p, id]))
  }
  const confirm = () => {
    if (!canConfirm) return
    if (s === 'sale') done(`Sold ${picked.map(name).join(', ')} for ${compact.format(total)} · Rent paid · ${compact.format(CASH + total - CHARGE)} left`)
    if (s === 'doubler') done(`Doubler on ${name(picked[0])}: Rent ×2`)
    if (s === 'erasmus') done(`Travelling ${erasmusSteps(picked[0])} Fields to ${name(picked[0])}${passesStart(picked[0]) ? ' · +250K Round bonus' : ''}`)
  }
  const auto = () => done(`Auto-sell sold ${AUTO_SELL.map(name).join(', ')} for ${compact.format(AUTO_SELL.reduce((a, id) => a + saleValue(id), 0))}`)
  const warn = s === 'sale' && clock.left <= AUTO_WARN && !canConfirm
  const marks: Record<number, Mark> = {}
  for (const f of FIELDS) {
    if (!eligible(s, f.id)) marks[f.id] = 'off'
    else if (picked.includes(f.id)) marks[f.id] = 'picked'
    else if (warn && AUTO_SELL.includes(f.id)) marks[f.id] = 'auto'
  }
  return { s, picked, total, canConfirm, toggle, confirm, auto, left: clock.left, toast, marks, eligibleIds }
}

/** Apply marks + focus to the Board, and pan (never zoom) when the focused Field is hidden. */
function useBoardSync(r: BoardRenderer | null, p: PickApi, focus: number | null, obstacle: React.RefObject<HTMLElement | null>,
  panTo: (a: { x: number; y: number }, b: { x: number; y: number }) => void, portrait: boolean) {
  const key = JSON.stringify(p.marks)
  useEffect(() => { r?.setMarks(p.marks) }, [r, key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!r) return
    r.setSelected(focus)
    if (focus === null) return
    const raf = requestAnimationFrame(() => {
      const ob = obstacle.current?.getBoundingClientRect()
      const c = r.fieldCenter(focus), m = 24, w = innerWidth, h = innerHeight
      const under = !!ob && c.x > ob.left - m && c.x < ob.right + m && c.y > ob.top - m && c.y < ob.bottom + m
      const off = c.x < m || c.y < m || c.x > w - m || c.y > h - m
      if (!under && !off) return
      panTo(c, !ob ? { x: w / 2, y: h / 2 } : portrait ? { x: w / 2, y: ob.top / 2 } : { x: ob.left / 2, y: h / 2 })
    })
    return () => cancelAnimationFrame(raf)
  }, [r, focus]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- shared UI pieces ----------

function Clock({ left }: { left: number }) {
  const k = left / TURN
  return (
    <span className={`clock ${left <= AUTO_WARN ? 'bad' : ''}`}>
      <span className="clock-bar" style={{ width: `${k * 100}%` }} />
      <b>{Math.ceil(left)} s</b>
    </span>
  )
}

/** Running total vs Shortfall, Sell / Auto-sell. For single picks: the prompt + Confirm. */
function Meter({ p, compactLayout, extra }: { p: PickApi; compactLayout?: boolean; extra?: ReactNode }) {
  if (p.s !== 'sale') {
    const id = p.picked[0]
    return (
      <div className={`meter ${compactLayout ? 'compact' : ''}`}>
        <div className="meter-head"><span className="grow">{PROMPT[p.s]}</span><Clock left={p.left} /></div>
        {extra}
        <button className="primary wide" disabled={!p.canConfirm} onClick={p.confirm}>
          {id === undefined ? 'Pick a Field' : p.s === 'doubler' ? `Put the Doubler on ${name(id)}` : `Travel to ${name(id)}`}
        </button>
      </div>
    )
  }
  const k = Math.min(1, p.total / SHORTFALL)
  return (
    <div className={`meter ${compactLayout ? 'compact' : ''}`}>
      <div className="meter-head">
        <span className="grow">Sale · <b>{compact.format(p.total)}</b> <span className="muted">of {compact.format(SHORTFALL)}</span></span>
        <Clock left={p.left} />
      </div>
      <div className="progress"><span className={p.canConfirm ? 'ok-bg' : ''} style={{ width: `${k * 100}%` }} /></div>
      {extra}
      <div className="meter-actions">
        <button onClick={p.auto}>Auto-sell</button>
        <button className="primary" disabled={!p.canConfirm} onClick={p.confirm}>
          {p.canConfirm ? `Sell ${p.picked.length} for ${compact.format(p.total)}` : `${compact.format(SHORTFALL - p.total)} more`}
        </button>
      </div>
    </div>
  )
}

function Facts({ s, id }: { s: Scenario; id: number }) {
  const f = FIELDS[id], st = fieldState(id), o = ownerName(id)
  if (f.kind !== 'normal' && f.kind !== 'museum') return null
  return (
    <div className="card-facts">
      <span>Level <b>{f.kind === 'museum' ? '–' : st.level}</b></span>
      <span>Rent <b>{st.level ? compact.format(mockRent(id, st.level)) : '–'}</b></span>
      <span>Owner {o ? <b style={{ color: hex(PLAYER_COLORS[st.owner!]) }}>{o}</b> : <b>none</b>}</span>
      {s === 'sale' && <span>Sells for <b>{compact.format(saleValue(id))}</b></span>}
      {s === 'doubler' && <span>With Doubler <b>{st.level ? compact.format(mockRent(id, st.level) * 2) : '×2'}</b></span>}
      {s === 'erasmus' && <span>{erasmusSteps(id)} Fields ahead{passesStart(id) && <b> · +250K</b>}</span>}
    </div>
  )
}

function Stripe({ id }: { id: number }) {
  const g = GROUP_COLORS[FIELDS[id].groupId]
  return <div className="card-stripe" style={{ background: g ? hex(g) : '#667' }} />
}

/** Surfaces the full pick state in the HUD (rule: render all relevant state). */
function StateDump({ p, focus, extra }: { p: PickApi; focus: number | null; extra?: ReactNode }) {
  return (
    <div className="state">
      <div><span className="muted">scenario</span> {p.s} · <span className="muted">focus</span> {focus === null ? '–' : name(focus)}</div>
      <div><span className="muted">picked</span> [{p.picked.map(name).join(', ')}] = {full.format(p.total)}</div>
      {p.s === 'sale' && <div><span className="muted">Shortfall</span> {full.format(SHORTFALL)} · <span className="muted">can sell</span> {String(p.canConfirm)}</div>}
      {p.s === 'sale' && <div><span className="muted">Auto-sell</span> [{AUTO_SELL.map(name).join(', ')}]</div>}
      <div><span className="muted">eligible</span> {p.eligibleIds.length} Fields · <span className="muted">clock</span> {p.left.toFixed(1)} s</div>
      {extra}
    </div>
  )
}

interface PickProps { s: Scenario; options: RenderOptions; setOptions: (o: RenderOptions) => void; paused: boolean; hudExtra: ReactNode }

// ---------------- 1 · Toggle on the card ----------------
// E unchanged: tap any Field to inspect it. The card's one button adds / removes it from the pick.
// ‹ › steps through eligible Fields only (or all, from the HUD). The meter sits on top of the card.
function Pick1({ s, options, setOptions, paused, hudExtra }: PickProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [stepAll, setStepAll] = useState(false)
  const p = usePick(s, paused)
  const vp = useViewport()
  const stack = useRef<HTMLDivElement>(null)
  const RESERVE = 330
  const { buttons, panTo } = useZoomPan(
    r,
    (x, y) => { const n = r!.nearestField(x, y); setFocus(n.dist < Math.max(70, r!.stats().fieldPx) ? n.id : null) },
    () => (vp.portrait ? { x: 0, y: 0, w: vp.w, h: vp.h - RESERVE } : undefined),
    [vp.portrait, vp.w, vp.h], 'top',
  )
  useBoardSync(r, p, focus, stack, panTo, vp.portrait)
  const ring = stepAll ? FIELDS.map((f) => f.id) : p.eligibleIds
  const step = (d: number) => {
    if (focus === null) return setFocus(ring[0])
    // next in ring order from the focused Field, even if it isn't itself eligible
    const after = ring.filter((id) => (d > 0 ? id > focus : id < focus))
    setFocus(d > 0 ? after[0] ?? ring[0] : after[after.length - 1] ?? ring[ring.length - 1])
  }
  const ok = focus !== null && eligible(s, focus)
  const isPicked = focus !== null && p.picked.includes(focus)
  const action = s === 'sale' ? (isPicked ? 'Remove from Sale' : `Add to Sale · ${focus !== null ? compact.format(saleValue(focus)) : ''}`)
    : isPicked ? (s === 'doubler' ? 'Doubler goes here ✓' : 'Destination ✓') : s === 'doubler' ? 'Doubler here' : 'Travel here'
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      {buttons}
      <div ref={stack} className={`pick-stack ${vp.portrait ? '' : 'compact'}`}>
        {focus !== null ? (
          <div className={`card ${vp.portrait ? '' : 'compact'}`}>
            <Stripe id={focus} />
            <div className="card-head">
              <div>
                <div className="card-title">{FIELDS[focus].label}</div>
                <div className="muted">{KIND_NAME[FIELDS[focus].kind]} · Field {focus}</div>
              </div>
              <button className="link" onClick={() => setFocus(null)} aria-label="close">✕</button>
            </div>
            <Facts s={s} id={focus} />
            <div className="card-actions">
              <button onClick={() => step(-1)} aria-label="previous Field">‹</button>
              <button className={isPicked ? 'on' : 'primary'} disabled={!ok} onClick={() => p.toggle(focus)}>{ok ? action : whyNot(s, focus)}</button>
              <button onClick={() => step(1)} aria-label="next Field">›</button>
            </div>
          </div>
        ) : (
          <div className="card hint">Tap one of the bright Fields, or <button className="link" onClick={() => step(1)}>step through them ›</button></div>
        )}
        <Meter p={p} compactLayout={!vp.portrait} />
      </div>
      {p.toast && <div className="toast top">{p.toast}</div>}
      <Hud r={r} options={options} setOptions={setOptions} extra={<>
        <StateDump p={p} focus={focus} />
        <div className="row"><span>‹ › steps</span>
          <button className={!stepAll ? 'on' : ''} onClick={() => setStepAll(false)}>eligible</button>
          <button className={stepAll ? 'on' : ''} onClick={() => setStepAll(true)}>all Fields</button>
        </div>
        {hudExtra}
      </>} />
    </div>
  )
}

// ---------------- 2 · Tap toggles on the Board ----------------
// No card while picking. A tap snaps to the nearest *eligible* Field (only a handful compete,
// so the target is huge) and toggles it. Picks show as chips in a tray. "ⓘ" switches to E's inspect card.
function Pick2({ s, options, setOptions, paused, hudExtra }: PickProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [inspect, setInspect] = useState(false)
  const [focus, setFocus] = useState<number | null>(null)
  const [last, setLast] = useState<{ id: number; dist: number } | null>(null)
  const p = usePick(s, paused)
  const vp = useViewport()
  const tray = useRef<HTMLDivElement>(null)
  const RESERVE = 210
  const pRef = useRef(p)
  pRef.current = p
  const { buttons, panTo } = useZoomPan(
    r,
    (x, y) => {
      if (inspectRef.current) { const n = r!.nearestField(x, y); setFocus(n.dist < Math.max(70, r!.stats().fieldPx) ? n.id : null); return }
      let best: number | null = null, d = Infinity
      for (const id of pRef.current.eligibleIds) { const c = r!.fieldCenter(id); const k = Math.hypot(c.x - x, c.y - y); if (k < d) { d = k; best = id } }
      const radius = Math.max(90, r!.stats().fieldPx * 1.6)
      setLast(best === null ? null : { id: best, dist: d })
      if (best !== null && d < radius) pRef.current.toggle(best)
    },
    () => (vp.portrait ? { x: 0, y: 0, w: vp.w, h: vp.h - RESERVE } : undefined),
    [vp.portrait, vp.w, vp.h], 'top',
  )
  const inspectRef = useRef(inspect)
  inspectRef.current = inspect
  useBoardSync(r, p, inspect ? focus : null, tray, panTo, vp.portrait)
  const chips = (
    <div className="chips">
      {p.picked.length === 0 && <span className="muted">{s === 'sale' ? 'Tap your Fields on the Board to add them.' : 'Tap a bright Field on the Board.'}</span>}
      {p.picked.map((id) => (
        <button key={id} className="chip" onClick={() => p.toggle(id)}>
          <span className="dot" style={{ background: hex(GROUP_COLORS[FIELDS[id].groupId] ?? 0x667788) }} />
          {name(id)}{s === 'sale' && <b> {compact.format(saleValue(id))}</b>}
          {s === 'erasmus' && <span className="muted"> {erasmusSteps(id)} ahead{passesStart(id) ? ' · +250K' : ''}</span>} ✕
        </button>
      ))}
    </div>
  )
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      {buttons}
      <div ref={tray} className={`pick-stack ${vp.portrait ? '' : 'compact'}`}>
        {inspect && focus !== null && (
          <div className={`card ${vp.portrait ? '' : 'compact'}`}>
            <Stripe id={focus} />
            <div className="card-head">
              <div><div className="card-title">{FIELDS[focus].label}</div><div className="muted">{KIND_NAME[FIELDS[focus].kind]} · inspecting</div></div>
              <button className="link" onClick={() => setFocus(null)} aria-label="close">✕</button>
            </div>
            <Facts s={s} id={focus} />
          </div>
        )}
        <Meter p={p} compactLayout={!vp.portrait} extra={
          <div className="tray-row">
            {chips}
            <button className={`inspect ${inspect ? 'on' : ''}`} onClick={() => { setInspect(!inspect); setFocus(null) }} aria-label="inspect mode">ⓘ</button>
          </div>
        } />
      </div>
      {inspect && <div className="toast top">Inspect mode: taps open the card, they don't pick</div>}
      {p.toast && <div className="toast top">{p.toast}</div>}
      <Hud r={r} options={options} setOptions={setOptions} extra={<>
        <StateDump p={p} focus={focus} extra={<div><span className="muted">last tap</span> {last ? `${name(last.id)} at ${last.dist.toFixed(0)} px` : '–'} · <span className="muted">mode</span> {inspect ? 'inspect' : 'pick'}</div>} />
        {hudExtra}
      </>} />
    </div>
  )
}

// ---------------- 3 · Checklist in the sheet ----------------
// The sheet becomes the picker: one row per eligible Field (Sale: cheapest first, Auto-sell's picks
// badged; Erasmus: by distance ahead). Rows toggle and focus the Board; Board taps toggle the row.
function Pick3({ s, options, setOptions, paused, hudExtra }: PickProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const p = usePick(s, paused)
  const vp = useViewport()
  const sheet = useRef<HTMLDivElement>(null)
  const rows = useRef<Record<number, HTMLElement | null>>({})
  const SHEET_H = Math.round(vp.h * 0.46)
  const PANEL_W = Math.min(340, Math.round(vp.w * 0.42))
  const pRef = useRef(p)
  pRef.current = p
  const { buttons, panTo } = useZoomPan(
    r,
    (x, y) => {
      const n = r!.nearestField(x, y)
      if (n.dist > Math.max(70, r!.stats().fieldPx)) return
      setFocus(n.id)
      if (eligible(s, n.id)) { pRef.current.toggle(n.id); rows.current[n.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
    },
    () => (vp.portrait ? { x: 0, y: 0, w: vp.w, h: vp.h - SHEET_H } : { x: 0, y: 0, w: vp.w - PANEL_W, h: vp.h }),
    [vp.portrait, vp.w, vp.h], vp.portrait ? 'top' : 'top beside-panel',
  )
  useBoardSync(r, p, focus, sheet, panTo, vp.portrait)
  const order = [...p.eligibleIds].sort((a, b) =>
    s === 'sale' ? saleValue(a) - saleValue(b) : s === 'erasmus' ? erasmusSteps(a) - erasmusSteps(b) : a - b)
  const single = s !== 'sale'
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      {buttons}
      <div ref={sheet} className={`sheet ${vp.portrait ? '' : 'side'}`} style={vp.portrait ? { height: SHEET_H } : { width: PANEL_W }}>
        <div className="sheet-list">
          {order.map((id) => {
            const on = p.picked.includes(id)
            const st = fieldState(id)
            return (
              <label key={id} ref={(el) => { rows.current[id] = el }} className={`pick-row ${on ? 'on' : ''} ${focus === id ? 'focus' : ''}`}
                onClick={(e) => { e.preventDefault(); p.toggle(id); setFocus(id) }}>
                <span className="row-stripe" style={{ background: hex(GROUP_COLORS[FIELDS[id].groupId] ?? 0x667788) }} />
                <input type={single ? 'radio' : 'checkbox'} checked={on} readOnly tabIndex={-1} />
                <span className="grow">
                  <b>{name(id)}</b>
                  <span className="muted small"> {FIELDS[id].kind === 'museum' ? 'Museum' : `Level ${st.level}`}
                    {s === 'erasmus' && st.owner === ME && ' · yours'}</span>
                </span>
                {s === 'sale' && AUTO_SELL.includes(id) && <span className="badge" title="Auto-sell would sell this">auto</span>}
                {s === 'sale' && <b>{compact.format(saleValue(id))}</b>}
                {s === 'doubler' && <span className="small">{st.level ? `${compact.format(mockRent(id, st.level))} → ${compact.format(mockRent(id, st.level) * 2)}` : '×2'}</span>}
                {s === 'erasmus' && <span className="small">{erasmusSteps(id)} ahead{passesStart(id) && <b> +250K</b>}</span>}
              </label>
            )
          })}
        </div>
        <Meter p={p} />
      </div>
      {focus !== null && !eligible(s, focus) && <div className="toast top">{name(focus)}: {whyNot(s, focus)}</div>}
      {p.toast && <div className="toast top">{p.toast}</div>}
      <Hud r={r} options={options} setOptions={setOptions} extra={<><StateDump p={p} focus={focus} />{hudExtra}</>} />
    </div>
  )
}

// ---------------- page ----------------

const VARIANTS = [
  { key: '1', name: 'Toggle on the card', C: Pick1 },
  { key: '2', name: 'Tap toggles the Board', C: Pick2 },
  { key: '3', name: 'Checklist in the sheet', C: Pick3 },
]

export function PickPage() {
  const params = new URLSearchParams(location.search)
  const [v, setV] = useState(params.get('v') ?? '1')
  const [s, setS] = useState<Scenario>((params.get('pick') as Scenario) ?? 'sale')
  const [paused, setPaused] = useState(params.get('clock') === 'off')
  const [options, setOptions] = useState<RenderOptions>({
    recolor: 'baked', labels: true, walking: false, continuous: false, resolution: Math.min(2, devicePixelRatio),
  })
  const setParam = (k: string, val: string) => { const u = new URL(location.href); u.searchParams.set(k, val); history.replaceState(null, '', u) }
  const V = VARIANTS.find((x) => x.key === v) ?? VARIANTS[0]
  const hudExtra = (
    <div className="row"><span>Turn timer</span>
      <button className={!paused ? 'on' : ''} onClick={() => setPaused(false)}>running</button>
      <button className={paused ? 'on' : ''} onClick={() => setPaused(true)}>paused</button>
    </div>
  )
  return (
    <TapTestProvider key={V.key} variant={`pick ${V.key}`}>
      <div className="scenario">
        {SCENARIOS.map((x) => (
          <button key={x.key} className={x.key === s ? 'on' : ''} onClick={() => { setS(x.key); setParam('pick', x.key) }}>{x.name}</button>
        ))}
      </div>
      <V.C key={`${V.key}-${s}`} s={s} options={options} setOptions={setOptions} paused={paused} hudExtra={hudExtra} />
      <Switcher variants={VARIANTS} current={V.key} onChange={(k) => { setParam('v', k); setV(k) }} />
    </TapTestProvider>
  )
}
