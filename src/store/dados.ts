import { create } from 'zustand'
import { codigoContrato } from '#shared/contrato.ts'
import { CONFIG_PADRAO } from '#shared/dominio.ts'
import { ordenarMaquinas } from '#shared/maquinas.ts'
import type {
  Anexo,
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  Contrato,
  DadosCompletos,
  Evento,
  EventoInput,
  EventoPatch,
  Maquina,
  MaquinaInput,
  MensagemTempoReal,
  NovoContrato,
  OrdemServico,
  OrdemServicoInput,
  Reclamacao,
  ReclamacaoInput,
  StatusMaquina,
  TipoMaquina,
} from '#shared/tipos.ts'
import { api, conectarTempoReal, type ResultadoAjuste } from '../lib/api'

export { CONFIG_PADRAO }
export type { ClienteInput, EventoInput, MaquinaInput, OrdemServicoInput, ReclamacaoInput, ResultadoAjuste }

/** Registro que o usuário começou a editar (para detectar alterações de outra pessoa). */
export interface Alvo {
  id: string
  versao: number
}

interface DadosState {
  clientes: Cliente[]
  eventos: Evento[]
  /** Máquinas cadastradas (P e G), em ordem natural de identificação. */
  maquinas: Maquina[]
  /** Manutenções das máquinas ("ordens de serviço" no código), da mais recente para a mais antiga. */
  ordens: OrdemServico[]
  /** Reclamações de clientes sobre as máquinas, da mais recente para a mais antiga. */
  reclamacoes: Reclamacao[]
  /** Arquivos anexados aos eventos (só os dados; o conteúdo é baixado pelo `api.urlAnexo`). */
  anexos: Anexo[]
  /** Contratos de locação, do mais recente (maior número) para o mais antigo. */
  contratos: Contrato[]
  config: Configuracoes
  /** Última revisão do servidor aplicada nesta tela. */
  revisao: number
  status: 'carregando' | 'pronto' | 'erro'
  erro: string
  /** Conexão de tempo real com o servidor ativa. */
  conectado: boolean
  /** A última tentativa de atualizar a tela falhou (uma nova tentativa já está agendada). */
  falhaRecarga: boolean

  /** Abre a conexão com o servidor e carrega os dados. Retorna a função de encerramento. */
  iniciar: () => () => void
  recarregar: () => Promise<void>

