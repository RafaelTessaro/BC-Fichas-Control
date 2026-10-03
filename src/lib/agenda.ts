// Regras da agenda: ocupação de cada dia (titulares + reservas), resumo do mês e do ano com a
// comparação com o ano anterior, faixas do mapa de calor do ano, mês/dia vindos da URL e as teclas
// de atalho. Funções puras, testadas em agenda.test.ts.

import { diasOcupados, quantidadeCurta, reservasUsadasDia, somarDias } from '#shared/maquinas.ts'
import type { Evento } from '#shared/tipos.ts'
import { dataComDiaDaSemana, diaDaSemana } from './repeticao'

/** O que a agenda precisa de um evento. */
export type EventoAgenda = Pick<Evento, 'id' | 'nome' | 'status' | 'dias' | 'periodoCorrido'>

/** Um evento num dia da agenda. */
export interface Ocorrencia<T> {
  item: T
  /** Máquinas titulares fora no dia (com período corrido, as do evento inteiro). */
  maquinas: number
  /** Máquinas reserva com o cliente no dia (também estão fora da empresa). */
  reservas: number
  /** Quantas reservas o cliente usou no dia (cobradas). */
  reservasUsadas: number
  /** `false` nos dias em que as máquinas só ficam com o cliente, entre os dias de uso. */
  uso: boolean
  /** Diárias cobradas no dia: titulares + reservas usadas (0 nos dias sem uso). */
  diarias: number
}

export type PorDia<T> = Map<string, Array<Ocorrencia<T>>>

const ativa = (o: Ocorrencia<{ evento: EventoAgenda }>) => o.item.evento.status !== 'CANCELADO'

/** No dia: os ativos antes dos cancelados, os de uso antes dos que só estão com as máquinas, os maiores primeiro. */
function ordemNoDia(a: Ocorrencia<{ evento: EventoAgenda }>, b: Ocorrencia<{ evento: EventoAgenda }>) {
  return (
    Number(ativa(b)) - Number(ativa(a)) ||
    Number(b.uso) - Number(a.uso) ||
    b.maquinas + b.reservas - (a.maquinas + a.reservas) ||
    a.item.evento.nome.localeCompare(b.item.evento.nome, 'pt-BR')
  )
}

/**
 * Eventos de cada dia (`yyyy-MM-dd`), pelos dias ocupados (com período corrido, também os dias em
 * que as máquinas só ficam com o cliente). Inclui os cancelados (a agenda mostra riscados); as
 * contas de ocupação e de diárias os deixam de fora.
 */
export function ocorrenciasPorDia<T extends { evento: EventoAgenda }>(itens: T[]): PorDia<T> {
  const mapa: PorDia<T> = new Map()
  for (const item of itens) {
    // Diárias cobradas pelos dias de uso, como no cálculo do evento
    const cobradas = new Map<string, number>()
    for (const d of item.evento.dias) {
      if (!d.data) continue
      cobradas.set(d.data, (cobradas.get(d.data) ?? 0) + (Number(d.maquinas) || 0) + reservasUsadasDia(d))
    }
    for (const d of diasOcupados(item.evento)) {
      const lista = mapa.get(d.data) ?? []
      lista.push({
        item,
        maquinas: d.maquinas,
        reservas: d.reservas,
        reservasUsadas: d.reservasUsadas,
        uso: d.uso,
        diarias: d.uso ? (cobradas.get(d.data) ?? 0) : 0,
      })
      mapa.set(d.data, lista)
    }
  }
  for (const lista of mapa.values()) lista.sort(ordemNoDia)
  return mapa
}

/** Máquinas fora da empresa no dia (titulares + reservas dos eventos não cancelados). */
export const foraNoDia = (lista: Array<Ocorrencia<{ evento: EventoAgenda }>> = []) =>
  lista.reduce((s, o) => s + (ativa(o) ? o.maquinas + o.reservas : 0), 0)

/** Parte das máquinas fora que só está com o cliente (dias sem uso do período corrido). */
export const soComClienteNoDia = (lista: Array<Ocorrencia<{ evento: EventoAgenda }>> = []) =>
  lista.reduce((s, o) => s + (ativa(o) && !o.uso ? o.maquinas + o.reservas : 0), 0)

