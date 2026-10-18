import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pixiReact = JSON.parse(readFileSync('node_modules/@pixi/react/package.json', 'utf8'))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5180 },
  define: { __PIXI_REACT_VERSION__: JSON.stringify(pixiReact.version) },
  build: { rollupOptions: { input: { main: 'index.html', ui: 'ui.html' } } },
})
