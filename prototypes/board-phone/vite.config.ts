import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pixiReact = JSON.parse(readFileSync('node_modules/@pixi/react/package.json', 'utf8'))

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5180 },
  define: { __PIXI_REACT_VERSION__: JSON.stringify(pixiReact.version) },
})
