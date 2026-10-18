// PROTOTYPE, throwaway: isometric Board on a phone (map ticket "Prototype: isometric Board on a phone").
// Four phone layouts of the same Board, switchable via ?variant=A|B|C|D|E and the bottom bar.
// ?page=pixi-react opens the @pixi/react binding check. ?page=pick opens the Field-picking prototype (ticket #15). Extra URL flags: ?aa=1 (antialias), ?gpu=webgpu.

import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RenderOptions } from './board/renderer'
import { Switcher, TapTestProvider } from './shared'
import { VariantA, VariantB, VariantC, VariantD, VariantE, type VariantProps } from './variants'
import { PixiReactCheck } from './PixiReactCheck'
import { PickPage } from './pick'
import './styles.css'

const VARIANTS: { key: string; name: string; C: (p: VariantProps) => React.ReactNode }[] = [
  { key: 'A', name: 'Fit, tap direct', C: VariantA },
  { key: 'B', name: 'Zoom & pan', C: VariantB },
  { key: 'C', name: 'Tap-to-inspect', C: VariantC },
  { key: 'D', name: 'Landscape + panel', C: VariantD },
  { key: 'E', name: 'C + B (chosen)', C: VariantE },
]

function App() {
  const params = new URLSearchParams(location.search)
  const [variant, setVariant] = useState(params.get('variant') ?? 'A')
  const [options, setOptions] = useState<RenderOptions>({
    recolor: 'baked', labels: true, walking: true, continuous: false, resolution: Math.min(2, devicePixelRatio),
  })
  if (params.get('page') === 'pixi-react') return <PixiReactCheck />
  if (params.get('page') === 'pick') return <PickPage />
  const change = (k: string) => {
    const u = new URL(location.href)
    u.searchParams.set('variant', k)
    history.replaceState(null, '', u)
    setVariant(k)
  }
  const v = VARIANTS.find((x) => x.key === variant) ?? VARIANTS[0]
  return (
    <TapTestProvider key={v.key} variant={`${v.key} ${v.name}`}>
      <v.C key={v.key} options={options} setOptions={setOptions} />
      <Switcher variants={VARIANTS} current={v.key} onChange={change} />
    </TapTestProvider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
