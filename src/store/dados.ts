import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { gerarDadosExemplo } from '../lib/seed'
import { armazenamentoSeguro, novoId } from '../lib/storage'
import type { Cliente, Configuracoes, Evento, ID } from '../lib/types'

export type ClienteInput = Omit<Cliente, 'id' | 'criadoEm' | 'atualizadoEm'>
export type EventoInput = Omit<Evento, 'id' | 'codigo' | 'criadoEm' | 'atualizadoEm'>

export const CONFIG_PADRAO: Configuracoes = {
  valorDiariaPadrao: 80,
  valorBobinaPadrao: 6,
  frotaMaquinas: 10,
  rodapePadrao: 'AGRADECEMOS SUA PRESENÇA!',
}

export interface Backup {
  app: 'bc-fichas-control'
  versao: number
  exportadoEm: string
  clientes: Cliente[]
  eventos: Evento[]
  config: Configuracoes
  proximoCodigo: number
}

interface DadosState {
  clientes: Cliente[]
  eventos: Evento[]
  config: Configuracoes
  proximoCodigo: number

  salvarCliente: (dados: ClienteInput, id?: ID) => Cliente
  excluirCliente: (id: ID) => { ok: boolean; motivo?: string }
  salvarEvento: (dados: EventoInput, id?: ID) => Evento
  atualizarEvento: (id: ID, patch: Partial<EventoInput>) => void
  duplicarEvento: (id: ID) => Evento | undefined
  excluirEvento: (id: ID) => void
  salvarConfig: (patch: Partial<Configuracoes>) => void
  exportar: () => Backup
  importar: (dados: unknown) => void
  carregarExemplo: () => void
  limparTudo: () => void
}

const agora = () => new Date().toISOString()

function validarBackup(dados: unknown): Backup {
  const b = dados as Partial<Backup>
  if (!b || typeof b !== 'object' || b.app !== 'bc-fichas-control' || !Array.isArray(b.clientes) || !Array.isArray(b.eventos)) {
    throw new Error('Arquivo de backup inválido ou de outro sistema.')
  }
  const maiorCodigo = b.eventos.reduce((m, e) => Math.max(m, Number(e.codigo) || 0), 0)
  return {
    app: 'bc-fichas-control',
    versao: Number(b.versao) || 1,
    exportadoEm: String(b.exportadoEm ?? ''),
    clientes: b.clientes,
    eventos: b.eventos,
    config: { ...CONFIG_PADRAO, ...b.config },
    proximoCodigo: Math.max(Number(b.proximoCodigo) || 1, maiorCodigo + 1),
  }
}

export const useDados = create<DadosState>()(
  persist(
    (set, get) => ({
      clientes: [],
      eventos: [],
      config: CONFIG_PADRAO,
      proximoCodigo: 1,

      salvarCliente(dados, id) {
        const ts = agora()
        if (id) {
          let salvo!: Cliente
          set((s) => ({
            clientes: s.clientes.map((c) => (c.id === id ? (salvo = { ...c, ...dados, atualizadoEm: ts }) : c)),
          }))
          return salvo
        }
        const novo: Cliente = { ...dados, id: novoId(), criadoEm: ts, atualizadoEm: ts }
        set((s) => ({ clientes: [...s.clientes, novo] }))
        return novo
      },

      excluirCliente(id) {
        const qtd = get().eventos.filter((e) => e.clienteId === id).length
        if (qtd > 0) {
          return {
            ok: false,
            motivo: `Este cliente possui ${qtd} evento${qtd > 1 ? 's' : ''}. Exclua ou transfira os eventos antes.`,
          }
        }
        set((s) => ({ clientes: s.clientes.filter((c) => c.id !== id) }))
        return { ok: true }
      },

      salvarEvento(dados, id) {
        const ts = agora()
        const dias = [...dados.dias].sort((a, b) => a.data.localeCompare(b.data))
        if (id) {
          let salvo!: Evento
          set((s) => ({
            eventos: s.eventos.map((e) => (e.id === id ? (salvo = { ...e, ...dados, dias, atualizadoEm: ts }) : e)),
          }))
          return salvo
        }
        const novo: Evento = {
          ...dados,
          dias,
          id: novoId(),
          codigo: get().proximoCodigo,
          criadoEm: ts,
          atualizadoEm: ts,
        }
        set((s) => ({ eventos: [...s.eventos, novo], proximoCodigo: s.proximoCodigo + 1 }))
        return novo
      },

      atualizarEvento(id, patch) {
        set((s) => ({
          eventos: s.eventos.map((e) => (e.id === id ? { ...e, ...patch, atualizadoEm: agora() } : e)),
        }))
      },

      duplicarEvento(id) {
        const origem = get().eventos.find((e) => e.id === id)
        if (!origem) return undefined
        const { id: _id, codigo: _c, criadoEm: _cr, atualizadoEm: _at, ...resto } = origem
        return get().salvarEvento({
          ...resto,
          nome: `${origem.nome} (cópia)`,
          dias: origem.dias.map((d) => ({ ...d, id: novoId() })),
          bobinasDevolvidas: null,
          formaPagamento: 'NAO_PAGO',
          dataPagamento: '',
          status: 'EM_ABERTO',
        })
      },

      excluirEvento(id) {
        set((s) => ({ eventos: s.eventos.filter((e) => e.id !== id) }))
      },

      salvarConfig(patch) {
        set((s) => ({ config: { ...s.config, ...patch } }))
      },

      exportar() {
        const { clientes, eventos, config, proximoCodigo } = get()
        return { app: 'bc-fichas-control', versao: 1, exportadoEm: agora(), clientes, eventos, config, proximoCodigo }
      },

      importar(dados) {
        const b = validarBackup(dados)
        set({ clientes: b.clientes, eventos: b.eventos, config: b.config, proximoCodigo: b.proximoCodigo })
      },

      carregarExemplo() {
        const ex = gerarDadosExemplo(new Date())
        set({ clientes: ex.clientes, eventos: ex.eventos, proximoCodigo: ex.proximoCodigo })
      },

      limparTudo() {
        set({ clientes: [], eventos: [], proximoCodigo: 1 })
      },
    }),
    {
      name: 'bc-fichas:dados',
      version: 1,
      storage: createJSONStorage(() => armazenamentoSeguro),
      partialize: ({ clientes, eventos, config, proximoCodigo }) => ({ clientes, eventos, config, proximoCodigo }),
      merge: (persistido, atual) => {
        const p = (persistido ?? {}) as Partial<DadosState>
        return {
          ...atual,
          ...p,
          config: { ...CONFIG_PADRAO, ...p.config },
        }
      },
    },
  ),
)

/** Na versão de demonstração (build:demo), carrega dados de exemplo no primeiro acesso. */
export function iniciarDemoSeNecessario() {
  if (import.meta.env.VITE_DEMO !== '1') return
  const s = useDados.getState()
  let jaIniciado = false
  try {
    jaIniciado = localStorage.getItem('bc-fichas:demo-iniciado') === '1'
    localStorage.setItem('bc-fichas:demo-iniciado', '1')
  } catch {
    /* sem armazenamento: carrega o exemplo a cada abertura */
  }
  if (!jaIniciado && s.clientes.length === 0 && s.eventos.length === 0) s.carregarExemplo()
}