/** Reservas com o cliente no dia (eventos não cancelados). */
export const reservasNoDia = (lista: Array<Ocorrencia<{ evento: EventoAgenda }>> = []) =>
  lista.reduce((s, o) => s + (ativa(o) ? o.reservas : 0), 0)

/** Cor da barra de ocupação do dia: verde, amarela a partir de 80% e vermelha acima do total. */
export const corBarra = (pct: number) => (pct > 1 ? 'bg-danger' : pct >= 0.8 ? 'bg-warning-dot' : 'bg-brand')

// ---- Resumo do mês / do ano e comparação ---------------------------------------------

export interface ResumoPeriodo {
  /** Eventos (não cancelados) com máquinas fora em algum dia do período. */
  eventos: number
  /** Diárias cobradas nos dias do período: titulares + reservas usadas, só nos dias de uso. */
  diarias: number
  /** Maior número de máquinas fora (titulares + reservas) num mesmo dia. */
  pico: number
  /** Dias com mais máquinas fora do que a empresa tem. */
  diasAcima: number
  /** Eventos de qualquer situação (inclusive cancelados) no período: 0 é "sem registros". */
  registros: number
}

/** Resumo dos dias de `de` a `ate` (`yyyy-MM-dd`, inclusive); `capacidadeDoDia` diz quantas máquinas a empresa tem no dia. */
export function resumoPeriodo<T extends { evento: EventoAgenda }>(
  porDia: PorDia<T>,
  de: string,
  ate: string,
  capacidadeDoDia: (data: string) => number,
): ResumoPeriodo {
  const eventos = new Set<string>()
  const registros = new Set<string>()
  let diarias = 0
  let pico = 0
  let diasAcima = 0
  // Limite de segurança: no máximo um ano e pouco
  for (let data = de, n = 0; data <= ate && n < 400; data = somarDias(data, 1), n++) {
    const lista = porDia.get(data)
    if (!lista) continue
    let fora = 0
    for (const o of lista) {
      registros.add(o.item.evento.id)
      if (!ativa(o)) continue
      eventos.add(o.item.evento.id)
      diarias += o.diarias
      fora += o.maquinas + o.reservas
    }
    pico = Math.max(pico, fora)
    if (fora > capacidadeDoDia(data)) diasAcima++
  }
  return { eventos: eventos.size, diarias, pico, diasAcima, registros: registros.size }
}

/** Resumo de cada mês do ano (janeiro = posição 0). */
export function resumoDosMeses<T extends { evento: EventoAgenda }>(
  porDia: PorDia<T>,
  ano: number,
  capacidadeDoDia: (data: string) => number,
): ResumoPeriodo[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = chaveMes(ano, i + 1)
    return resumoPeriodo(porDia, inicioDoMes(mes), fimDoMes(mes), capacidadeDoDia)
  })
}

export type Direcao = 'mais' | 'menos' | 'igual'

export interface Variacao {
  atual: number
  anterior: number
  /** `atual − anterior`. */
  diferenca: number
  direcao: Direcao
}

export function variacao(atual: number, anterior: number): Variacao {
  const diferenca = atual - anterior
  return { atual, anterior, diferenca, direcao: diferenca > 0 ? 'mais' : diferenca < 0 ? 'menos' : 'igual' }
}

/** "▲ 2", "▼ 3" ou "= igual": a seta e o número dizem a direção (não só a cor). */
export function textoVariacao(v: Variacao) {
  if (v.direcao === 'igual') return '= igual'
  return `${v.direcao === 'mais' ? '▲' : '▼'} ${Math.abs(v.diferenca).toLocaleString('pt-BR')}`
}

/** Frase para leitores de tela e dicas: "2 a mais que em out/2025", "igual a out/2025". */
export function fraseVariacao(v: Variacao, rotuloAnterior: string) {
  if (v.direcao === 'igual') return `igual a ${rotuloAnterior}`
  return `${Math.abs(v.diferenca).toLocaleString('pt-BR')} a ${v.direcao === 'mais' ? 'mais' : 'menos'} que em ${rotuloAnterior}`
}

