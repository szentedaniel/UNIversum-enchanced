// PROTOTYPE, throwaway. Does @pixi/react 8.0.5 (react-reconciler 0.31 pin) run cleanly on React 19.3
// under StrictMode, across remounts, with state-driven updates? Same Board, declarative JSX.

import { Component, useEffect, useState, version as reactVersion, type ReactNode } from 'react'
import { Application, extend } from '@pixi/react'
import { Assets, Container, Sprite, Text, Texture, VERSION as pixiVersion } from 'pixi.js'
declare const __PIXI_REACT_VERSION__: string
import { FIELDS, G, GROUP_COLORS, PLAYER_COLORS, PLAYER_SPRITES, MOCK_PLAYERS, calcCoords, isCorner, fieldState } from './board/data'

extend({ Container, Sprite, Text })

const W = 129 / 2, H = 96 / 2, B = 32
const log: string[] = []
const listeners = new Set<() => void>()
const push = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); listeners.forEach((l) => l()) }

if (typeof window !== 'undefined' && !(window as unknown as { __hooked?: boolean }).__hooked) {
  ;(window as unknown as { __hooked?: boolean }).__hooked = true
  window.addEventListener('error', (e) => push(`window.error: ${e.message}`))
  window.addEventListener('unhandledrejection', (e) => push(`unhandledrejection: ${String(e.reason)}`))
  const ce = console.error.bind(console)
  console.error = (...a: unknown[]) => { push(`console.error: ${a.map(String).join(' ').slice(0, 240)}`); ce(...a) }
  const cw = console.warn.bind(console)
  console.warn = (...a: unknown[]) => { push(`console.warn: ${a.map(String).join(' ').slice(0, 240)}`); cw(...a) }
}

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: Error) { return { err: e.message } }
  componentDidCatch(e: Error) { push(`render error: ${e.message}`) }
  render() { return this.state.err ? <div className="pr-error">Crashed: {this.state.err}</div> : this.props.children }
}

function Board({ tex, levels, scale, x, y }: { tex: Record<string, Texture>; levels: Record<number, number>; scale: number; x: number; y: number }) {
  return (
    <pixiContainer x={x} y={y} scale={scale}>
      <pixiContainer scale={{ x: 1, y: G.boardScaleY }} sortableChildren>
        {FIELDS.map((f) => {
          const p = calcCoords(f.id)
          const corner = isCorner(f.kind)
          const st = fieldState(f.id)
          const level = levels[f.id] ?? st.level
          return (
            <pixiContainer key={f.id} x={p.x} y={p.y} zIndex={f.zIndex} sortableChildren
              scale={{ x: (corner ? 1 : f.flip ? -1 : 1) * G.scale, y: G.scale }}>
              {!corner && <>
                <pixiSprite texture={tex.label_bg} anchor={0.5} x={-W} y={H + H / 2} zIndex={2} tint={GROUP_COLORS[f.groupId] ?? 0xffffff} />
                <pixiSprite texture={tex.label_bg} anchor={0.5} x={-W * 2 + 1} y={-B + H + H / 2} zIndex={1} tint={GROUP_COLORS[f.groupId] ?? 0xffffff} />
              </>}
              <pixiSprite texture={tex.ground} anchor={0.5} x={0} y={-B + H + H / 2} zIndex={0} />
              <pixiSprite texture={tex.ground} anchor={0.5} x={-W} y={-B * 2 + H + H / 2} zIndex={-1} />
              <pixiSprite texture={tex.ground} anchor={0.5} x={0} y={-B * 3 + H + H / 2} zIndex={-2} />
              <pixiSprite texture={tex.ground} anchor={0.5} x={W} y={-B * 2 + H + H / 2} zIndex={-1} />
              {!corner && (
                <pixiContainer zIndex={90} x={-50} y={14} rotation={Math.PI / 6.66667} scale={{ x: 1, y: 1.2 }}>
                  <pixiText text={f.label.toUpperCase()} anchor={0.5} skew={{ x: -Math.PI / 4, y: 0 }} scale={{ x: f.flip ? -1 : 1, y: 1 }}
                    style={{ fontFamily: 'Arial', fontSize: 22, fontWeight: 'bold', fill: '#000', stroke: { color: '#eee', width: 4 } }} />
                </pixiContainer>
              )}
              {f.kind === 'normal' && st.owner !== null && level > 0 && (
                <pixiContainer zIndex={10} x={W / 4} y={-B}>
                  {Array.from({ length: level }, (_, i) => (
                    <pixiSprite key={i} texture={i === 0 ? tex.haz_alap : tex.haz_resz} anchor={0.5} y={i === 0 ? -1 : -32 * i}
                      scale={{ x: f.flip ? 1 : -1, y: 1 }} tint={PLAYER_COLORS[st.owner!]} />
                  ))}
                  <pixiSprite texture={tex.haz_teto} anchor={0.5} y={-32 * level + 16} scale={{ x: f.flip ? 1 : -1, y: 1 }} tint={PLAYER_COLORS[st.owner!]} />
                </pixiContainer>
              )}
            </pixiContainer>
          )
        })}
        {MOCK_PLAYERS.map((p, i) => {
          const c = calcCoords(p.field)
          return <pixiSprite key={p.name} texture={tex[PLAYER_SPRITES[p.color]]} anchor={{ x: 0.5, y: 0.7 }} x={c.x - [15, 5, -5, -15][i]} y={c.y} zIndex={1000} />
        })}
      </pixiContainer>
    </pixiContainer>
  )
}

