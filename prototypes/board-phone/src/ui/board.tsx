// PROTOTYPE, throwaway: the game screen's Board seam, shared by the three directions (ticket #16).
// Behaviour is fixed by earlier tickets (#14 camera + tap-to-inspect, #15 tap-toggles pick); only the chrome differs.

import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { BoardRenderer } from '../board/renderer'
import { BoardCanvas } from '../shared'
import { useZoomPan } from '../variants'
import { SALE_IDS, type SalePick } from './model'
import { boardOptions, DIRS, inkOn, type Dir, type Theme } from './dirs'

type Area = { x: number; y: number; w: number; h: number }
export type GameMode = 'inspect' | 'sale'

export function useGameBoard(o: {
  dir: Dir; theme: Theme; mode: GameMode; sale: SalePick
  fitArea: () => Area | undefined; fitDeps: unknown[]
  /** the card / tray: a focused Field hidden under it makes the camera pan (never zoom) */
  obstacle: RefObject<HTMLElement | null>
}) {
  const [r, setR] = useState<BoardRenderer | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const options = useMemo(() => boardOptions(o.dir, o.theme), [o.dir, o.theme])
  const cam = useZoomPan(r, (x, y) => {
    if (!r) return
    const reach = Math.max(70, r.stats().fieldPx)
    if (o.mode === 'sale') {
      let best: number | null = null, bd = Infinity
      for (const id of SALE_IDS) { const c = r.fieldCenter(id); const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = id } }
      if (best !== null && bd < reach * 1.4) o.sale.toggle(best)
      return
    }
    const n = r.nearestField(x, y)
    setSel(n.dist < reach ? n.id : null)
  }, o.fitArea, o.fitDeps)

  useEffect(() => { r?.setMarks(o.mode === 'sale' ? o.sale.marks : {}) }, [r, o.mode, o.sale.marks])
  useEffect(() => { if (o.mode === 'sale') setSel(null) }, [o.mode])
  useEffect(() => {
    if (!r) return
    r.setSelected(sel)
    if (sel === null) return
    const raf = requestAnimationFrame(() => {
      const ob = o.obstacle.current?.getBoundingClientRect()
      const cv = r.canvas.getBoundingClientRect()
      const c = r.fieldCenter(sel)
      const m = 24
      const gx = c.x + cv.left, gy = c.y + cv.top
      const under = ob && gx > ob.left - m && gx < ob.right + m && gy > ob.top - m && gy < ob.bottom + m
      const off = c.x < m || c.y < m || c.x > cv.width - m || c.y > cv.height - m
      if (under || off) {
        const a = o.fitArea() ?? { x: 0, y: 0, w: cv.width, h: cv.height }
        cam.panTo(c, { x: a.x + a.w / 2, y: a.y + a.h / 2 })
      }
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, sel])

  const board = <BoardCanvas options={options} onReady={setR} />
  return { r, board, sel, setSel, cam }
}

/** A Player's token: their colour plus the direction's non-colour cue (Seat number / shape / initial). */
export function Token({ dir, theme, p, size = 22, className = '', ring }: { dir: Dir; theme: Theme; p: number; size?: number; className?: string; ring?: string }) {
  const m = DIRS[dir]
  const bg = m.players[theme][p]
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ${className}`}
      style={{ width: size, height: size, background: bg, color: inkOn(bg), fontSize: size * 0.5, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
      aria-hidden
    >{m.badge[p]}</span>
  )
}

export const ALIENS = ['alienPink', 'alienBlue', 'alienGreen', 'alienYellow']
export const alien = (p: number) => `/board/${ALIENS[p]}.png`
export const hexOf = (n: number) => '#' + n.toString(16).padStart(6, '0')