export interface ComparacaoResumo {
  /** O período anterior não tem nenhum evento (nem cancelado): "sem registros", que é diferente de zero. */
  semRegistros: boolean
  eventos: Variacao
  diarias: Variacao
  pico: Variacao
}

/** Compara os totais do período com os do mesmo período do ano anterior (não dia a dia). */
export function compararResumos(atual: ResumoPeriodo, anterior: ResumoPeriodo): ComparacaoResumo {
  return {
    semRegistros: anterior.registros === 0,
    eventos: variacao(atual.eventos, anterior.eventos),
    diarias: variacao(atual.diarias, anterior.diarias),
    pico: variacao(atual.pico, anterior.pico),
  }
}

/**
 * Quantos eventos (não cancelados) têm máquinas fora em cada mês (`yyyy-MM`) e em cada ano
 * (`yyyy`); um evento que passa de um mês para o outro conta nos dois.
 */
export function contagemEventos<T extends { evento: EventoAgenda }>(porDia: PorDia<T>) {
  const meses = new Map<string, Set<string>>()
  const anos = new Map<string, Set<string>>()
  const juntar = (mapa: Map<string, Set<string>>, chave: string, id: string) => {
    const s = mapa.get(chave) ?? new Set<string>()
    s.add(id)
    mapa.set(chave, s)
  }
  for (const [data, lista] of porDia) {
    for (const o of lista) {
      if (!ativa(o)) continue
      juntar(meses, data.slice(0, 7), o.item.evento.id)
      juntar(anos, data.slice(0, 4), o.item.evento.id)
    }
  }
  const tamanhos = (m: Map<string, Set<string>>) => new Map([...m].map(([k, s]) => [k, s.size]))
  return { porMes: tamanhos(meses), porAno: tamanhos(anos) }
}

// ---- Mapa de calor do ano ---------------------------------------------------------

/** 0 = nenhuma máquina fora; 1 a 4 = até 25%, 50%, 80% e 100% da frota; 5 = acima da frota. */
export type Faixa = 0 | 1 | 2 | 3 | 4 | 5

export const FAIXAS: Array<{ faixa: Faixa; rotulo: string; ate: number | null }> = [
  { faixa: 0, rotulo: 'Nenhuma', ate: 0 },
  { faixa: 1, rotulo: 'Até 25%', ate: 25 },
  { faixa: 2, rotulo: 'Até 50%', ate: 50 },
  { faixa: 3, rotulo: 'Até 80%', ate: 80 },
  { faixa: 4, rotulo: 'Até 100%', ate: 100 },
  { faixa: 5, rotulo: 'Acima da frota', ate: null },
]

/** Faixa de ocupação do dia: faixas fixas relativas à frota (contas inteiras, sem erro de arredondamento). */
export function faixaOcupacao(fora: number, frota: number): Faixa {
  if (fora <= 0) return 0
  if (fora > frota) return 5
  const pct = fora * 100
  return pct <= 25 * frota ? 1 : pct <= 50 * frota ? 2 : pct <= 80 * frota ? 3 : 4
}

/** Quantas máquinas cabem em cada faixa, para a legenda ("5 a 8"); `null` se a faixa não tem nenhum número inteiro. */
export function intervalosFaixas(frota: number): Array<{ faixa: Faixa; de: number; ate: number | null } | null> {
  const teto = (pct: number) => Math.floor((frota * pct) / 100)
  const limites = [0, teto(25), teto(50), teto(80), Math.max(0, frota)]
  return FAIXAS.map(({ faixa }) => {
    if (faixa === 0) return { faixa, de: 0, ate: 0 }
    if (faixa === 5) return { faixa, de: Math.max(0, frota) + 1, ate: null }
    const de = limites[faixa - 1] + 1
    const ate = limites[faixa]
    return de <= ate ? { faixa, de, ate } : null
  })
}

// Dia da semana sem depender do fuso: os mesmos do "Repetir em outras datas"
export { diaDaSemana }

/** "sáb 11/10". */
export const diaCurto = dataComDiaDaSemana

