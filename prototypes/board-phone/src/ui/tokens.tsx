// PROTOTYPE, throwaway: the current direction's tokens side by side in light and dark, and the Player colours
// under colour-vision simulation with measured distances (ticket #16). Prototype chrome, not a direction.

import { useLayoutEffect, useRef, useState } from 'react'
import { DIRS, V1_PLAYERS, inkOn, type ScreenProps, type Theme } from './dirs'
import { contrast, minDistance, simulateHex, type Cvd } from './model'

const TOKENS = ['background', 'foreground', 'card', 'card-foreground', 'primary', 'primary-foreground', 'secondary', 'muted', 'muted-foreground', 'accent', 'border', 'ring', 'success', 'warning', 'danger']
const CVDS: Cvd[] = ['none', 'protan', 'deutan', 'tritan', 'achroma']
const CVD_NAME: Record<Cvd, string> = { none: 'normal', protan: 'protanopia', deutan: 'deuteranopia', tritan: 'tritanopia', achroma: 'greyscale' }

function useVars(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [v, setV] = useState<Record<string, string>>({})
  useLayoutEffect(() => {
    if (!ref.current) return
    const cs = getComputedStyle(ref.current)
    setV(Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return v
}
const solid = (c: string) => (c.length === 9 ? c.slice(0, 7) : c)

function ThemeColumn({ dir, theme }: { dir: ScreenProps['dir']; theme: Theme }) {
  const ref = useRef<HTMLDivElement>(null)
  const v = useVars(ref, [dir, theme])
  const m = DIRS[dir]
  const pairs: [string, string, string][] = [['foreground', 'background', 'body text'], ['muted-foreground', 'background', 'muted text'], ['primary-foreground', 'primary', 'primary button'], ['card-foreground', 'card', 'card text']]
  return (
    <div ref={ref} data-dir={dir} data-theme={theme} className="rounded-ui border border-border bg-background p-4 text-foreground" style={Object.fromEntries(m.players[theme].map((c, i) => [`--p${i + 1}`, c]))}>
      <div className="mb-3 flex items-baseline justify-between"><h3 className="font-display text-xl">{theme}</h3><span className="text-xs text-muted-foreground">radius {getComputedStyle(document.documentElement).getPropertyValue('--radius')}</span></div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {TOKENS.map((k) => (
          <div key={k} className="text-[10px] leading-tight">
            <div className="h-10 rounded-[6px] border border-black/10" style={{ background: `var(--${k})` }} />
            <div className="mt-1 truncate">{k}</div><div className="font-mono text-muted-foreground">{v[k]}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-1 text-xs">
        {pairs.map(([f, b, label]) => {
          const c = v[f] && v[b] ? contrast(solid(v[f]), solid(v[b])) : 0
          return <div key={label} className="flex justify-between"><span style={{ color: `var(--${f})`, background: `var(--${b})` }} className="rounded px-1.5">{label}</span><span className={c >= 4.5 ? 'text-success' : c >= 3 ? 'text-warning' : 'text-danger'}>{c.toFixed(1)}:1 {c >= 4.5 ? 'AA' : c >= 3 ? 'AA large' : 'fail'}</span></div>
        })}
      </div>
      <div className="mt-4 board-backdrop flex h-16 items-center justify-center gap-2 rounded-[6px] border border-border">
        {m.players[theme].map((c, i) => (
          <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full font-bold" style={{ background: c, color: inkOn(c) }}>{m.badge[i]}</span>
        ))}
        <img src="/board/ground.png" alt="" className="h-10" /><img src="/board/haz_alap.png" alt="" className="h-10" />
      </div>
    </div>
  )
}

function PlayerMatrix({ label, colors, badge }: { label: string; colors: string[]; badge?: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-normal">{label}</th>{CVDS.map((c) => <th key={c} className="font-normal">{CVD_NAME[c]}</th>)}</tr></thead>
        <tbody>
          <tr>
            <td className="py-2 pr-2 font-mono text-[10px] text-muted-foreground">{colors.join(' ')}</td>
            {CVDS.map((cvd) => {
              const d = minDistance(colors, cvd)
              return (
                <td key={cvd} className="py-2 pr-2 align-top">
                  <div className="flex gap-1">
                    {colors.map((c, i) => {
                      const s = simulateHex(c, cvd)
                      return <span key={i} className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: s, color: inkOn(s), outline: d.pair.includes(i) && d.min < 10 ? '2px solid var(--danger)' : undefined }}>{badge?.[i] ?? ''}</span>
                    })}
                  </div>
                  <div className={`mt-1 ${d.min < 5 ? 'text-danger' : d.min < 10 ? 'text-warning' : 'text-success'}`}>min Δ {d.min.toFixed(1)} {d.min < 10 && `(P${d.pair[0] + 1}/P${d.pair[1] + 1})`}</div>
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function TokensPage({ dir, theme }: ScreenProps) {
  const m = DIRS[dir]
  return (
    <div className="min-h-dvh overflow-auto bg-background pb-bar text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="text-xs text-muted-foreground">Direction {dir.toUpperCase()}</div>
        <h1 className="font-display text-4xl">{m.name}</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{m.pitch}</p>

        <h2 className="mt-8 mb-2 font-display text-2xl">Type</h2>
        <div className="grid gap-4 rounded-ui border border-border bg-card p-4 text-card-foreground md:grid-cols-3">
          <div><div className="text-xs text-muted-foreground">display · var(--font-display)</div><div className="font-display text-4xl leading-tight">Árvíztűrő tükörfúrógép</div><div className="font-display text-xl">Größenänderung · Őrült ügyeletes</div></div>
          <div><div className="text-xs text-muted-foreground">body · var(--font-body)</div><p className="text-base">A Player who cannot cover a Charge sells Fields for the Shortfall. Ha a játékos nem tudja fizetni, mezőket ad el. Wer nicht zahlen kann, verkauft Felder.</p></div>
          <div><div className="text-xs text-muted-foreground">numbers · var(--font-num)</div><div className="tnum font-num text-3xl">1.25M 830K 2.1M</div><div className="tnum font-num text-xl">0:17 · 23:41 · 4821</div></div>
        </div>

        <h2 className="mt-8 mb-2 font-display text-2xl">Tokens, light and dark</h2>
        <div className="grid gap-4 md:grid-cols-2"><ThemeColumn dir={dir} theme="light" /><ThemeColumn dir={dir} theme="dark" /></div>

        <h2 className="mt-8 mb-1 font-display text-2xl">Player colours under colour-vision simulation</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          Machado 2009 (full severity), smallest OKLab distance between any two Players ×100: under 5 is a clash, under 10 is hard at a glance. The non-colour cue is the {m.badgeName} on every token and over each pawn on the Board. Houses on the Board carry colour only. The pawns are v1's four alien sprites, so they stay pink / blue / green / yellow whatever the palette.
        </p>
        <div className="space-y-4 rounded-ui border border-border bg-card p-4 text-card-foreground">
          <PlayerMatrix label="v1 (as shipped)" colors={V1_PLAYERS} />
          <PlayerMatrix label={`${m.name} · light`} colors={m.players.light} badge={m.badge} />
          <PlayerMatrix label={`${m.name} · dark`} colors={m.players.dark} badge={m.badge} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Current page theme: {theme}. Use the bar's “vision” menu to see every screen, the Board included, through the same filters.</p>
      </div>
    </div>
  )
}
