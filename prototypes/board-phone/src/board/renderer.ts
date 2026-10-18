// PROTOTYPE, throwaway. Imperative PixiJS v8 Board renderer (research option B):
// one Application, a camera Container, 32 Field containers rebuilt from v1's sprite stacks.
// Own rAF loop so "continuous" vs "render on demand" and frame cost can be measured.

import {
  Application, Assets, Container, Graphics, Point, Polygon, Rectangle, Sprite, Text, Texture,
  type Filter, type TextStyleOptions,
} from 'pixi.js'
import { ColorReplaceFilter, DropShadowFilter } from 'pixi-filters'
import {
  FIELDS, GROUP_COLORS, MOCK_PLAYERS, PLAYER_COLORS, PLAYER_SPRITES, WIDTH_NORMAL, G,
  calcCoords, compact, fieldState, isCorner, mockRent, type FieldDef,
} from './data'

export type Recolor = 'baked' | 'tint' | 'filters'

export interface RenderOptions {
  recolor: Recolor
  labels: boolean
  walking: boolean
  continuous: boolean
  resolution: number
}

export interface Camera { scale: number; x: number; y: number }

export interface Stats {
  renderer: string
  fps: number
  renderMs: number
  worstGapMs: number
  drawCalls: number | null
  resolution: number
  cssW: number
  cssH: number
  camera: Camera
  fieldPx: number
  labelPx: number
  textures: number
}

const ASSETS = [
  'label_bg', 'ground', 'road', 'road_left', 'road_right', 'road_top', 'haz_alap', 'haz_resz', 'haz_teto',
  'museum', 'karibacsik', 'erasmus', 'diploma', 'tabla', 'chest_E', 'chest_N', 'ado2', 'doubler',
  ...PLAYER_SPRITES,
]

const H = 96 / 2
const B = 32
const W = 129 / 2

const LABEL_STYLE: TextStyleOptions = {
  align: 'center', fontFamily: 'Arial', fill: '#000000', fontSize: 22, fontWeight: 'bold',
  stroke: { color: '#eeeeee', width: 4, join: 'round' }, wordWrap: true, wordWrapWidth: 150, lineHeight: 30,
}
const PRICE_STYLE: TextStyleOptions = { ...LABEL_STYLE, fontSize: 45 }
const CORNER_STYLE: TextStyleOptions = {
  align: 'center', fontFamily: 'Arial', fill: '#ffffff', fontSize: 40, fontWeight: 'lighter',
  stroke: { color: '#555555', width: 10, join: 'round' }, wordWrap: true, wordWrapWidth: 200,
  dropShadow: { alpha: 0.8, angle: 2.1, blur: 2, color: '#111111', distance: 6 },
}

// ---- ColorReplaceFilter baked on the CPU once (stand-in for pre-coloured atlas frames) ----
function bake(tex: Texture, original: number, target: number, tolerance: number): Texture {
  const src = tex.source.resource as CanvasImageSource
  const w = tex.source.width, h = tex.source.height
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const o = [((original >> 16) & 255) / 255, ((original >> 8) & 255) / 255, (original & 255) / 255]
  const t = [((target >> 16) & 255) / 255, ((target >> 8) & 255) / 255, (target & 255) / 255]
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
    const dr = o[0] - r, dg = o[1] - g, db = o[2] - b
    if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance) {
      d[i] = Math.max(0, Math.min(255, (t[0] + dr) * 255))
      d[i + 1] = Math.max(0, Math.min(255, (t[1] + dg) * 255))
      d[i + 2] = Math.max(0, Math.min(255, (t[2] + db) * 255))
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(c)
}