/** Dica do dia no mapa do ano: "sáb 11/10: 4+1 · Festa X; 2 · Baile Y". */
export function dicaDia(data: string, lista: Array<Ocorrencia<{ evento: EventoAgenda }>> = []) {
  const ativos = lista.filter(ativa)
  if (!ativos.length) return `${diaCurto(data)}: nenhuma máquina fora`
  const partes = ativos.map(
    (o) => `${quantidadeCurta(o.maquinas, o.reservas)} · ${o.item.evento.nome}${o.uso ? '' : ' (sem uso)'}`,
  )
  return `${diaCurto(data)}: ${partes.join('; ')}`
}

// ---- Mês e dia na URL ---------------------------------------------------------------

/** Os eventos aceitam datas de 2000 a 2100 (ver `dataIsoValida`): a agenda navega nesse intervalo. */
export const ANO_MIN = 2000
export const ANO_MAX = 2100

export const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** "2025-10". */
export const chaveMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`

/** Mês `yyyy-MM` da URL; inválido ou fora de 2000–2100 → `padrao`. */
export function lerMes(valor: string | null | undefined, padrao: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(valor ?? '')
  if (!m) return padrao
  const [ano, mes] = [Number(m[1]), Number(m[2])]
  return ano >= ANO_MIN && ano <= ANO_MAX && mes >= 1 && mes <= 12 ? m[0] : padrao
}

/** Dia `yyyy-MM-dd` da URL, se existir no calendário (2000–2100); senão `null`. */
export function lerDia(valor: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? '')
  if (!m) return null
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(a, me - 1, d))
  const existe = dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d
  return existe && a >= ANO_MIN && a <= ANO_MAX ? m[0] : null
}

/** Mês somado de `n` meses (pode ser negativo). */
export function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + n
  return chaveMes(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1)
}

/** `true` se o mês está no intervalo que a agenda mostra. */
export const mesNoIntervalo = (mes: string) => mes >= chaveMes(ANO_MIN, 1) && mes <= chaveMes(ANO_MAX, 12)

export const inicioDoMes = (mes: string) => `${mes}-01`
export const fimDoMes = (mes: string) => somarDias(`${somarMeses(mes, 1)}-01`, -1)

/** "Outubro de 2025". */
export function nomeMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  const nome = MESES[m - 1]
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`
}

/** "out/2025". */
export function mesCurto(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return `${MESES[m - 1].slice(0, 3)}/${a}`
}

/** Dias do mês (`yyyy-MM-dd`), do dia 1 ao último. */
export function diasDoMes(mes: string) {
  const fim = fimDoMes(mes)
  const dias: string[] = []
  for (let d = inicioDoMes(mes); d <= fim; d = somarDias(d, 1)) dias.push(d)
  return dias
}

/** Semanas inteiras (domingo a sábado) que cobrem o mês, com os dias dos meses vizinhos nas pontas. */
export function semanasDoMes(mes: string) {
  const inicio = somarDias(inicioDoMes(mes), -diaDaSemana(inicioDoMes(mes)))
  const fim = somarDias(fimDoMes(mes), 6 - diaDaSemana(fimDoMes(mes)))
  const dias: string[] = []
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d)
  return dias
}

// ---- Teclas de atalho ------------------------------------------------------------------

export type AcaoTecla = 'anterior' | 'proximo' | 'hoje'

export interface TeclaPressionada {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  /** Onde está o foco (o alvo do evento). */
  alvo?: { tagName?: string; isContentEditable?: boolean } | null
}

/**
 * ← / → (mês ou ano anterior/seguinte) e T (hoje). Não atrapalham a digitação: ficam de fora com
 * o foco num campo de texto, com Ctrl/Alt/⌘ (atalhos do navegador) e com uma janela aberta
 * (`bloqueada`).
 */
export function acaoDaTecla(t: TeclaPressionada, bloqueada = false): AcaoTecla | null {
  if (bloqueada || t.ctrlKey || t.altKey || t.metaKey || t.isComposing || t.defaultPrevented) return null
  const tag = (t.alvo?.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.alvo?.isContentEditable) return null
  if (t.key === 'ArrowLeft') return 'anterior'
  if (t.key === 'ArrowRight') return 'proximo'
  if (t.key === 't' || t.key === 'T') return 'hoje'
  return null
}
