// Máquinas (P e G), situação de cada uma e ordens de serviço de manutenção.
// Usado pelo servidor e pela interface, para que as regras sejam sempre as mesmas.

import type { Tone } from './calc.ts'
import type { Configuracoes, Evento, Maquina, OrdemServico, StatusMaquina, StatusOS, TipoMaquina, TipoOS } from './tipos.ts'

export const TIPOS_MAQUINA: TipoMaquina[] = ['P', 'G']

export const TIPO_MAQUINA: Record<TipoMaquina, { label: string; plural: string; descricao: string }> = {
  P: { label: 'Máquina P', plural: 'Máquinas P', descricao: 'Pequena' },
  G: { label: 'Máquina G', plural: 'Máquinas G', descricao: 'Grande' },
}

export const STATUS_MAQUINA_LISTA: StatusMaquina[] = ['DISPONIVEL', 'MANUTENCAO', 'DESATIVADA']

/** Situação exibida: a cadastrada, ou "Locada" quando a máquina está num evento em andamento. */
export type EstadoMaquina = 'DISPONIVEL' | 'LOCADA' | 'MANUTENCAO' | 'DESATIVADA'

export const ESTADO_MAQUINA: Record<EstadoMaquina, { label: string; tone: Tone }> = {
  DISPONIVEL: { label: 'Disponível', tone: 'success' },
  LOCADA: { label: 'Locada', tone: 'info' },
  MANUTENCAO: { label: 'Em manutenção', tone: 'warning' },
  DESATIVADA: { label: 'Desativada', tone: 'neutral' },
}

export const STATUS_OS_LISTA: StatusOS[] = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']

export const STATUS_OS: Record<StatusOS, { label: string; tone: Tone }> = {
  ABERTA: { label: 'Aberta', tone: 'warning' },
  EM_ANDAMENTO: { label: 'Em andamento', tone: 'info' },
  CONCLUIDA: { label: 'Concluída', tone: 'success' },
  CANCELADA: { label: 'Cancelada', tone: 'neutral' },
}

export const TIPOS_OS: TipoOS[] = ['PREVENTIVA', 'CORRETIVA']

export const TIPO_OS: Record<TipoOS, { label: string; descricao: string }> = {
  PREVENTIVA: { label: 'Preventiva', descricao: 'Revisão, limpeza e cuidados de rotina' },
  CORRETIVA: { label: 'Corretiva', descricao: 'Conserto de um problema ou defeito' },
}

/** Serviços sugeridos na O.S. (outros podem ser digitados). */
export const SERVICOS_PADRAO = [
  'Limpeza completa',
  'Higienização',
  'Revisão geral',
  'Troca de peças',
  'Reparo da impressora',
  'Reparo elétrico',
  'Teste de funcionamento',
]

/** "O.S. 0007" */
export const codigoOS = (numero: number) => `O.S. ${String(numero).padStart(4, '0')}`

/** O.S. que ainda precisam de atenção. */
export const osEmAberto = (o: Pick<OrdemServico, 'status'>) => o.status === 'ABERTA' || o.status === 'EM_ANDAMENTO'

/** Identificação sugerida para a n-ésima máquina do tipo: "P-01", "G-12". */
export const identificacaoPadrao = (tipo: TipoMaquina, n: number) => `${tipo}-${String(n).padStart(2, '0')}`

/**
 * Chave para comparar identificações: sem diferenciar maiúsculas, acentos, espaços, hífens e
 * zeros à esquerda ("P-01", "p01" e "P 1" são a mesma máquina; "Máquina 01" = "maquina 1").
 */
export const chaveIdentificacao = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/(^|[^0-9])0+(?=[0-9])/g, '$1')

/** Número de uma identificação no padrão do tipo ("P-07", "p7", "P 07" → 7); `null` se não seguir o padrão. */
export function numeroDaIdentificacao(identificacao: string, tipo: TipoMaquina): number | null {
  const m = /^([PG])\s*-?\s*0*(\d{1,6})$/i.exec(identificacao.trim())
  return m && m[1].toUpperCase() === tipo ? Number(m[2]) : null
}

/** Próximas `quantidade` identificações livres do tipo, continuando a numeração existente. */
export function proximasIdentificacoes(maquinas: Maquina[], tipo: TipoMaquina, quantidade: number): string[] {
  const usadas = new Set(maquinas.map((m) => chaveIdentificacao(m.identificacao)))
  const doTipo = maquinas.filter((m) => m.tipo === tipo)
  let n = Math.max(0, ...doTipo.map((m) => numeroDaIdentificacao(m.identificacao, tipo) ?? 0))
  const novas: string[] = []
  while (novas.length < quantidade) {
    const id = identificacaoPadrao(tipo, ++n)
    if (!usadas.has(chaveIdentificacao(id))) novas.push(id)
  }
  return novas
}