  salvarCliente: (dados: ClienteInput, alvo?: Alvo) => Promise<Cliente>
  excluirCliente: (id: string) => Promise<void>
  salvarEvento: (dados: EventoInput, alvo?: Alvo) => Promise<Evento>
  alterarEvento: (id: string, patch: EventoPatch) => Promise<Evento>
  duplicarEvento: (id: string) => Promise<Evento>
  /** "Repetir em outras datas": uma cópia do evento para cada data de início; devolve as cópias. */
  repetirEvento: (id: string, datas: string[]) => Promise<Evento[]>
  excluirEvento: (id: string) => Promise<void>
  salvarMaquina: (dados: MaquinaInput, alvo?: Alvo) => Promise<Maquina>
  excluirMaquina: (id: string) => Promise<void>
  /** Cadastra ou retira máquinas para o tipo ficar com `quantidade` (ver `planoAjuste`). */
  ajustarQuantidade: (tipo: TipoMaquina, quantidade: number) => Promise<ResultadoAjuste>
  /** `statusMaquina` muda a situação da máquina na mesma gravação. */
  salvarOrdem: (dados: OrdemServicoInput, alvo?: Alvo, statusMaquina?: StatusMaquina) => Promise<OrdemServico>
  excluirOrdem: (id: string) => Promise<void>
  salvarReclamacao: (dados: ReclamacaoInput, alvo?: Alvo) => Promise<Reclamacao>
  excluirReclamacao: (id: string) => Promise<void>
  /** Envia um arquivo para o evento (`aoProgresso` de 0 a 1). */
  enviarAnexo: (eventoId: string, arquivo: File | Blob, nome: string, aoProgresso?: (fracao: number) => void) => Promise<Anexo>
  excluirAnexo: (id: string) => Promise<void>
  /** Gera o contrato do evento (um anterior que esperava a assinatura é substituído). */
  gerarContrato: (dados: NovoContrato) => Promise<Contrato>
  alterarContrato: (
    id: string,
    mudanca: { acao: 'assinar'; data?: string } | { acao: 'cancelar'; motivo?: string } | { acao: 'reabrir' },
    versao?: number,
  ) => Promise<Contrato>
  /** Guarda a cópia assinada (foto ou PDF); o contrato passa a assinado. */
  enviarContratoAssinado: (
    id: string,
    arquivo: File | Blob,
    nome: string,
    aoProgresso?: (fracao: number) => void,
  ) => Promise<Contrato>
  removerContratoAssinado: (id: string) => Promise<Contrato>
  /** Exclui um contrato cancelado (ou passado o prazo de guarda), com a cópia assinada. */
  excluirContrato: (id: string) => Promise<void>
  salvarConfig: (config: Configuracoes) => Promise<Configuracoes>
  /** Grava a lista de serviços de manutenção cadastrados. */
  salvarServicos: (servicos: string[]) => Promise<Configuracoes>
  exportar: () => Promise<Backup>
  importar: (dados: unknown) => Promise<{ clientes: number; eventos: number; maquinas: number }>
  /** Acrescenta dados (sem apagar os do servidor). */
  mesclarDadosAntigos: (
    dados: unknown,
  ) => Promise<{ clientes: number; eventos: number; maquinas: number; ordens: number; ignorados: number }>
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

const mesclarMaquina = (lista: Maquina[], m: Maquina) => ordenarMaquinas(mesclar(lista, m))
const mesclarOrdem = (lista: OrdemServico[], o: OrdemServico) => mesclar(lista, o).sort((a, b) => b.numero - a.numero)
const mesclarContrato = (lista: Contrato[], c: Contrato) => mesclar(lista, c).sort((a, b) => b.numero - a.numero)
/**
 * Os contratos do evento que esperavam a assinatura deixam de valer (contrato novo, evento
 * cancelado ou excluído): o servidor faz o mesmo e manda pelo tempo real.
 */
const cancelarAguardando = (lista: Contrato[], eventoId: string, motivo: string, exceto = '') =>
  lista.map((c) =>
    c.eventoId === eventoId && c.id !== exceto && c.status === 'AGUARDANDO'
      ? { ...c, status: 'CANCELADO' as const, motivoCancelamento: motivo, versao: c.versao + 1 }
      : c,
  )
/** Evento que acabou de ser cancelado: os contratos dele que esperavam a assinatura deixam de valer. */
const contratosSeCancelado = (s: Pick<DadosState, 'eventos' | 'contratos'>, salvo: Evento) =>
  salvo.status === 'CANCELADO' && s.eventos.find((e) => e.id === salvo.id)?.status !== 'CANCELADO'
    ? cancelarAguardando(s.contratos, salvo.id, 'Evento cancelado.')
    : s.contratos
const mesclarReclamacao = (lista: Reclamacao[], r: Reclamacao) =>
  mesclar(lista, r).sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm))
/** Arquivos não mudam depois de enviados: só entram (sem repetir) ou saem. */
const mesclarAnexo = (lista: Anexo[], a: Anexo) => (lista.some((x) => x.id === a.id) ? lista : [...lista, a])

let fila: MensagemTempoReal[] = []
let carregamento: Promise<void> | null = null
/** Versão da interface vista na primeira conexão; se mudar, o servidor foi atualizado. */
let buildInicial: string | null = null
let tentativasRecarga = 0
let timerRecarga: ReturnType<typeof setTimeout> | undefined

/** Recarrega a página para usar a nova versão (no máximo uma vez a cada 30 s, evitando laço). */
function recarregarPagina() {
  try {
    const ultima = Number(sessionStorage.getItem('bc-fichas:recarregou') ?? 0)
    if (Date.now() - ultima < 30_000) return
    sessionStorage.setItem('bc-fichas:recarregou', String(Date.now()))
  } catch {
    /* sem sessionStorage: recarrega mesmo assim */
  }
  location.reload()
}

