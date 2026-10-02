// Máquinas (P e G), situação de cada uma, manutenções e ocupação nos eventos.
// Usado pelo servidor e pela interface, para que as regras sejam sempre as mesmas.

import type { Tone } from './calc.ts'
import type {
  Configuracoes,
  DiaEvento,
  Evento,
  Maquina,
  OrdemServico,
  StatusMaquina,
  StatusOS,
  StatusProgramacao,
  TipoMaquina,
  TipoOS,
} from './tipos.ts'

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

/** Situação da manutenção (os códigos são os da antiga "O.S."). */
export const STATUS_OS: Record<StatusOS, { label: string; tone: Tone; descricao: string }> = {
  ABERTA: { label: 'Iniciada', tone: 'warning', descricao: 'Registrada, aguardando o serviço' },
  EM_ANDAMENTO: { label: 'Em andamento', tone: 'info', descricao: 'O serviço está sendo feito' },
  CONCLUIDA: { label: 'Concluída', tone: 'success', descricao: 'Serviço pronto' },
  CANCELADA: { label: 'Cancelada', tone: 'neutral', descricao: 'Não vai mais ser feita' },
}

export const TIPOS_OS: TipoOS[] = ['PREVENTIVA', 'CORRETIVA']

export const TIPO_OS: Record<TipoOS, { label: string; descricao: string }> = {
  PREVENTIVA: { label: 'Preventiva', descricao: 'Revisão, limpeza e cuidados de rotina' },
  CORRETIVA: { label: 'Corretiva', descricao: 'Conserto de um problema ou defeito' },
}

/** Chave para comparar nomes de serviço sem diferenciar maiúsculas, acentos e espaços. */
export const chaveServico = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()

/** Número da manutenção para exibir: "nº 0007". */
export const codigoOS = (numero: number) => `nº ${String(numero).padStart(4, '0')}`

export const STATUS_PROGRAMACAO_LISTA: StatusProgramacao[] = ['NAO_INICIADA', 'EM_PROGRAMACAO', 'ENVIADA', 'CONCLUIDA']

/** Andamento da programação das máquinas para o evento. */
export const STATUS_PROGRAMACAO: Record<StatusProgramacao, { label: string; tone: Tone; descricao: string }> = {
  NAO_INICIADA: { label: 'Não iniciada', tone: 'warning', descricao: 'Ainda não começou a programar' },
  EM_PROGRAMACAO: { label: 'Em programação', tone: 'info', descricao: 'As máquinas estão sendo programadas' },
  ENVIADA: { label: 'Enviada ao cliente', tone: 'brand', descricao: 'Aguardando o cliente conferir' },
  CONCLUIDA: { label: 'Concluída', tone: 'success', descricao: 'Programação pronta' },
}

/** Manutenções que ainda precisam de atenção. */
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

/** Um dia em que as máquinas do evento estão fora da empresa. */
export interface DiaOcupado {
  data: string
  maquinas: number
  /** `true` nos dias de uso (contam diária); `false` nos dias em que só ficam com o cliente. */
  uso: boolean
}

/** O mínimo de um evento para calcular os dias ocupados (a quantidade de máquinas é opcional). */
export type EventoOcupacao = {
  dias: Array<Pick<DiaEvento, 'data'> & Partial<Pick<DiaEvento, 'maquinas'>>>
  periodoCorrido?: boolean
}

const somaDia = (d: Partial<Pick<DiaEvento, 'maquinas'>>) => Number(d.maquinas) || 0

/** Dia seguinte (`yyyy-MM-dd`), sem depender do fuso. */
function diaSeguinte(data: string) {
  const [a, m, d] = data.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + 1))
  return dt.toISOString().slice(0, 10)
}

/**
 * Dias em que as máquinas do evento ficam fora da empresa. Normalmente, só os dias de uso, com a
 * quantidade de cada um. Com `periodoCorrido` (as máquinas ficam com o cliente entre um uso e
 * outro), todos os dias do primeiro ao último, sempre com a maior quantidade do evento: o cliente
 * fica com todas as máquinas o período inteiro. Base da agenda, da disponibilidade e dos conflitos.
 */