/** Ordem natural: P antes de G, depois "P-2" antes de "P-10". */
export function compararMaquinas(a: Pick<Maquina, 'tipo' | 'identificacao'>, b: Pick<Maquina, 'tipo' | 'identificacao'>) {
  if (a.tipo !== b.tipo) return a.tipo === 'P' ? -1 : 1
  return a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

export const ordenarMaquinas = <T extends Pick<Maquina, 'tipo' | 'identificacao'>>(lista: T[]) =>
  [...lista].sort(compararMaquinas)

// ---- Eventos e máquinas --------------------------------------------------------

type EventoPeriodo = Pick<Evento, 'dias'>

/** Primeiro e último dia do evento (`null` sem dias). */
export function periodoEvento(e: EventoPeriodo): { inicio: string; fim: string } | null {
  const datas = e.dias
    .map((d) => d.data)
    .filter(Boolean)
    .sort()
  return datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null
}

const linhasDoCabecalho = (cabecalho: string) =>
  cabecalho
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** Onde a máquina está quando locada: a primeira linha do cabeçalho das fichas, ou o nome do evento. */
export function localDaLocacao(e: Pick<Evento, 'cabecalho' | 'nome'>) {
  return linhasDoCabecalho(e.cabecalho)[0] || e.nome
}

/** O cabeçalho inteiro numa linha ("FESTA DA PRIMAVERA · CLUBE RECREATIVO"), ou o nome do evento. */
export function cabecalhoEmLinha(e: Pick<Evento, 'cabecalho' | 'nome'>) {
  return linhasDoCabecalho(e.cabecalho).join(' · ') || e.nome
}

export interface SituacaoMaquina {
  estado: EstadoMaquina
  /** Evento com esta máquina que tem hoje entre os seus dias. */
  evento?: Evento
  /** Próximo evento com esta máquina (o de próximo dia de uso depois de hoje). */
  proxima?: Evento
  /** Próximo dia de uso (`yyyy-MM-dd`) em `proxima`. */
  dataProxima?: string
}

/**
 * Situação da máquina em `hoje` (`yyyy-MM-dd`): desativada e em manutenção valem o cadastro;
 * fora disso, "Locada" quando hoje é um dos dias de um evento não cancelado com a máquina.
 * Conta só os dias cadastrados (como a agenda e os conflitos): num evento de 27/09 e 04/10,
 * a máquina fica livre no meio da semana.
 */
export function situacaoMaquina(maquina: Pick<Maquina, 'id' | 'status'>, eventos: Evento[], hoje: string): SituacaoMaquina {
  if (maquina.status === 'DESATIVADA') return { estado: 'DESATIVADA' }
  let evento: Evento | undefined
  let inicioEvento = ''
  let proxima: Evento | undefined
  let dataProxima = ''
  for (const e of eventos) {
    if (e.status === 'CANCELADO' || !e.maquinasIds.includes(maquina.id)) continue
    const datas = e.dias
      .map((d) => d.data)
      .filter(Boolean)
      .sort()
    if (datas.includes(hoje)) {
      if (!evento || datas[0] < inicioEvento) [evento, inicioEvento] = [e, datas[0]]
      continue
    }
    const seguinte = datas.find((d) => d > hoje)
    if (seguinte && (!dataProxima || seguinte < dataProxima)) [proxima, dataProxima] = [e, seguinte]
  }
  const futuro = proxima ? { proxima, dataProxima } : {}
  if (maquina.status === 'MANUTENCAO') return { estado: 'MANUTENCAO', evento, ...futuro }
  return evento ? { estado: 'LOCADA', evento, ...futuro } : { estado: 'DISPONIVEL', ...futuro }
}

/**
 * Para cada máquina do evento, os outros eventos (não cancelados) que usam a mesma máquina
 * em alguma das mesmas datas.
 */
export function conflitosMaquinas(
  evento: Pick<Evento, 'dias' | 'maquinasIds'> & { id?: string },
  eventos: Evento[],
): Map<string, Evento[]> {
  const datas = new Set(evento.dias.map((d) => d.data).filter(Boolean))
  const mapa = new Map<string, Evento[]>()
  if (!datas.size) return mapa
  for (const outro of eventos) {
    if (outro.id === evento.id || outro.status === 'CANCELADO') continue
    if (!outro.dias.some((d) => datas.has(d.data))) continue
    for (const id of outro.maquinasIds) {
      if (!evento.maquinasIds.includes(id)) continue
      mapa.set(id, [...(mapa.get(id) ?? []), outro])
    }
  }
  return mapa
}

/** Ocupação de cada máquina nas datas informadas: id da máquina → eventos que a usam nessas datas. */
export function maquinasOcupadas(datas: string[], eventos: Evento[], ignorarId?: string): Map<string, Evento[]> {
  const alvo = new Set(datas.filter(Boolean))
  const mapa = new Map<string, Evento[]>()
  for (const e of eventos) {
    if (e.id === ignorarId || e.status === 'CANCELADO' || !e.dias.some((d) => alvo.has(d.data))) continue
    for (const id of e.maquinasIds) mapa.set(id, [...(mapa.get(id) ?? []), e])
  }
  return mapa
}

export interface Capacidade {
  P: number
  G: number
  /** Máquinas que a empresa tem (não desativadas); sem máquinas cadastradas, `config.frotaMaquinas`. */
  total: number
  /** Quantas das máquinas em `total` estão em manutenção agora. */
  manutencao: number
  /** `false` enquanto nenhuma máquina foi cadastrada (o total vem das configurações). */
  cadastradas: boolean
}

export function capacidade(maquinas: Maquina[], config: Pick<Configuracoes, 'frotaMaquinas'>): Capacidade {
  if (!maquinas.length) return { P: 0, G: 0, total: config.frotaMaquinas, manutencao: 0, cadastradas: false }
  const ativas = maquinas.filter((m) => m.status !== 'DESATIVADA')
  const P = ativas.filter((m) => m.tipo === 'P').length
  const G = ativas.length - P
  return { P, G, total: ativas.length, manutencao: ativas.filter((m) => m.status === 'MANUTENCAO').length, cadastradas: true }
}

// ---- Ajuste da quantidade de máquinas de um tipo ---------------------------------

export interface PlanoAjuste {
  tipo: TipoMaquina
  /** Quantidade atual de máquinas do tipo que não estão desativadas. */
  atual: number
  alvo: number
  /** Identificações das máquinas que serão cadastradas. */
  criar: string[]
  /** Máquinas sem nenhum histórico: são apagadas. */
  excluir: Maquina[]
  /** Máquinas com histórico (O.S. ou eventos): ficam desativadas, com o histórico preservado. */
  desativar: Maquina[]
  /** Quantas não puderam ser retiradas (em manutenção, ou com eventos hoje ou no futuro). */
  faltam: number
  /** Máquinas do tipo que não podem ser retiradas agora, e o motivo. */
  presas: { manutencao: Maquina[]; eventos: Maquina[] }
}

/**
 * O que fazer para o tipo passar a ter `alvo` máquinas (não desativadas). Para diminuir, retira
 * as de identificação mais alta que estão disponíveis e sem eventos de hoje em diante.
 */
export function planoAjuste(
  maquinas: Maquina[],
  eventos: Evento[],
  ordens: OrdemServico[],
  tipo: TipoMaquina,
  alvo: number,
  hoje: string,
): PlanoAjuste {
  const ativas = maquinas.filter((m) => m.tipo === tipo && m.status !== 'DESATIVADA')
  const plano: PlanoAjuste = {
    tipo,
    atual: ativas.length,
    alvo,
    criar: [],
    excluir: [],
    desativar: [],
    faltam: 0,
    presas: { manutencao: [], eventos: [] },
  }
  if (alvo > ativas.length) {
    plano.criar = proximasIdentificacoes(maquinas, tipo, alvo - ativas.length)
    return plano
  }
  let sobrando = ativas.length - alvo
  if (!sobrando) return plano
  // Histórico inclui eventos cancelados: a máquina continua referenciada neles
  const usadas = new Set(eventos.flatMap((e) => e.maquinasIds))
  const comOS = new Set(ordens.map((o) => o.maquinaId))
  const ocupadaDeHojeEmDiante = (id: string) =>
    eventos.some((e) => {
      if (e.status === 'CANCELADO' || !e.maquinasIds.includes(id)) return false
      const p = periodoEvento(e)
      return !!p && p.fim >= hoje
    })
  const candidatas: Maquina[] = []
  for (const m of ativas) {
    if (m.status === 'MANUTENCAO') plano.presas.manutencao.push(m)
    else if (ocupadaDeHojeEmDiante(m.id)) plano.presas.eventos.push(m)
    else candidatas.push(m)
  }
  candidatas.sort((a, b) => compararMaquinas(b, a))
  for (const m of candidatas) {
    if (!sobrando) break
    if (usadas.has(m.id) || comOS.has(m.id)) plano.desativar.push(m)
    else plano.excluir.push(m)
    sobrando--
  }
  plano.faltam = sobrando
  return plano
}
