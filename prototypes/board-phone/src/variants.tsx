// PROTOTYPE, throwaway. Four structurally different phone layouts for the same Board.
//   A  Fit, tap direct      whole Board scaled to fit, tap the Field's diamond exactly (the baseline)
//   B  Zoom & pan           pinch / drag / +− buttons, follow the walking Player
//   C  Tap-to-inspect       fit Board, tap snaps to nearest Field, HTML card with ‹ Select ›
//   D  Landscape + panel    landscape only, Board left, Players and Field panel right

import { useEffect, useRef, useState } from 'react'
import type { BoardRenderer, Camera, RenderOptions } from './board/renderer'
import { FIELDS, GROUP_COLORS, KIND_NAME, MOCK_PLAYERS, PLAYER_COLORS, compact, fieldState, mockPrice, mockRent } from './board/data'
import { BoardCanvas, Hud, TapBanner, useFit, useTapTest, useTaps, useViewport } from './shared'

export interface VariantProps {
  options: RenderOptions
  setOptions: (o: RenderOptions) => void
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

function useFlash() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 1200); return () => clearTimeout(t) }, [msg])
  return [msg, setMsg] as const
}

// ---------------- A ----------------
export function VariantA({ options, setOptions }: VariantProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [msg, setMsg] = useFlash()
  const { pick } = useTapTest()
  useFit(r, () => undefined)
  useTaps(r, (x, y) => {
    const id = r!.fieldAt(x, y)
    r!.setSelected(id)
    setMsg(id === null ? 'missed: no Field there' : FIELDS[id].label.toUpperCase())
    if (id !== null) pick(id)
  })
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      {msg && <div className="toast">{msg}</div>}
      <TapBanner />
      <Hud r={r} options={options} setOptions={setOptions} />
    </div>
  )
}