export function diasOcupados(e: EventoOcupacao): DiaOcupado[] {
  const uso = new Map<string, number>()
  for (const d of e.dias) if (d.data) uso.set(d.data, (uso.get(d.data) ?? 0) + somaDia(d))
  const datas = [...uso.keys()].sort()
  if (!e.periodoCorrido || datas.length < 2) return datas.map((data) => ({ data, maquinas: uso.get(data)!, uso: true }))
  const maior = Math.max(...uso.values())
  const lista: DiaOcupado[] = []
  // Limite de segurança: um período corrido de no máximo ~2 anos
  for (let data = datas[0], n = 0; data <= datas[datas.length - 1] && n < 800; data = diaSeguinte(data), n++) {
    lista.push({ data, maquinas: maior, uso: uso.has(data) })
  }
  return lista
}

/** Só as datas de `diasOcupados`. */
export const datasOcupadas = (e: EventoOcupacao) => diasOcupados(e).map((d) => d.data)

/** Primeiro e último dia do evento (`null` sem dias). */
export function periodoEvento(e: EventoPeriodo): { inicio: string; fim: string } | null {
  const datas = e.dias
    .map((d) => d.data)
    .filter(Boolean)
    .sort()
  return datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null
}

/** Onde a máquina está quando locada: o nome do evento (que é o topo das fichas programadas). */
export function localDaLocacao(e: Pick<Evento, 'nome'>) {
  return e.nome
}

/** Nome do evento numa linha (antes vinha do cabeçalho das fichas). */
export function cabecalhoEmLinha(e: Pick<Evento, 'nome'>) {
  return e.nome
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
 * fora disso, "Locada" quando hoje é um dos dias ocupados de um evento não cancelado com a
 * máquina (ver `diasOcupados`): num evento de 27/09 e 04/10, a máquina fica livre no meio da
 * semana — a não ser que o evento tenha o período corrido (ela fica com o cliente).
 */
export function situacaoMaquina(maquina: Pick<Maquina, 'id' | 'status'>, eventos: Evento[], hoje: string): SituacaoMaquina {
  if (maquina.status === 'DESATIVADA') return { estado: 'DESATIVADA' }
  let evento: Evento | undefined
  let inicioEvento = ''
  let proxima: Evento | undefined
  let dataProxima = ''
  for (const e of eventos) {
    if (e.status === 'CANCELADO' || !e.maquinasIds.includes(maquina.id)) continue
    const datas = datasOcupadas(e)
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
 * em alguma das mesmas datas (dias ocupados dos dois lados, ver `diasOcupados`).
 */
export function conflitosMaquinas(
  evento: EventoOcupacao & Pick<Evento, 'maquinasIds'> & { id?: string },
  eventos: Evento[],
): Map<string, Evento[]> {
  const datas = new Set(datasOcupadas(evento))
  const mapa = new Map<string, Evento[]>()
  if (!datas.size) return mapa
  for (const outro of eventos) {
    if (outro.id === evento.id || outro.status === 'CANCELADO') continue
    if (!datasOcupadas(outro).some((d) => datas.has(d))) continue
    for (const id of outro.maquinasIds) {
      if (!evento.maquinasIds.includes(id)) continue
      mapa.set(id, [...(mapa.get(id) ?? []), outro])
    }
  }
  return mapa
}

/**
 * Ocupação de cada máquina nas datas informadas: id da máquina → eventos que a têm nessas datas
 * (pelos dias ocupados de cada evento, ver `diasOcupados`).
 */
export function maquinasOcupadas(datas: string[], eventos: Evento[], ignorarId?: string): Map<string, Evento[]> {
  const alvo = new Set(datas.filter(Boolean))
  const mapa = new Map<string, Evento[]>()
  for (const e of eventos) {
    if (e.id === ignorarId || e.status === 'CANCELADO' || !datasOcupadas(e).some((d) => alvo.has(d))) continue
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