export function PixiReactCheck() {
  const [tex, setTex] = useState<Record<string, Texture> | null>(null)
  const [key, setKey] = useState(0)
  const [mounted, setMounted] = useState(true)
  const [mutate, setMutate] = useState(false)
  const [levels, setLevels] = useState<Record<number, number>>({})
  const [, force] = useState(0)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l) } }, [])
  useEffect(() => { const on = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  useEffect(() => {
    const names = ['label_bg', 'ground', 'haz_alap', 'haz_resz', 'haz_teto', ...PLAYER_SPRITES]
    Assets.load(names.map((a) => ({ alias: a, src: `/board/${a}.png` }))).then(() => {
      setTex(Object.fromEntries(names.map((n) => [n, Assets.get(n)])))
      push('textures loaded')
    })
  }, [])
  useEffect(() => {
    if (!mutate) return
    const t = setInterval(() => setLevels((l) => { const id = [1, 2, 3, 5, 9, 10, 13, 26][Math.floor(Math.random() * 8)]; return { ...l, [id]: 1 + Math.floor(Math.random() * 5) } }), 400)
    return () => clearInterval(t)
  }, [mutate])

  const boardH = Math.max(200, vp.h - 230)
  const scale = Math.min((vp.w - 16) / 1650, (boardH - 16) / 1000)

  return (
    <div className="pr">
      <div className="pr-bar">
        <a href="?">← variants</a>
        <b>@pixi/react check</b>
        <span className="muted">react {reactVersion} · pixi.js {pixiVersion} · @pixi/react {__PIXI_REACT_VERSION__} · StrictMode on</span>
      </div>
      <div className="pr-stage" style={{ height: boardH }}>
        {tex && mounted && (
          <Boundary key={key}>
            <Application width={vp.w} height={boardH} backgroundAlpha={0} resolution={Math.min(2, devicePixelRatio)} autoDensity
              onInit={() => push(`Application init (mount #${key + 1})`)}>
              <Board tex={tex} levels={levels} scale={scale} x={vp.w / 2} y={boardH / 2} />
            </Application>
          </Boundary>
        )}
      </div>
      <div className="row pr-controls">
        <button onClick={() => { setKey((k) => k + 1); push('remount') }}>Remount</button>
        <button onClick={() => { setMounted((m) => !m); push(mounted ? 'unmount' : 'mount') }}>{mounted ? 'Unmount' : 'Mount'}</button>
        <button className={mutate ? 'on' : ''} onClick={() => setMutate(!mutate)}>live level updates</button>
      </div>
      <pre className="pr-log">{log.length ? log.slice(-40).join('\n') : 'no events yet'}</pre>
    </div>
  )
}
