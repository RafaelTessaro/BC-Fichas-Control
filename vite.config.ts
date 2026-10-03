/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em desenvolvimento (`npm run dev`) o Vite repassa /api para o servidor local na porta 3000.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.PORTA ?? 3000}`, changeOrigin: false },
    },
  },
  build: {
    // recharts + motion + as telas formam o bloco principal (uso em rede local);
    // o jsPDF é carregado sob demanda
    chunkSizeWarningLimit: 1300,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