export const useDados = create<DadosState>()((set, get) => {
  const aplicarCarga = (d: DadosCompletos) => {
    set({
      clientes: d.clientes,
      eventos: d.eventos,
      maquinas: d.maquinas,
      ordens: d.ordens,
      reclamacoes: d.reclamacoes ?? [],
      anexos: d.anexos ?? [],
      contratos: d.contratos ?? [],
      config: d.config,
      revisao: d.revisao,
      status: 'pronto',
      erro: '',
      falhaRecarga: false,
    })
    // Mesma revisão também é reaplicada: o status do Google Agenda é republicado sem nova revisão
    const pendentes = fila.filter((m) => m.revisao >= d.revisao).sort((a, b) => a.revisao - b.revisao)
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
        set(
          msg.acao === 'salvo'
            ? { eventos: mesclar(s.eventos, msg.dado) }
            : // Os arquivos do evento excluído saem junto
              { eventos: s.eventos.filter((e) => e.id !== msg.id), anexos: s.anexos.filter((a) => a.eventoId !== msg.id) },
        )
        break
      case 'maquina':
        set({
          maquinas: msg.acao === 'salvo' ? mesclarMaquina(s.maquinas, msg.dado) : s.maquinas.filter((m) => m.id !== msg.id),
        })
        break
      case 'os':
        set({ ordens: msg.acao === 'salvo' ? mesclarOrdem(s.ordens, msg.dado) : s.ordens.filter((o) => o.id !== msg.id) })
        break
      case 'reclamacao':
        set({
          reclamacoes:
            msg.acao === 'salvo' ? mesclarReclamacao(s.reclamacoes, msg.dado) : s.reclamacoes.filter((r) => r.id !== msg.id),
        })
        break
      case 'anexo':
        set({ anexos: msg.acao === 'salvo' ? mesclarAnexo(s.anexos, msg.dado) : s.anexos.filter((a) => a.id !== msg.id) })
        break
      case 'contrato':
        set({
          contratos: msg.acao === 'salvo' ? mesclarContrato(s.contratos, msg.dado) : s.contratos.filter((c) => c.id !== msg.id),
        })
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
    maquinas: [],
    ordens: [],
    reclamacoes: [],
    anexos: [],
    contratos: [],
    config: CONFIG_PADRAO,
    revisao: 0,
    status: 'carregando',
    erro: '',
    conectado: false,
    falhaRecarga: false,

    iniciar() {
      let primeiraFalha = true
      const fechar = conectarTempoReal({
        aoConectar(ola) {
          set({ conectado: true })
          if (buildInicial === null) buildInicial = ola.build
          else if (ola.build && ola.build !== buildInicial) {
            // O servidor foi atualizado: esta aba ainda roda a interface antiga
            recarregarPagina()
            return
          }
          const s = get()
          if (s.status !== 'pronto' || ola.revisao !== s.revisao) void get().recarregar()
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
      clearTimeout(timerRecarga)
      carregamento ??= api
        .dados()
        .then((d) => {
          carregamento = null
          tentativasRecarga = 0
          aplicarCarga(d)
        })
        .catch((e: Error) => {
          carregamento = null
          if (get().status !== 'pronto') {
            set({ status: 'erro', erro: e.message })
            return
          }
          // A tela já estava pronta: mostra o aviso e tenta de novo com espera crescente
          // (o aviso some sozinho quando uma recarga der certo)
          set({ falhaRecarga: true })
          const espera = Math.min(30_000, 2000 * 2 ** tentativasRecarga++)
          timerRecarga = setTimeout(() => void get().recarregar(), espera)
        })
      return carregamento
    },

    async mesclarDadosAntigos(dados) {
      const r = await api.mesclar(dados)
      await get().recarregar()
      return r
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
      set((s) => ({ eventos: mesclar(s.eventos, salvo), contratos: contratosSeCancelado(s, salvo) }))
      return salvo
    },

    async alterarEvento(id, patch) {
      const salvo = await api.alterarEvento(id, patch)
      set((s) => ({ eventos: mesclar(s.eventos, salvo), contratos: contratosSeCancelado(s, salvo) }))
      return salvo
    },

    async duplicarEvento(id) {
      const novo = await api.duplicarEvento(id)
      set((s) => ({ eventos: mesclar(s.eventos, novo) }))
      return novo
    },

    async repetirEvento(id, datas) {
      const { original, criados } = await api.repetirEvento(id, datas)
      set((s) => ({ eventos: [original, ...criados].reduce(mesclar, s.eventos) }))
      return criados
    },

    async excluirEvento(id) {
      await api.excluirEvento(id)
      set((s) => ({
        eventos: s.eventos.filter((e) => e.id !== id),
        anexos: s.anexos.filter((a) => a.eventoId !== id),
        contratos: cancelarAguardando(s.contratos, id, 'Evento excluído.'),
      }))
    },

    async salvarMaquina(dados, alvo) {
      const salva = alvo ? await api.atualizarMaquina(alvo.id, dados, alvo.versao) : await api.criarMaquina(dados)
      set((s) => ({ maquinas: mesclarMaquina(s.maquinas, salva) }))
      return salva
    },

    async excluirMaquina(id) {
      await api.excluirMaquina(id)
      set((s) => ({ maquinas: s.maquinas.filter((m) => m.id !== id) }))
    },

    async ajustarQuantidade(tipo, quantidade) {
      const r = await api.ajustarQuantidade(tipo, quantidade)
      set((s) => {
        let maquinas = s.maquinas.filter((m) => !r.excluidas.includes(m.id))
        for (const m of [...r.criadas, ...r.desativadas]) maquinas = mesclar(maquinas, m)
        return { maquinas: ordenarMaquinas(maquinas) }
      })
      return r
    },

    async salvarOrdem(dados, alvo, statusMaquina) {
      const salva = alvo
        ? await api.atualizarOrdem(alvo.id, dados, alvo.versao, statusMaquina)
        : await api.criarOrdem(dados, statusMaquina)
      set((s) => ({
        ordens: mesclarOrdem(s.ordens, salva),
        // A situação da máquina chega pelo tempo real; aqui só antecipa para a tela não piscar
        maquinas:
          statusMaquina === undefined
            ? s.maquinas
            : s.maquinas.map((m) =>
                m.id === dados.maquinaId && m.status !== statusMaquina ? { ...m, status: statusMaquina } : m,
              ),
      }))
      return salva
    },

    async excluirOrdem(id) {
      await api.excluirOrdem(id)
      set((s) => ({ ordens: s.ordens.filter((o) => o.id !== id) }))
    },

    async salvarReclamacao(dados, alvo) {
      const salva = alvo ? await api.atualizarReclamacao(alvo.id, dados, alvo.versao) : await api.criarReclamacao(dados)
      set((s) => ({ reclamacoes: mesclarReclamacao(s.reclamacoes, salva) }))
      return salva
    },

    async excluirReclamacao(id) {
      await api.excluirReclamacao(id)
      set((s) => ({ reclamacoes: s.reclamacoes.filter((r) => r.id !== id) }))
    },

    async enviarAnexo(eventoId, arquivo, nome, aoProgresso) {
      const anexo = await api.enviarAnexo(eventoId, arquivo, nome, aoProgresso)
      set((s) => ({ anexos: mesclarAnexo(s.anexos, anexo) }))
      return anexo
    },

    async excluirAnexo(id) {
      await api.excluirAnexo(id)
      set((s) => ({ anexos: s.anexos.filter((a) => a.id !== id) }))
    },

    async gerarContrato(dados) {
      const novo = await api.criarContrato(dados)
      set((s) => ({
        contratos: mesclarContrato(
          cancelarAguardando(s.contratos, novo.eventoId, `Substituído pelo contrato ${codigoContrato(novo.numero)}.`, novo.id),
          novo,
        ),
      }))
      return novo
    },

    async excluirContrato(id) {
      await api.excluirContrato(id)
      set((s) => ({ contratos: s.contratos.filter((c) => c.id !== id) }))
    },

    async alterarContrato(id, mudanca, versao) {
      const salvo = await api.alterarContrato(id, mudanca, versao)
      set((s) => ({ contratos: mesclarContrato(s.contratos, salvo) }))
      return salvo
    },

    async enviarContratoAssinado(id, arquivo, nome, aoProgresso) {
      const salvo = await api.enviarContratoAssinado(id, arquivo, nome, aoProgresso)
      set((s) => ({ contratos: mesclarContrato(s.contratos, salvo) }))
      return salvo
    },

    async removerContratoAssinado(id) {
      const salvo = await api.removerContratoAssinado(id)
      set((s) => ({ contratos: mesclarContrato(s.contratos, salvo) }))
      return salvo
    },

    async salvarConfig(config) {
      const salvo = await api.salvarConfig(config)
      set({ config: salvo })
      return salvo
    },

    async salvarServicos(servicos) {
      const salvo = await api.salvarServicos(servicos)
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
