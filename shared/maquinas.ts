// Máquinas (P e G), situação de cada uma, manutenções e ocupação nos eventos.
// Usado pelo servidor e pela interface, para que as regras sejam sempre as mesmas.

import type { Tone } from './calc.ts'
import type {
  Configuracoes,
  DiaEvento,
  Evento,
  Maquina,
  OrdemServico,
  Reclamacao,
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
  /** Máquinas titulares. */
  maquinas: number
  /** Máquinas reserva com o cliente (também estão fora da empresa). */
  reservas: number
  /** Quantas reservas foram usadas (e cobradas) no dia; 0 nos dias sem uso. */
  reservasUsadas: number
  /** `true` nos dias de uso (contam diária); `false` nos dias em que só ficam com o cliente. */
  uso: boolean
}

type QuantidadesDia = Pick<DiaEvento, 'maquinas' | 'reservas' | 'reservasUsadas'>

/** O mínimo de um evento para calcular os dias ocupados (as quantidades são opcionais). */
export type EventoOcupacao = {
  dias: Array<Pick<DiaEvento, 'data'> & Partial<QuantidadesDia>>
  periodoCorrido?: boolean
}

const qtd = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0)

/** Máquinas fora da empresa no dia: titulares + reservas. */
export const totalDia = (d: Partial<Pick<DiaEvento, 'maquinas' | 'reservas'>>) => qtd(d.maquinas) + qtd(d.reservas)

/** Reservas do dia (0 em dias gravados antes da máquina reserva). */
export const reservasDia = (d: Partial<Pick<DiaEvento, 'reservas'>>) => qtd(d.reservas)

/** Reservas usadas (cobradas) no dia, nunca mais que as reservas. */
export const reservasUsadasDia = (d: Partial<Pick<DiaEvento, 'reservas' | 'reservasUsadas'>>) =>
  Math.min(qtd(d.reservasUsadas), qtd(d.reservas))

