import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { armazenamentoSeguro } from '../lib/storage'

export type Tema = 'light' | 'dark' | 'system'

interface UIState {
  tema: Tema
  sidebarRecolhida: boolean
  definirTema: (t: Tema) => void
  alternarSidebar: () => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      tema: 'system',
      sidebarRecolhida: false,
      definirTema: (tema) => set({ tema }),
      alternarSidebar: () => set((s) => ({ sidebarRecolhida: !s.sidebarRecolhida })),
    }),
    {
      name: 'bc-fichas:ui',
      storage: createJSONStorage(() => armazenamentoSeguro),
    },
  ),
)

export function aplicarTema(tema: Tema) {
  const escuro = tema === 'dark' || (tema === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light'
}

// ---- Notificações (toasts) -------------------------------------------------

export interface Toast {
  id: number
  titulo: string
  descricao?: string
  tipo: 'sucesso' | 'erro' | 'info'
}

interface ToastState {
  toasts: Toast[]
  mostrar: (t: Omit<Toast, 'id'>) => void
  fechar: (id: number) => void
}

let seq = 0
export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  mostrar(t) {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().fechar(id), t.tipo === 'erro' ? 6000 : 3500)
  },
  fechar: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  sucesso: (titulo: string, descricao?: string) => useToasts.getState().mostrar({ titulo, descricao, tipo: 'sucesso' }),
  erro: (titulo: string, descricao?: string) => useToasts.getState().mostrar({ titulo, descricao, tipo: 'erro' }),
  info: (titulo: string, descricao?: string) => useToasts.getState().mostrar({ titulo, descricao, tipo: 'info' }),
}