function hull(pts: number[][]): number[][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: number[][] = [], up: number[][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

interface FieldNode {
  def: FieldDef
  c: Container
  hit: Polygon
  center: Point
  outline: Graphics
  hullPts: number[]
  texts: Text[]
  baseY: number
}

export interface BoardRenderer {
  readonly canvas: HTMLCanvasElement
  readonly boardSize: { w: number; h: number }
  fit(area?: { x: number; y: number; w: number; h: number }, pad?: number): Camera
  setCamera(cam: Camera): void
  getCamera(): Camera
  fieldAt(x: number, y: number): number | null
  nearestField(x: number, y: number): { id: number; dist: number }
  fieldCenter(id: number): { x: number; y: number }
  playerPos(i: number): { x: number; y: number }
  walkerField(): number
  setSelected(id: number | null): void
  setOptions(o: Partial<RenderOptions>): void
  getOptions(): RenderOptions
  stats(): Stats
  invalidate(): void
  destroy(): void
}

export async function createBoardRenderer(host: HTMLElement, initial: RenderOptions): Promise<BoardRenderer> {
  let opts = { ...initial }
  const app = new Application()
  await app.init({
    width: host.clientWidth, height: host.clientHeight, resolution: opts.resolution, autoDensity: true,
    antialias: new URLSearchParams(location.search).get('aa') === '1', backgroundAlpha: 0,
    autoStart: false, preference: (new URLSearchParams(location.search).get('gpu') as 'webgpu') ?? 'webgl',
  })
  app.ticker.stop()
  const canvas = app.canvas
  canvas.style.display = 'block'
  canvas.style.touchAction = 'none'
  host.appendChild(canvas)

  // draw-call counter (WebGL only)
  let drawCallsThisFrame = 0, lastDrawCalls: number | null = null
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl
  if (gl) {
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const orig = (gl[fn] as (...a: unknown[]) => void).bind(gl)
      ;(gl as unknown as Record<string, unknown>)[fn] = (...a: unknown[]) => { drawCallsThisFrame++; orig(...a) }
    }
  }

  const tex: Record<string, Texture> = {}
  await Assets.load(ASSETS.map((a) => ({ alias: a, src: `/board/${a}.png` })))
  for (const a of ASSETS) tex[a] = Assets.get(a)
  const bakedLabel: Record<number, Texture> = {}
  for (const [g, col] of Object.entries(GROUP_COLORS)) bakedLabel[+g] = bake(tex.label_bg, 0xc2beac, col, 0.095)
  const bakedHouse: Record<string, Texture> = {}
  PLAYER_COLORS.forEach((col, i) => {
    for (const part of ['haz_alap', 'haz_resz', 'haz_teto']) bakedHouse[`${part}_${i}`] = bake(tex[part], 0x8ab549, col, 1)
  })

  const world = new Container()
  const board = new Container({ sortableChildren: true })
  board.scale.set(1, G.boardScaleY)
  world.addChild(board)
  app.stage.addChild(world)

  let fields: FieldNode[] = []
  let players: Sprite[] = []
  let selected: number | null = null
  let cam: Camera = { scale: 1, x: 0, y: 0 }
  let dirty = true
  let boardSize = { w: 1, h: 1 }
  let boardBounds = new Rectangle()
  const filterPool: Filter[] = []

  const groupFilter = (groupId: number) => {
    const f = new ColorReplaceFilter({ originalColor: 0xc2beac, targetColor: GROUP_COLORS[groupId], tolerance: 0.095 })
    filterPool.push(f)
    return f
  }
  const ownerFilter = (owner: number) => {
    const f = new ColorReplaceFilter({ originalColor: 0x8ab549, targetColor: PLAYER_COLORS[owner], tolerance: 1 })
    filterPool.push(f)
    return f
  }

  function labelSprite(def: FieldDef, x: number, y: number, z: number) {
    const s = new Sprite({ texture: tex.label_bg, anchor: 0.5, x, y, zIndex: z })
    if (def.groupId) {
      if (opts.recolor === 'baked') s.texture = bakedLabel[def.groupId]
      else if (opts.recolor === 'tint') s.tint = GROUP_COLORS[def.groupId]
      else s.filters = [groupFilter(def.groupId)]
    }
    return s
  }

  function tiltedText(text: string, style: TextStyleOptions, x: number, y: number, flip: boolean, texts: Text[]) {
    const wrap = new Container({ zIndex: 90, x, y, rotation: Math.PI / 6.66667 })
    wrap.scale.set(1, 1.2)
    const t = new Text({ text, style, anchor: 0.5 })
    t.skew.set(-Math.PI / 4, 0)
    t.scale.set(flip ? -1 : 1, 1)
    wrap.addChild(t)
    texts.push(t)
    return wrap
  }

  function building(level: number, owner: number, flip: boolean) {
    const c = new Container({ zIndex: 10, x: W / 4, y: -B })
    const add = (part: string, y: number) => {
      const s = new Sprite({ texture: tex[part], anchor: 0.5, y })
      s.scale.set(flip ? 1 : -1, 1)
      if (opts.recolor === 'baked') s.texture = bakedHouse[`${part}_${owner}`]
      else if (opts.recolor === 'tint') s.tint = PLAYER_COLORS[owner]
      else s.filters = [ownerFilter(owner)]
      c.addChild(s)
    }
    for (let i = 0; i < level; i++) add(i === 0 ? 'haz_alap' : 'haz_resz', i === 0 ? -1 : -32 * i)
    if (level > 0) add('haz_teto', -32 * level + 16)
    return c
  }

  function buildField(def: FieldDef): FieldNode {
    const c = new Container({ sortableChildren: true, zIndex: def.zIndex })
    const pos = calcCoords(def.id)
    c.position.set(pos.x, pos.y)
    const corner = isCorner(def.kind)
    c.scale.set((corner ? 1 : def.flip ? -1 : 1) * G.scale, G.scale)
    const texts: Text[] = []
    const tiles: [number, number][] = []
    const tile = (t: Texture | Sprite, x: number, y: number, z: number) => {
      const s = t instanceof Sprite ? t : new Sprite({ texture: t, anchor: 0.5, x, y, zIndex: z })
      tiles.push([x, y])
      c.addChild(s)
    }
    const st = fieldState(def.id)

    if (corner) {
      const start = def.kind === 'start'
      const edge = start ? tex.label_bg : tex.road
      tile(edge, -W, H, 2); tile(edge, -W * 2, -B + H, 1); tile(edge, 0, B + H, 3)
      tile(edge, W, H, 2); tile(edge, W * 2, -B + H, 1)
      tile(tex.road, 0, -B + H, 0)
      tile(start ? tex.road_left : tex.road, -W, -B * 2 + H, -1)
      tile(start ? tex.road_top : tex.road, 0, -B * 3 + H, -2)
      tile(start ? tex.road_right : tex.road, W, -B * 2 + H, -1)
      const feat = (t: string, sx: number, sy: number, x: number, y: number) => {
        const s = new Sprite({ texture: tex[t], anchor: 0.5, x, y, zIndex: 3 })
        s.scale.set(sx, sy)
        c.addChild(s)
      }
      if (def.kind === 'quarantine') feat('karibacsik', 0.2, 0.2, -W * 1.25, -H * 1.25)
      if (def.kind === 'erasmus') feat('erasmus', -0.5, 0.5, 0, -B / 2)
      if (def.kind === 'doubler') feat('diploma', 0.5, 0.5, 0, -B - 20)
      if (def.kind === 'start') feat('tabla', 1, 1, 0, -B - H * 1.6)
      if (opts.labels && !start) {
        const t = new Text({ text: def.label, style: CORNER_STYLE, anchor: 0.5, zIndex: 90 })
        texts.push(t)
        c.addChild(t)
      }
    } else {
      tile(labelSprite(def, -W, H + H / 2, 2), -W, H + H / 2, 2)
      tile(labelSprite(def, -W * 2 + 1, -B + H + H / 2, 1), -W * 2 + 1, -B + H + H / 2, 1)
      tile(tex.ground, 0, -B + H + H / 2, 0)
      tile(tex.ground, -W, -B * 2 + H + H / 2, -1)
      tile(tex.ground, 0, -B * 3 + H + H / 2, -2)
      tile(tex.ground, W, -B * 2 + H + H / 2, -1)
      if (opts.labels) {
        const long = def.label.includes(' ') && def.label.length > 9
        c.addChild(tiltedText(def.label.toUpperCase(), LABEL_STYLE, long ? -33 : -50, long ? 7 : 14, def.flip, texts))
        const rent = mockRent(def.id, st.level)
        if (rent) c.addChild(tiltedText(compact.format(rent), PRICE_STYLE, -105, 43, def.flip, texts))
      }
      if (def.kind === 'normal' && st.owner !== null && st.level > 0) c.addChild(building(st.level, st.owner, def.flip))
      if (def.kind === 'museum') {
        const s = new Sprite({ texture: tex.museum, anchor: 0.5, x: W / 3, y: -H * 1.27, zIndex: 3, scale: 0.26 })
        if (st.owner !== null) {
          if (opts.recolor === 'tint') s.tint = PLAYER_COLORS[st.owner]
          else if (opts.recolor === 'filters') s.filters = [ownerFilter(st.owner)]
        }
        c.addChild(s)
      }
      if (def.kind === 'chance') {
        const s = new Sprite({ texture: def.flip ? tex.chest_E : tex.chest_N, anchor: 0.5, x: W / 6, y: -H * 0.8, zIndex: 10 })
        s.scale.set((def.flip ? -1 : 1) * -0.7, 0.7)
        c.addChild(s)
      }
      if (def.kind === 'tax') {
        const s = new Sprite({ texture: tex.ado2, anchor: 0.5, x: W / 6, y: -H * 0.6, zIndex: 10 })
        s.scale.set(-0.5, 0.5)
        c.addChild(s)
      }
    }

    // hit area: hull of each tile's top-face diamond (132x99 Kenney tile, face is the top 66 px)
    const pts: number[][] = []
    for (const [x, y] of tiles) pts.push([x, y - 49.5], [x + 66, y - 16.5], [x, y + 16.5], [x - 66, y - 16.5])
    const h = hull(pts)
    const hit = new Polygon(h.flat())
    const xs = h.map((p) => p[0]), ys = h.map((p) => p[1])
    const center = new Point((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)
    const outline = new Graphics({ zIndex: 95, visible: false })
    c.addChild(outline)
    board.addChild(c)
    return { def, c, hit, center, outline, hullPts: h.flat(), texts, baseY: pos.y }
  }

  // ---- players: one walker (Player 0) steps one Field per 300 ms, like v1 ----
  const playerFields = MOCK_PLAYERS.map((p) => p.field)
  const offsets = [15, 5, -5, -15]
  const walk = { from: 0, to: 0, t0: 0, next: 0, stepsLeft: 0, moving: false }

  function placePlayer(i: number, at: { x: number; y: number }) {
    players[i].position.set(at.x - offsets[i], at.y)
  }

  function build() {
    for (const f of filterPool.splice(0)) f.destroy()
    board.removeChildren().forEach((c) => c.destroy({ children: true }))
    fields = FIELDS.map(buildField)
    players = MOCK_PLAYERS.map((p, i) => {
      const s = new Sprite({ texture: tex[PLAYER_SPRITES[p.color]], anchor: { x: 0.5, y: 0.7 }, zIndex: 1000, alpha: i === 0 ? 1 : 0.7 })
      board.addChild(s)
      return s
    })
    players.forEach((_, i) => placePlayer(i, calcCoords(playerFields[i])))
    board.filters = opts.recolor === 'filters' ? [new DropShadowFilter({ offset: { x: 4, y: 4 } })] : []
    if (board.filters.length) filterPool.push(...board.filters)
    applySelected()
    // measure without players so the walker doesn't change the fit
    players.forEach((p) => (p.visible = false))
    boardBounds = world.getLocalBounds().rectangle.clone()
    players.forEach((p) => (p.visible = true))
    boardSize = { w: boardBounds.width, h: boardBounds.height }
    applyCamera()
  }

  function applySelected() {
    for (const f of fields) {
      const on = f.def.id === selected
      f.outline.visible = on
      if (on) {
        // constant ~3 screen px whatever the zoom
        const w = 3 / (cam.scale * G.scale)
        f.outline.clear().poly(f.hullPts).fill({ color: 0xffffff, alpha: 0.3 }).stroke({ width: w, color: 0xffe14d })
      }
      f.c.y = f.baseY - (on ? 15 : 0)
      f.c.zIndex = on ? 500 : f.def.zIndex
    }
    dirty = true
  }

  let textTimer = 0
  function applyCamera() {
    world.scale.set(cam.scale)
    world.position.set(cam.x, cam.y)
    if (selected !== null) applySelected()
    dirty = true
    // keep label text sharp: re-rasterise at the zoom level once the camera settles
    clearTimeout(textTimer)
    textTimer = window.setTimeout(() => {
      const res = Math.min(4, Math.max(0.5, opts.resolution * cam.scale * G.scale * 1.2))
      for (const f of fields) for (const t of f.texts) t.resolution = res
      dirty = true
    }, 120)
  }

  // ---- frame loop & stats ----
  const frames: number[] = []
  const gaps: { t: number; gap: number }[] = []
  let renderMsAvg = 0, lastRaf = 0, raf = 0

  function tick(now: number) {
    raf = requestAnimationFrame(tick)
    if (lastRaf) gaps.push({ t: now, gap: now - lastRaf })
    lastRaf = now
    while (gaps.length && gaps[0].t < now - 5000) gaps.shift()

    if (opts.walking) {
      if (!walk.moving && now >= walk.next) {
        if (walk.stepsLeft <= 0) walk.stepsLeft = 2 + Math.floor(Math.random() * 11)
        walk.from = playerFields[0]; walk.to = (walk.from + 1) % 32; walk.t0 = now; walk.moving = true
      }
      if (walk.moving) {
        const k = Math.min(1, (now - walk.t0) / 300)
        const a = calcCoords(walk.from), b = calcCoords(walk.to)
        const hop = Math.sin(k * Math.PI) * 18
        placePlayer(0, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - hop })
        dirty = true
        if (k >= 1) {
          playerFields[0] = walk.to; walk.moving = false; walk.stepsLeft--
          walk.next = now + (walk.stepsLeft > 0 ? 0 : 900)
        }
      }
    }

    if (opts.continuous || dirty) {
      drawCallsThisFrame = 0
      const t0 = performance.now()
      app.render()
      const ms = performance.now() - t0
      renderMsAvg = renderMsAvg * 0.9 + ms * 0.1
      lastDrawCalls = gl ? drawCallsThisFrame : null
      frames.push(now)
      dirty = false
    }
    while (frames.length && frames[0] < now - 1000) frames.shift()
  }

  const ro = new ResizeObserver(() => {
    app.renderer.resize(host.clientWidth, host.clientHeight, opts.resolution)
    dirty = true
    onResize?.()
  })
  let onResize: (() => void) | undefined

  build()
  ro.observe(host)
  raf = requestAnimationFrame(tick)

  const toLocalIn = (c: Container, x: number, y: number) => c.toLocal(new Point(x, y))

  const api: BoardRenderer & { set onResize(f: () => void) } = {
    canvas,
    get boardSize() { return boardSize },
    set onResize(f: () => void) { onResize = f },
    fit(area, pad = 8) {
      const a = area ?? { x: 0, y: 0, w: host.clientWidth, h: host.clientHeight }
      const s = Math.min((a.w - pad * 2) / boardBounds.width, (a.h - pad * 2) / boardBounds.height)
      const c = {
        scale: s,
        x: a.x + a.w / 2 - (boardBounds.x + boardBounds.width / 2) * s,
        y: a.y + a.h / 2 - (boardBounds.y + boardBounds.height / 2) * s,
      }
      return c
    },
    setCamera(c) { cam = { ...c }; applyCamera() },
    getCamera() { return { ...cam } },
    fieldAt(x, y) {
      let best: number | null = null, bestD = Infinity
      for (const f of fields) {
        const p = toLocalIn(f.c, x, y)
        if (f.hit.contains(p.x, p.y)) {
          const d = (p.x - f.center.x) ** 2 + (p.y - f.center.y) ** 2
          if (d < bestD) { bestD = d; best = f.def.id }
        }
      }
      return best
    },
    nearestField(x, y) {
      let id = 0, dist = Infinity
      for (const f of fields) {
        const g = f.c.toGlobal(f.center)
        const d = Math.hypot(g.x - x, g.y - y)
        if (d < dist) { dist = d; id = f.def.id }
      }
      return { id, dist }
    },
    fieldCenter(id) { const f = fields[id]; const g = f.c.toGlobal(f.center); return { x: g.x, y: g.y } },
    playerPos(i) { const g = players[i].getGlobalPosition(); return { x: g.x, y: g.y } },
    walkerField() { return playerFields[0] },
    setSelected(id) { selected = id; applySelected() },
    setOptions(o) {
      const rebuild = (o.recolor !== undefined && o.recolor !== opts.recolor) || (o.labels !== undefined && o.labels !== opts.labels)
      const resChanged = o.resolution !== undefined && o.resolution !== opts.resolution
      opts = { ...opts, ...o }
      if (resChanged) app.renderer.resize(host.clientWidth, host.clientHeight, opts.resolution)
      if (rebuild) build()
      if (resChanged) applyCamera()
      dirty = true
    },
    getOptions() { return { ...opts } },
    stats() {
      return {
        renderer: app.renderer.name,
        fps: frames.length,
        renderMs: renderMsAvg,
        worstGapMs: gaps.reduce((m, g) => Math.max(m, g.gap), 0),
        drawCalls: lastDrawCalls,
        resolution: opts.resolution,
        cssW: host.clientWidth,
        cssH: host.clientHeight,
        camera: { ...cam },
        fieldPx: WIDTH_NORMAL * cam.scale,
        labelPx: 22 * G.scale * 1.2 * cam.scale,
        textures: opts.recolor === 'baked' ? ASSETS.length + 8 + 12 : ASSETS.length,
      }
    },
    invalidate() { dirty = true },
    destroy() {
      cancelAnimationFrame(raf)
      clearTimeout(textTimer)
      ro.disconnect()
      app.destroy({ removeView: true }, { children: true })
    },
  }
  return api
}