/** Data `yyyy-MM-dd` somada de `n` dias (pode ser negativo), sem depender do fuso. */
export function somarDias(data: string, n: number) {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Dias de `de` até `ate` (`yyyy-MM-dd`; negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string) {
  const utc = (s: string) => {
    const [a, m, d] = s.split('-').map(Number)
    return Date.UTC(a, m - 1, d)
  }
  return Math.round((utc(ate) - utc(de)) / 86_400_000)
}

/** Dia seguinte (`yyyy-MM-dd`), sem depender do fuso. */
const diaSeguinte = (data: string) => somarDias(data, 1)

/**
 * Dias em que as máquinas do evento ficam fora da empresa (titulares e reservas). Normalmente,
 * só os dias de uso, com a quantidade de cada um. Com `periodoCorrido` (as máquinas ficam com o
 * cliente entre um uso e outro), todos os dias do primeiro ao último, sempre com as maiores
 * quantidades do evento: o cliente fica com todas as máquinas o período inteiro. Base da agenda,
 * da disponibilidade e dos conflitos.
 */
export function diasOcupados(e: EventoOcupacao): DiaOcupado[] {
  const uso = new Map<string, QuantidadesDia>()
  for (const d of e.dias) {
    if (!d.data) continue
    const atual = uso.get(d.data) ?? { maquinas: 0, reservas: 0, reservasUsadas: 0 }
    uso.set(d.data, {
      maquinas: atual.maquinas + qtd(d.maquinas),
      reservas: atual.reservas + reservasDia(d),
      reservasUsadas: atual.reservasUsadas + reservasUsadasDia(d),
    })
  }
  const datas = [...uso.keys()].sort()
  if (!e.periodoCorrido || datas.length < 2) return datas.map((data) => ({ data, ...uso.get(data)!, uso: true }))
  // O cliente fica com todas: as titulares do dia de mais titulares, e as reservas que completam o
  // dia de mais máquinas no total
  const valores = [...uso.values()]
  const maquinas = Math.max(...valores.map((v) => v.maquinas))
  const reservas = Math.max(...valores.map((v) => v.maquinas + v.reservas)) - maquinas
  const dia = (data: string): DiaOcupado => {
    const usadas = uso.get(data)?.reservasUsadas ?? 0
    return { data, maquinas, reservas, reservasUsadas: Math.min(usadas, reservas), uso: uso.has(data) }
  }
  const lista: DiaOcupado[] = []
  // Limite de segurança: um período corrido de no máximo ~2 anos
  for (let data = datas[0], n = 0; data <= datas[datas.length - 1] && n < 800; data = diaSeguinte(data), n++) {
    lista.push(dia(data))
  }
  // Período absurdo (mais de 800 dias): os dias de uso depois do limite continuam contando
  const ultimo = lista[lista.length - 1].data
  for (const data of datas) if (data > ultimo) lista.push(dia(data))
  return lista
}

/** "4+1" (titulares + reservas) ou só "4" sem reserva — como a agenda mostra. */
export const quantidadeCurta = (maquinas: number, reservas = 0) => (reservas > 0 ? `${maquinas}+${reservas}` : String(maquinas))

/** "4 máquinas + 1 reserva", "1 máquina", "3 máquinas + 2 reservas". */
export function quantidadePorExtenso(maquinas: number, reservas = 0) {
  const titulares = `${maquinas} ${maquinas === 1 ? 'máquina' : 'máquinas'}`
  return reservas > 0 ? `${titulares} + ${reservas} ${reservas === 1 ? 'reserva' : 'reservas'}` : titulares
}

/** Uma reserva parada (com o cliente, sem uso) num dia: onde dá para buscar uma máquina se faltar. */
export interface ReservaParada {
  evento: Evento
  /** Quantas reservas do evento estão paradas no dia. */
  paradas: number
  /** As máquinas marcadas como reserva no evento (podem ser menos que `paradas`, se faltar marcar). */
  maquinasIds: string[]
}

/** Eventos (não cancelados) com máquina reserva parada em `data`, do que tem mais para o que tem menos. */
export function reservasParadas(eventos: Evento[], data: string): ReservaParada[] {
  const lista: ReservaParada[] = []
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO') continue
    const dia = diasOcupados(evento).find((d) => d.data === data)
    const paradas = dia ? dia.reservas - dia.reservasUsadas : 0
    if (paradas > 0) lista.push({ evento, paradas, maquinasIds: evento.reservasIds ?? [] })
  }
  return lista.sort((a, b) => b.paradas - a.paradas || a.evento.nome.localeCompare(b.evento.nome, 'pt-BR'))
}

/** "11/10" a partir de "2026-10-11". */
export const dataCurtinha = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** "11/10", "11/10 e 12/10", "11/10, 12/10 e 13/10", "11/10, 12/10, 13/10 e mais 2 dias". */
export function listaDatas(datas: string[]): string {
  const curtas = [...new Set(datas)].sort().map(dataCurtinha)
  if (curtas.length <= 1) return curtas.join('')
  if (curtas.length > 4) return `${curtas.slice(0, 3).join(', ')} e mais ${curtas.length - 3} dias`
  return `${curtas.slice(0, -1).join(', ')} e ${curtas[curtas.length - 1]}`
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
  /** A máquina está em `evento` como reserva (locada, mas parada com o cliente se não for usada). */
  reserva?: boolean
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
  const reserva = evento?.reservasIds?.includes(maquina.id) ? { reserva: true } : {}
  if (maquina.status === 'MANUTENCAO') return { estado: 'MANUTENCAO', evento, ...reserva, ...futuro }
  return evento ? { estado: 'LOCADA', evento, ...reserva, ...futuro } : { estado: 'DISPONIVEL', ...futuro }
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
  /** Máquinas com histórico (manutenções, reclamações ou eventos): ficam desativadas, com o histórico preservado. */
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
  /** Reclamações de clientes: também são histórico (a máquina com reclamação é desativada, não apagada). */
  reclamacoes: Array<Pick<Reclamacao, 'maquinaId'>> = [],
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
  const comOS = new Set([...ordens.map((o) => o.maquinaId), ...reclamacoes.map((r) => r.maquinaId)])
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
