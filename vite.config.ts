import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` gera um único arquivo HTML (dist-single/index.html)
// que pode ser aberto direto no navegador, sem servidor.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    // recharts + motion formam o bloco principal; o jsPDF já é carregado sob demanda
    chunkSizeWarningLimit: 1100,
    ...(mode === 'single' ? { outDir: 'dist-single', assetsInlineLimit: Infinity } : {}),
  },
}))
