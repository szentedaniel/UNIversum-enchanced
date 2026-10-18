// PROTOTYPE, throwaway: UI visual direction (map ticket "Prototype: UI visual direction", #16).
// Three directions × six screens, on /ui.html:
//   ?dir=a|b|c        A Yearbook · B Tabletop · C Campus HUD   (‹ › in the bottom bar, or ← →)
//   ?screen=list|lobby|game|sale|result|tokens
//   ?theme=light|dark (default: the OS setting) · ?lang=en|hu|de · ?cvd=protan|deutan|tritan|achroma
//   ?frame=devices|themes  side-by-side iframes (phone 390×844 + desktop 1440×900, or desktop light + dark)
// Mock state only; nothing is sent anywhere.

import { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DIRS, SCREENS, type Dir, type Screen, type ScreenProps, type Theme } from './dirs'
import type { Cvd, Lang } from './model'
import { CVD_MATRIX } from './model'
import { GameA, LobbyA, LobbyListA } from './dirA'
import { GameB, LobbyB, LobbyListB } from './dirB'
import { GameC, LobbyC, LobbyListC } from './dirC'
import { TokensPage } from './tokens'
import './ui.css'

const KEYS: Dir[] = ['a', 'b', 'c']
const SCREEN_OF = {
  a: { list: LobbyListA, lobby: LobbyA, game: GameA },
  b: { list: LobbyListB, lobby: LobbyB, game: GameB },
  c: { list: LobbyListC, lobby: LobbyC, game: GameC },
}

function useParam<T extends string>(k: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (new URLSearchParams(location.search).get(k) as T) ?? def)
  const set = (nv: T) => {
    const u = new URL(location.href)
    if (nv === def) u.searchParams.delete(k)
    else u.searchParams.set(k, nv)
    history.replaceState(null, '', u)
    setV(nv)
  }
  return [v, set]
}

