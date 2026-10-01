import { create } from 'zustand'
import { CONFIG_PADRAO } from '#shared/dominio.ts'
import type {
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  DadosCompletos,
  Evento,
  EventoInput,
  EventoPatch,
  MensagemTempoReal,
} from '#shared/tipos.ts'
import { api, conectarTempoReal } from '../lib/api'

export { CONFIG_PADRAO }
export type { ClienteInput, EventoInput }

/** Registro que o usuário começou a editar (para detectar alterações de outra pessoa). */
export interface Alvo {
  id: string
  versao: number
}

interface DadosState {
  clientes: Cliente[]
  eventos: Evento[]
  config: Configuracoes
  /** Última revisão do servidor aplicada nesta tela. */
  revisao: number
  status: 'carregando' | 'pronto' | 'erro'
  erro: string
  /** Conexão de tempo real com o servidor ativa. */
  conectado: boolean

  /** Abre a conexão com o servidor e carrega os dados. Retorna a função de encerramento. */
  iniciar: () => () => void
  recarregar: () => Promise<void>

  salvarCliente: (dados: ClienteInput, alvo?: Alvo) => Promise<Cliente>
  excluirCliente: (id: string) => Promise<void>
  salvarEvento: (dados: EventoInput, alvo?: Alvo) => Promise<Evento>
  alterarEvento: (id: string, patch: EventoPatch) => Promise<Evento>
  duplicarEvento: (id: string) => Promise<Evento>
  excluirEvento: (id: string) => Promise<void>
  salvarConfig: (config: Configuracoes) => Promise<Configuracoes>
  exportar: () => Promise<Backup>
  importar: (dados: unknown) => Promise<{ clientes: number; eventos: number }>
  carregarExemplo: () => Promise<void>
  limparTudo: () => Promise<void>
}

/** Insere ou substitui pelo id, sem voltar para uma versão mais antiga. */
function mesclar<T extends { id: string; versao: number }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id)
  if (i === -1) return [...lista, item]
  if (lista[i].versao > item.versao) return lista
  const copia = lista.slice()
  copia[i] = item
  return copia
}

let fila: MensagemTempoReal[] = []
let carregamento: Promise<void> | null = null

export const useDados = create<DadosState>()((set, get) => {
  const aplicarCarga = (d: DadosCompletos) => {
    set({ clientes: d.clientes, eventos: d.eventos, config: d.config, revisao: d.revisao, status: 'pronto', erro: '' })
    const pendentes = fila.filter((m) => m.revisao > d.revisao).sort((a, b) => a.revisao - b.revisao)
    fila = []
    pendentes.forEach(aplicarMensagem)
  }

  const aplicarMensagem = (msg: MensagemTempoReal) => {
    const s = get()
    if (s.status !== 'pronto' || carregamento) {
      fila.push(msg)
      return
    }
    if (msg.revisao < s.revisao) return
    if (msg.revisao > s.revisao + 1) {
      // Perdemos alguma alteração no caminho: recarrega tudo
      void get().recarregar()
      return
    }
    switch (msg.tipo) {
      case 'cliente':
        set({
          clientes: msg.acao === 'salvo' ? mesclar(s.clientes, msg.dado) : s.clientes.filter((c) => c.id !== msg.id),
        })
        break
      case 'evento':
        set({ eventos: msg.acao === 'salvo' ? mesclar(s.eventos, msg.dado) : s.eventos.filter((e) => e.id !== msg.id) })
        break
      case 'config':
        set({ config: msg.dado })
        break
      case 'tudo':
        void get().recarregar()
        return
    }
    set({ revisao: Math.max(get().revisao, msg.revisao) })
  }

  return {
    clientes: [],
    eventos: [],
    config: CONFIG_PADRAO,
    revisao: 0,
    status: 'carregando',
    erro: '',
    conectado: false,

    iniciar() {
      let primeiraFalha = true
      const fechar = conectarTempoReal({
        aoConectar(revisaoServidor) {
          set({ conectado: true })
          const s = get()
          if (s.status !== 'pronto' || revisaoServidor !== s.revisao) void get().recarregar()
        },
        aoReceber: aplicarMensagem,
        aoDesconectar() {
          set({ conectado: false })
          // Sem tempo real logo na abertura: tenta a carga direta para mostrar o motivo
          if (primeiraFalha && get().status === 'carregando') {
            primeiraFalha = false
            void get().recarregar()
          }
        },
      })
      return fechar
    },

    recarregar() {
      carregamento ??= api
        .dados()
        .then((d) => {
          carregamento = null
          aplicarCarga(d)
        })
        .catch((e: Error) => {
          carregamento = null
          if (get().status !== 'pronto') set({ status: 'erro', erro: e.message })
        })
      return carregamento
    },

    async salvarCliente(dados, alvo) {
      const salvo = alvo ? await api.atualizarCliente(alvo.id, dados, alvo.versao) : await api.criarCliente(dados)
      set((s) => ({ clientes: mesclar(s.clientes, salvo) }))
      return salvo
    },

    async excluirCliente(id) {
      await api.excluirCliente(id)
      set((s) => ({ clientes: s.clientes.filter((c) => c.id !== id) }))
    },

    async salvarEvento(dados, alvo) {
      const salvo = alvo ? await api.atualizarEvento(alvo.id, dados, alvo.versao) : await api.criarEvento(dados)
      set((s) => ({ eventos: mesclar(s.eventos, salvo) }))
      return salvo
    },

    async alterarEvento(id, patch) {
      const salvo = await api.alterarEvento(id, patch)
      set((s) => ({ eventos: mesclar(s.eventos, salvo) }))
      return salvo
    },

    async duplicarEvento(id) {
      const novo = await api.duplicarEvento(id)
      set((s) => ({ eventos: mesclar(s.eventos, novo) }))
      return novo
    },

    async excluirEvento(id) {
      await api.excluirEvento(id)
      set((s) => ({ eventos: s.eventos.filter((e) => e.id !== id) }))
    },

    async salvarConfig(config) {
      const salvo = await api.salvarConfig(config)
      set({ config: salvo })
      return salvo
    },

    exportar: () => api.backup(),

    async importar(dados) {
      const r = await api.restaurar(dados)
      await get().recarregar()
      return r
    },

    async carregarExemplo() {
      await api.carregarExemplo()
      await get().recarregar()
    },

    async limparTudo() {
      await api.limparTudo()
      await get().recarregar()
    },
  }
})