// ---------------- B ----------------
export function VariantB({ options, setOptions }: VariantProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [follow, setFollow] = useState(false)
  const [msg, setMsg] = useFlash()
  const { pick } = useTapTest()
  const fitCam = useRef<Camera | null>(null)
  const followRef = useRef(follow)
  followRef.current = follow

  useEffect(() => {
    if (!r) return
    const refit = () => { fitCam.current = r.fit(); r.setCamera(fitCam.current) }
    refit()
    ;(r as unknown as { onResize: () => void }).onResize = refit
    const el = r.canvas
    const pts = new Map<number, { x: number; y: number }>()
    let g: { cam: Camera; mid: { x: number; y: number }; dist: number; moved: boolean; t: number; start: { x: number; y: number } } | null = null
    const local = (e: PointerEvent | WheelEvent) => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
    const minS = () => fitCam.current!.scale * 0.9
    const maxS = () => Math.max(1.6, fitCam.current!.scale * 2)
    const clampCam = (c: Camera): Camera => {
      const s = Math.min(maxS(), Math.max(minS(), c.scale))
      const { w, h } = r.boardSize
      const vw = el.clientWidth, vh = el.clientHeight
      const f = fitCam.current!
      // board centre in world units, derived from the fit camera
      const cx = (vw / 2 - f.x) / f.scale, cy = (vh / 2 - f.y) / f.scale
      const mx = Math.max(0, (w * s - vw) / 2 + vw * 0.25), my = Math.max(0, (h * s - vh) / 2 + vh * 0.25)
      const x = Math.min(vw / 2 - cx * s + mx, Math.max(vw / 2 - cx * s - mx, c.x))
      const y = Math.min(vh / 2 - cy * s + my, Math.max(vh / 2 - cy * s - my, c.y))
      return { scale: s, x, y }
    }
    const begin = () => {
      const p = [...pts.values()]
      const mid = p.length === 2 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0]
      const dist = p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0
      g = { cam: r.getCamera(), mid, dist, moved: g?.moved ?? false, t: g?.t ?? performance.now(), start: g?.start ?? mid }
    }
    const down = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); if (pts.size === 1) g = null; begin() }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !g) return
      pts.set(e.pointerId, local(e))
      const p = [...pts.values()]
      const mid = p.length >= 2 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0]
      if (Math.hypot(mid.x - g.start.x, mid.y - g.start.y) > 10 || p.length >= 2) { g.moved = true; setFollow(false) }
      if (!g.moved) return
      let s = g.cam.scale
      if (p.length >= 2 && g.dist > 0) s = g.cam.scale * (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / g.dist)
      s = Math.min(maxS(), Math.max(minS(), s))
      const wx = (g.mid.x - g.cam.x) / g.cam.scale, wy = (g.mid.y - g.cam.y) / g.cam.scale
      r.setCamera(clampCam({ scale: s, x: mid.x - wx * s, y: mid.y - wy * s }))
    }
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      const wasTap = g && !g.moved && pts.size === 1 && performance.now() - g.t < 500
      const at = local(e)
      pts.delete(e.pointerId)
      if (wasTap) {
        const id = r.fieldAt(at.x, at.y)
        r.setSelected(id)
        setMsg(id === null ? 'missed: no Field there' : FIELDS[id].label.toUpperCase())
        if (id !== null) pick(id)
      }
      if (pts.size > 0) begin()
      else g = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const c = r.getCamera(), m = local(e)
      const s = c.scale * Math.exp(-e.deltaY * 0.002)
      const wx = (m.x - c.x) / c.scale, wy = (m.y - c.y) / c.scale
      r.setCamera(clampCam({ scale: s, x: m.x - wx * s, y: m.y - wy * s }))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!followRef.current) return
      const c = r.getCamera()
      const p = r.playerPos(0)
      const dx = el.clientWidth / 2 - p.x, dy = el.clientHeight / 2 - p.y
      if (Math.abs(dx) + Math.abs(dy) > 0.5) r.setCamera(clampCam({ scale: c.scale, x: c.x + dx * 0.12, y: c.y + dy * 0.12 }))
    }
    raf = requestAnimationFrame(loop)
    ;(r as unknown as { _zoom: (k: number) => void })._zoom = (k: number) => {
      const c = r.getCamera(), m = { x: el.clientWidth / 2, y: el.clientHeight / 2 }
      const s = c.scale * k
      const wx = (m.x - c.x) / c.scale, wy = (m.y - c.y) / c.scale
      r.setCamera(clampCam({ scale: s, x: m.x - wx * s, y: m.y - wy * s }))
    }
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])

  const zoom = (k: number) => (r as unknown as { _zoom?: (k: number) => void })?._zoom?.(k)
  const toFit = () => { setFollow(false); if (r && fitCam.current) r.setCamera(fitCam.current) }
  const toFollow = () => {
    if (!r || !fitCam.current) return
    const c = r.getCamera()
    if (c.scale < fitCam.current.scale * 2) zoom((fitCam.current.scale * 2.6) / c.scale)
    setFollow(true)
  }

  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      <div className="cam-buttons">
        <button onClick={() => zoom(1.5)} aria-label="zoom in">＋</button>
        <button onClick={() => zoom(1 / 1.5)} aria-label="zoom out">－</button>
        <button onClick={toFit}>fit</button>
        <button className={follow ? 'on' : ''} onClick={toFollow}>follow</button>
      </div>
      {msg && <div className="toast">{msg}</div>}
      <TapBanner />
      <Hud r={r} options={options} setOptions={setOptions} />
    </div>
  )
}

// ---------------- C ----------------
function FieldCard({ id, onPrev, onNext, onSelect, onClose, compactLayout }: {
  id: number; onPrev: () => void; onNext: () => void; onSelect: () => void; onClose: () => void; compactLayout?: boolean
}) {
  const f = FIELDS[id]
  const st = fieldState(id)
  const owner = st.owner !== null ? MOCK_PLAYERS.find((p) => p.color === st.owner) : null
  const group = GROUP_COLORS[f.groupId]
  return (
    <div className={`card ${compactLayout ? 'compact' : ''}`}>
      <div className="card-stripe" style={{ background: group ? hex(group) : '#667' }} />
      <div className="card-head">
        <div>
          <div className="card-title">{f.label}</div>
          <div className="muted">{KIND_NAME[f.kind]} · Field {id}</div>
        </div>
        <button className="link" onClick={onClose} aria-label="close">✕</button>
      </div>
      {(f.kind === 'normal' || f.kind === 'museum') && (
        <div className="card-facts">
          <span>Price <b>{compact.format(mockPrice(id))}</b></span>
          <span>Level <b>{st.level}</b></span>
          <span>Rent <b>{st.level ? compact.format(mockRent(id, st.level)) : '–'}</b></span>
          <span>Owner {owner ? <b style={{ color: hex(PLAYER_COLORS[owner.color]) }}>{owner.name}</b> : <b>none</b>}</span>
        </div>
      )}
      <div className="card-actions">
        <button onClick={onPrev} aria-label="previous Field">‹</button>
        <button className="primary" onClick={onSelect}>Select this Field</button>
        <button onClick={onNext} aria-label="next Field">›</button>
      </div>
    </div>
  )
}