function useSystemTheme(): Theme {
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const [d, setD] = useState(mq.matches)
  useEffect(() => { const on = () => setD(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }, [mq])
  return d ? 'dark' : 'light'
}

function App() {
  const params = new URLSearchParams(location.search)
  const embed = params.get('embed') === '1'
  const [dir, setDir] = useParam<Dir>('dir', 'a')
  const [screen, setScreen] = useParam<Screen>('screen', 'list')
  const [themeP, setThemeP] = useParam<'system' | Theme>('theme', 'system')
  const [lang, setLang] = useParam<Lang>('lang', 'en')
  const [cvd, setCvd] = useParam<Cvd>('cvd', 'none')
  const [frame, setFrame] = useParam<'off' | 'devices' | 'themes'>('frame', 'off')
  const [barHidden, setBarHidden] = useState(false)
  const sys = useSystemTheme()
  const theme: Theme = themeP === 'system' ? sys : themeP
  const m = DIRS[dir]

  useLayoutEffect(() => {
    const el = document.documentElement
    el.dataset.dir = dir
    el.dataset.theme = theme
    el.lang = lang
    m.players[theme].forEach((c, i) => el.style.setProperty(`--p${i + 1}`, c))
    el.style.setProperty('--bar', embed || barHidden || frame !== 'off' ? '0px' : '52px')
    el.style.colorScheme = theme
    document.title = `PROTOTYPE · ${dir.toUpperCase()} ${m.name}`
  }, [dir, theme, lang, embed, barHidden, frame, m])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const i = KEYS.indexOf(dir)
      if (e.key === 'ArrowLeft') setDir(KEYS[(i + 2) % 3])
      if (e.key === 'ArrowRight') setDir(KEYS[(i + 1) % 3])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const go = (s: Screen) => setScreen(s)
  const props: ScreenProps = { dir, theme, lang, go }
  const S = SCREEN_OF[dir]
  let body: React.ReactNode
  if (frame !== 'off' && !embed) body = <Frames frame={frame} />
  else if (screen === 'tokens') body = <TokensPage {...props} />
  else if (screen === 'list') body = <S.list {...props} />
  else if (screen === 'lobby') body = <S.lobby {...props} />
  else body = <S.game key={`${dir}-${screen === 'sale' ? 'sale' : 'inspect'}`} {...props} mode={screen === 'sale' ? 'sale' : 'inspect'} result={screen === 'result'} />

  return (
    <>
      <div style={{ filter: cvd !== 'none' ? `url(#cvd-${cvd})` : undefined, minHeight: '100%' }}>{body}</div>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        {Object.entries(CVD_MATRIX).map(([k, M]) => (
          <filter key={k} id={`cvd-${k}`} colorInterpolationFilters="linearRGB">
            <feColorMatrix type="matrix" values={`${M.slice(0, 3).join(' ')} 0 0 ${M.slice(3, 6).join(' ')} 0 0 ${M.slice(6, 9).join(' ')} 0 0 0 0 0 1 0`} />
          </filter>
        ))}
      </svg>
      {import.meta.env.DEV && !embed && (barHidden ? (
        <button className="proto-bar" style={{ padding: '4px 10px', left: 'auto', right: 8, transform: 'none' }} onClick={() => setBarHidden(false)}>◂ ▸</button>
      ) : (
        <div className="proto-bar">
          <button className="arrow" onClick={() => setDir(KEYS[(KEYS.indexOf(dir) + 2) % 3])} aria-label="previous direction">‹</button>
          <span className="label">{dir.toUpperCase()}<span className="hidden sm:inline"> · {m.name}</span></span>
          <button className="arrow" onClick={() => setDir(KEYS[(KEYS.indexOf(dir) + 1) % 3])} aria-label="next direction">›</button>
          <select value={screen} onChange={(e) => setScreen(e.target.value as Screen)} aria-label="screen">
            {SCREENS.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <select value={themeP} onChange={(e) => setThemeP(e.target.value as Theme)} aria-label="theme" style={{ maxWidth: 64 }}>
            <option value="system">auto</option><option value="light">light</option><option value="dark">dark</option>
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="language" style={{ maxWidth: 48 }}>
            <option value="en">en</option><option value="hu">hu</option><option value="de">de</option>
          </select>
          <select value={cvd} onChange={(e) => setCvd(e.target.value as Cvd)} aria-label="colour vision" style={{ maxWidth: 76 }}>
            <option value="none">vision</option><option value="protan">protan</option><option value="deutan">deutan</option>
            <option value="tritan">tritan</option><option value="achroma">greys</option>
          </select>
          <select className="hidden md:block" value={frame} onChange={(e) => setFrame(e.target.value as 'off')} aria-label="compare" style={{ maxWidth: 92 }}>
            <option value="off">1 view</option><option value="devices">phone+desk</option><option value="themes">light+dark</option>
          </select>
          <button onClick={() => setBarHidden(true)} aria-label="hide bar" style={{ padding: '0 9px' }}>–</button>
        </div>
      ))}
    </>
  )
}

/** Compare views: the same URL in iframes at real device sizes, scaled to fit. */
function Frames({ frame }: { frame: 'devices' | 'themes' }) {
  const [vw, setVw] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => { const on = () => setVw({ w: innerWidth, h: innerHeight }); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  const url = (extra: Record<string, string>) => {
    const u = new URL(location.href)
    u.searchParams.delete('frame')
    u.searchParams.set('embed', '1')
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
    return u.toString()
  }
  const views = frame === 'devices'
    ? [{ w: 390, h: 844, src: url({}), label: 'phone 390×844' }, { w: 1440, h: 900, src: url({}), label: 'desktop 1440×900' }]
    : [{ w: 1440, h: 900, src: url({ theme: 'light' }), label: 'light' }, { w: 1440, h: 900, src: url({ theme: 'dark' }), label: 'dark' }]
  const gap = 24, availH = vw.h - 120, availW = vw.w - gap * (views.length + 1)
  const s = Math.min(availH / Math.max(...views.map((v) => v.h)), availW / views.reduce((a, v) => a + v.w, 0))
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#2a2a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap }}>
      {views.map((v, i) => (
        <figure key={i} style={{ margin: 0, color: '#bbb', font: '12px system-ui', textAlign: 'center' }}>
          <div style={{ width: v.w * s, height: v.h * s, overflow: 'hidden', borderRadius: 12, boxShadow: '0 8px 30px #0008' }}>
            <iframe src={v.src} title={v.label} style={{ width: v.w, height: v.h, border: 0, transform: `scale(${s})`, transformOrigin: '0 0' }} />
          </div>
          <figcaption style={{ marginTop: 6 }}>{v.label}</figcaption>
        </figure>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
