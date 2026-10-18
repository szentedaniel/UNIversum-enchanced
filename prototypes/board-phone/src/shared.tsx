// PROTOTYPE, throwaway. Shared pieces for the variants: Board host, tap test, HUD, switcher.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createBoardRenderer, type BoardRenderer, type RenderOptions, type Recolor } from './board/renderer'
import { FIELDS } from './board/data'

// ---------- Board host: the "one React component" seam ----------

export function BoardCanvas({ options, onReady, style }: {
  options: RenderOptions
  onReady: (r: BoardRenderer | null) => void
  style?: React.CSSProperties
}) {
  const host = useRef<HTMLDivElement>(null)
  const rRef = useRef<BoardRenderer | null>(null)
  const first = useRef(options)
  useEffect(() => {
    let cancelled = false
    createBoardRenderer(host.current!, first.current).then((r) => {
      if (cancelled) { r.destroy(); return }
      rRef.current = r
      ;(window as unknown as { __board: BoardRenderer }).__board = r // debug handle
      onReady(r)
    })
    return () => { cancelled = true; rRef.current?.destroy(); rRef.current = null; onReady(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { rRef.current?.setOptions(options) }, [options])
  return <div ref={host} style={{ position: 'absolute', inset: 0, ...style }} />
}

/** Fires onTap(x, y) for a short, still press on the canvas (CSS px relative to the canvas). */
export function useTaps(r: BoardRenderer | null, onTap: (x: number, y: number) => void) {
  const cb = useRef(onTap)
  cb.current = onTap
  useEffect(() => {
    if (!r) return
    const el = r.canvas
    let down: { x: number; y: number; t: number; id: number } | null = null
    const pos = (e: PointerEvent) => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
    const pd = (e: PointerEvent) => { const p = pos(e); down = { ...p, t: performance.now(), id: e.pointerId } }
    const pu = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return
      const p = pos(e)
      if (Math.hypot(p.x - down.x, p.y - down.y) < 10 && performance.now() - down.t < 500) cb.current(p.x, p.y)
      down = null
    }
    el.addEventListener('pointerdown', pd)
    el.addEventListener('pointerup', pu)
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('pointerup', pu) }
  }, [r])
}

/** Re-fits the camera on resize/rotation. */
export function useFit(r: BoardRenderer | null, area: () => { x: number; y: number; w: number; h: number } | undefined, deps: unknown[] = []) {
  const a = useRef(area)
  a.current = area
  useEffect(() => {
    if (!r) return
    const refit = () => r.setCamera(r.fit(a.current()))
    refit()
    ;(r as unknown as { onResize: () => void }).onResize = refit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, ...deps])
}

// ---------- tap test: "Tap DEBRECEN" x10, measures legibility + tap accuracy together ----------

interface TapResult { variant: string; hits: number; rounds: number; avgMs: number; wrong: string[] }
interface TapTestState {
  active: boolean
  target: number | null
  round: number
  hits: number
  flash: string | null
  results: TapResult[]
}
const ROUNDS = 10
const TapCtx = createContext<{ s: TapTestState; start: () => void; stop: () => void; pick: (id: number) => void }>(null!)

const loadResults = (): TapResult[] => { try { return JSON.parse(sessionStorage.getItem('tapResults') ?? '[]') } catch { return [] } }
const saveResults = (r: TapResult[]) => { try { sessionStorage.setItem('tapResults', JSON.stringify(r)) } catch { /* ignore */ } }

export function TapTestProvider({ variant, children }: { variant: string; children: ReactNode }) {
  const [s, setS] = useState<TapTestState>({ active: false, target: null, round: 0, hits: 0, flash: null, results: loadResults() })
  const t0 = useRef(0)
  const times = useRef<number[]>([])
  const wrong = useRef<string[]>([])
  const randomTarget = (prev: number | null) => { let t; do t = Math.floor(Math.random() * 32); while (t === prev); return t }

  const start = () => {
    times.current = []; wrong.current = []; t0.current = performance.now()
    setS((p) => ({ ...p, active: true, round: 1, hits: 0, target: randomTarget(null), flash: null }))
  }
  const stop = () => setS((p) => ({ ...p, active: false, target: null }))
  const sr = useRef(s)
  sr.current = s
  const pick = (id: number) => setS(next(sr.current, id))
  const next = (p: TapTestState, id: number): TapTestState => {
    if (!p.active || p.target === null) return p
    const ok = id === p.target
    times.current.push(performance.now() - t0.current)
    t0.current = performance.now()
    if (!ok) wrong.current.push(`${FIELDS[p.target].label}→${FIELDS[id].label}`)
    const hits = p.hits + (ok ? 1 : 0)
    const flash = ok ? '✓ hit' : `✗ that was ${FIELDS[id].label.toUpperCase()}`
    if (p.round >= ROUNDS) {
      const res: TapResult = { variant, hits, rounds: ROUNDS, avgMs: times.current.reduce((a, b) => a + b, 0) / times.current.length, wrong: wrong.current }
      const results = [...p.results, res]
      saveResults(results)
      return { ...p, active: false, target: null, hits, flash: `Done: ${hits}/${ROUNDS} hits, ${(res.avgMs / 1000).toFixed(1)} s avg`, results }
    }
    return { ...p, round: p.round + 1, hits, target: randomTarget(p.target), flash }
  }
  useEffect(() => {
    if (!s.flash) return
    const t = setTimeout(() => setS((p) => ({ ...p, flash: null })), s.active ? 900 : 4000)
    return () => clearTimeout(t)
  }, [s.flash, s.active])
  return <TapCtx.Provider value={{ s, start, stop, pick }}>{children}</TapCtx.Provider>
}
export const useTapTest = () => useContext(TapCtx)

export function TapBanner() {
  const { s, stop } = useTapTest()
  if (!s.active && !s.flash) return null
  return (
    <div className="banner" onClick={s.active ? undefined : undefined}>
      {s.active && s.target !== null && (
        <>
          <span className="muted">{s.round}/{ROUNDS} · {s.hits} hit</span>{' '}
          Tap <b>{FIELDS[s.target].label.toUpperCase()}</b>{' '}
          <button className="link" onClick={stop}>stop</button>
        </>
      )}
      {s.flash && <div className="flash">{s.flash}</div>}
    </div>
  )
}

// ---------- HUD: surfaces all renderer state + the toggles ----------

export function Hud({ r, options, setOptions, extra }: {
  r: BoardRenderer | null
  options: RenderOptions
  setOptions: (o: RenderOptions) => void
  extra?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [, force] = useState(0)
  const { s, start } = useTapTest()
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 500); return () => clearInterval(t) }, [])
  const st = r?.stats()
  const fpx = st?.fieldPx ?? 0
  const grade = (px: number) => (px >= 44 ? 'ok' : px >= 24 ? 'warn' : 'bad')
  const dpr = window.devicePixelRatio
  const set = (o: Partial<RenderOptions>) => setOptions({ ...options, ...o })

  return (
    <div className={`hud ${open ? 'open' : ''}`}>
      <button className="hud-pill" onClick={() => setOpen(!open)}>
        {st ? `${st.fps} fps · Field ` : '… '}
        {st && <span className={grade(fpx)}>{fpx.toFixed(0)} px</span>} {open ? '▴' : '▾'}
      </button>
      {open && st && (
        <div className="hud-body">
          <table><tbody>
            <tr><td>renderer</td><td>{st.renderer} · draw calls {st.drawCalls ?? 'n/a'}</td></tr>
            <tr><td>renders/s</td><td>{st.fps} · {st.renderMs.toFixed(2)} ms CPU/frame · worst gap {st.worstGapMs.toFixed(0)} ms</td></tr>
            <tr><td>viewport</td><td>{st.cssW}×{st.cssH} CSS · DPR {dpr} · res {st.resolution}</td></tr>
            <tr><td>zoom</td><td>{st.camera.scale.toFixed(3)} (1 = v1 desktop)</td></tr>
            <tr><td>Field width</td><td><span className={grade(fpx)}>{fpx.toFixed(1)} px</span> <span className="muted">(WCAG ≥24, Apple ≥44)</span></td></tr>
            <tr><td>label font</td><td><span className={st.labelPx >= 11 ? 'ok' : st.labelPx >= 8 ? 'warn' : 'bad'}>{st.labelPx.toFixed(1)} px</span> <span className="muted">(≥11 readable)</span></td></tr>
            <tr><td>textures</td><td>{st.textures} separate (no atlas)</td></tr>
          </tbody></table>
          <div className="row">
            <span>recolour</span>
            {(['baked', 'tint', 'filters'] as Recolor[]).map((m) => (
              <button key={m} className={options.recolor === m ? 'on' : ''} onClick={() => set({ recolor: m })}>
                {m === 'filters' ? 'v1 filters' : m}
              </button>
            ))}
          </div>
          <div className="row">
            <span>render</span>
            <button className={!options.continuous ? 'on' : ''} onClick={() => set({ continuous: false })}>on demand</button>
            <button className={options.continuous ? 'on' : ''} onClick={() => set({ continuous: true })}>every frame</button>
          </div>
          <div className="row">
            <span>resolution</span>
            {[...new Set([1, Math.min(2, dpr), dpr])].map((v) => (
              <button key={v} className={options.resolution === v ? 'on' : ''} onClick={() => set({ resolution: v })}>{v}</button>
            ))}
          </div>
          <div className="row">
            <button className={options.labels ? 'on' : ''} onClick={() => set({ labels: !options.labels })}>labels</button>
            <button className={options.walking ? 'on' : ''} onClick={() => set({ walking: !options.walking })}>walking Player</button>
          </div>
          {extra}
          <div className="row">
            <button className="primary" onClick={() => { start(); setOpen(false) }} disabled={s.active}>Start tap test (10 rounds)</button>
          </div>
          {s.results.length > 0 && (
            <table className="results"><tbody>
              {s.results.map((x, i) => (
                <tr key={i}><td>{x.variant}</td><td>{x.hits}/{x.rounds}</td><td>{(x.avgMs / 1000).toFixed(1)} s</td><td className="muted">{x.wrong.join(', ')}</td></tr>
              ))}
            </tbody></table>
          )}
          <div className="row muted">
            <a href="?page=pixi-react">@pixi/react binding check →</a>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- floating variant switcher (dev only) ----------

export function Switcher({ variants, current, onChange }: {
  variants: { key: string; name: string }[]
  current: string
  onChange: (k: string) => void
}) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current))
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]')) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!import.meta.env.DEV) return null
  return (
    <div className="switcher">
      <button onClick={() => go(-1)} aria-label="previous variant">‹</button>
      <span>{variants[i].key} · {variants[i].name}</span>
      <button onClick={() => go(1)} aria-label="next variant">›</button>
    </div>
  )
}

export function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    screen.orientation?.addEventListener?.('change', on)
    return () => { window.removeEventListener('resize', on); screen.orientation?.removeEventListener?.('change', on) }
  }, [])
  return { ...v, portrait: v.h > v.w }
}