export function VariantC({ options, setOptions }: VariantProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [msg, setMsg] = useFlash()
  const { pick } = useTapTest()
  const vp = useViewport()
  const SHEET = 250
  useFit(r, () => (vp.portrait ? { x: 0, y: 0, w: vp.w, h: vp.h - SHEET - 56 } : undefined), [vp.portrait, vp.w, vp.h])
  useEffect(() => { r?.setSelected(sel) }, [r, sel])
  useTaps(r, (x, y) => {
    const n = r!.nearestField(x, y)
    setSel(n.dist < 70 ? n.id : null)
  })
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} />
      {sel !== null ? (
        <FieldCard
          id={sel}
          compactLayout={!vp.portrait}
          onPrev={() => setSel((sel + 31) % 32)}
          onNext={() => setSel((sel + 1) % 32)}
          onClose={() => setSel(null)}
          onSelect={() => { pick(sel); setMsg(`selected ${FIELDS[sel].label.toUpperCase()}`); setSel(null) }}
        />
      ) : (
        vp.portrait && <div className="card hint">Tap near any Field to inspect it.</div>
      )}
      {msg && <div className="toast">{msg}</div>}
      <TapBanner />
      <Hud r={r} options={options} setOptions={setOptions} />
    </div>
  )
}

// ---------------- D ----------------
export function VariantD({ options, setOptions }: VariantProps) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [force, setForce] = useState(false)
  const { pick } = useTapTest()
  const vp = useViewport()
  const PANEL = Math.min(230, Math.round(vp.w * 0.28))
  const landscape = !vp.portrait || force
  useFit(r, () => ({ x: 0, y: 0, w: vp.w - (landscape ? PANEL : 0), h: vp.h }), [vp.w, vp.h, landscape])
  useEffect(() => { r?.setSelected(sel) }, [r, sel])
  useTaps(r, (x, y) => {
    const n = r!.nearestField(x, y)
    if (n.dist < 40) { setSel(n.id); pick(n.id) }
  })
  const [err, alertless] = useState<string | null>(null)
  const fullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen?.()
      await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')
    } catch (e) { alertless(String(e)) }
  }
  const st = sel !== null ? fieldState(sel) : null
  return (
    <div className="screen">
      <BoardCanvas options={options} onReady={setR} style={{ right: landscape ? PANEL : 0 }} />
      {landscape && (
        <aside className="panel" style={{ width: PANEL }}>
          {MOCK_PLAYERS.map((p, i) => (
            <div key={p.name} className={`player ${i === 0 ? 'current' : ''}`}>
              <span className="dot" style={{ background: hex(PLAYER_COLORS[p.color]) }} />
              <span className="grow">{p.name}</span>
              <b>{compact.format(p.money)}</b>
            </div>
          ))}
          <div className="panel-field">
            {sel === null ? <span className="muted">Tap a Field</span> : (
              <>
                <div className="card-title">{FIELDS[sel].label}</div>
                <div className="muted">{KIND_NAME[FIELDS[sel].kind]}</div>
                {st && st.level > 0 && <div>Level {st.level} · rent {compact.format(mockRent(sel, st.level))}</div>}
              </>
            )}
          </div>
          <button className="primary" onClick={fullscreen}>Fullscreen</button>
        </aside>
      )}
      {!landscape && (
        <div className="rotate">
          <div className="rotate-icon">⟳</div>
          <div>Turn your phone sideways to play.</div>
          <button className="primary" onClick={fullscreen}>Fullscreen + lock landscape</button>
          <button className="link" onClick={() => setForce(true)}>show anyway</button>
          {err && <div className="muted small">{err}</div>}
        </div>
      )}
      <TapBanner />
      <Hud r={r} options={options} setOptions={setOptions} />
    </div>
  )
}
