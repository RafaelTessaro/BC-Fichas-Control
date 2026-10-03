// "Repetir em outras datas": regras puras do calendário de repetição (datas `yyyy-MM-dd`, sem
// depender do fuso do computador). A cópia em si é criada no servidor (Repositorio.repetirEvento).

import { dataCurtinha, diasEntre, diasOcupados, somarDias, totalDia, type EventoOcupacao } from '#shared/maquinas.ts'

interface DiaDaSemana {
  nome: string
  plural: string
  curto: string
  /** "segunda-feira" é feminino ("2ª segunda-feira", "numa segunda-feira"); sábado e domingo, masculinos. */
  feminino: boolean
}

export const DIAS_DA_SEMANA: DiaDaSemana[] = [
  { nome: 'domingo', plural: 'domingos', curto: 'dom', feminino: false },
  { nome: 'segunda-feira', plural: 'segundas-feiras', curto: 'seg', feminino: true },
  { nome: 'terça-feira', plural: 'terças-feiras', curto: 'ter', feminino: true },
  { nome: 'quarta-feira', plural: 'quartas-feiras', curto: 'qua', feminino: true },
  { nome: 'quinta-feira', plural: 'quintas-feiras', curto: 'qui', feminino: true },
  { nome: 'sexta-feira', plural: 'sextas-feiras', curto: 'sex', feminino: true },
  { nome: 'sábado', plural: 'sábados', curto: 'sáb', feminino: false },
]

const partes = (data: string) => data.split('-').map(Number) as [number, number, number]

/** Dia da semana (0 = domingo … 6 = sábado). */
export function diaDaSemana(data: string) {
  const [a, m, d] = partes(data)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

/** Quantos dias tem o mês (`mes` de 1 a 12). */
export function diasNoMes(ano: number, mes: number) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

const iso = (ano: number, mes: number, dia: number) =>
  `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

/** Mês seguinte (ou anterior, com `n` negativo): `{ ano, mes }` com `mes` de 1 a 12. */
export function somarMeses(ano: number, mes: number, n: number) {
  const total = ano * 12 + (mes - 1) + n
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
}

/**
 * Casas do calendário do mês, de domingo a sábado: as datas do mês, com `null` nas casas antes do
 * dia 1 e depois do último dia (sempre semanas completas).
 */
export function gradeDoMes(ano: number, mes: number): Array<string | null> {
  const antes = diaDaSemana(iso(ano, mes, 1))
  const total = diasNoMes(ano, mes)
  const casas: Array<string | null> = Array.from({ length: antes }, () => null)
  for (let dia = 1; dia <= total; dia++) casas.push(iso(ano, mes, dia))
  while (casas.length % 7) casas.push(null)
  return casas
}

// ---- "Repetir todo mês" ---------------------------------------------------------

/** A mesma ocorrência do dia da semana em cada mês: o 2º sábado (`ordem` 1 a 4) ou o último (`-1`). */
export interface RegraMensal {
  diaSemana: number
  ordem: 1 | 2 | 3 | 4 | -1
}

/**
 * Regras que descrevem a data no mês dela. O dia 10 num sábado é o "2º sábado"; o dia 28, que é o
 * 4º e também o último sábado do mês, vale as duas (o usuário escolhe); o 5º só pode ser "o último"
 * (nem todo mês tem cinco).
 */
export function regrasDaData(data: string): RegraMensal[] {
  const [ano, mes, dia] = partes(data)
  const diaSemana = diaDaSemana(data)
  const ordem = Math.ceil(dia / 7)
  const regras: RegraMensal[] = []
  if (ordem <= 4) regras.push({ diaSemana, ordem: ordem as RegraMensal['ordem'] })
  if (dia + 7 > diasNoMes(ano, mes)) regras.push({ diaSemana, ordem: -1 })
  return regras
}

/** "2º sábado", "1ª sexta-feira", "último domingo", "última quarta-feira". */
export function descreverRegra(r: RegraMensal) {
  const dia = DIAS_DA_SEMANA[r.diaSemana]
  if (r.ordem === -1) return `${dia.feminino ? 'última' : 'último'} ${dia.nome}`
  return `${r.ordem}${dia.feminino ? 'ª' : 'º'} ${dia.nome}`
}

/** Data da regra no mês (`mes` de 1 a 12). */
export function dataDaRegra(ano: number, mes: number, r: RegraMensal) {
  if (r.ordem === -1) {
    const ultimo = diasNoMes(ano, mes)
    const recua = (diaDaSemana(iso(ano, mes, ultimo)) - r.diaSemana + 7) % 7
    return iso(ano, mes, ultimo - recua)
  }
  const primeiro = (r.diaSemana - diaDaSemana(iso(ano, mes, 1)) + 7) % 7
  return iso(ano, mes, 1 + primeiro + 7 * (r.ordem - 1))
}

/**
 * As próximas `meses` datas da regra, uma por mês, depois de `depoisDe` (exclusive): a data do
 * evento — ou hoje, para um evento que já passou —, começando pelo próprio mês dela.
 */
export function repetirTodoMes(r: RegraMensal, depoisDe: string, meses: number): string[] {
  const [ano, mes] = partes(depoisDe)
  const datas: string[] = []
  for (let i = 0; datas.length < meses && i <= meses; i++) {
    const m = somarMeses(ano, mes, i)
    const data = dataDaRegra(m.ano, m.mes, r)
    if (data > depoisDe) datas.push(data)
  }
  return datas
}

// ---- As cópias ------------------------------------------------------------------

/** Os dias da cópia que começa em `inicio`: o mesmo desenho do evento, deslocado (como o servidor faz). */
export function diasDaCopia<T extends { data: string }>(dias: T[], inicio: string): T[] {
  const primeiro = dias
    .map((d) => d.data)
    .filter(Boolean)
    .sort()[0]
  if (!primeiro) return []
  const desloca = diasEntre(primeiro, inicio)
  return dias.filter((d) => d.data).map((d) => ({ ...d, data: somarDias(d.data, desloca) }))
}

/** "sáb 10/10" a partir de "2026-10-10". */
export const dataComDiaDaSemana = (data: string) => `${DIAS_DA_SEMANA[diaDaSemana(data)].curto} ${dataCurtinha(data)}`

/** "sex 10/07 a dom 12/07" (ou só "sáb 10/10" num evento de um dia). */
export function rotuloCopia(datas: string[]) {
  const ordenadas = datas.filter(Boolean).sort()
  if (!ordenadas.length) return ''
  const [inicio, fim] = [ordenadas[0], ordenadas[ordenadas.length - 1]]
  return inicio === fim ? dataComDiaDaSemana(inicio) : `${dataComDiaDaSemana(inicio)} a ${dataComDiaDaSemana(fim)}`
}

/** Soma à ocupação de cada dia (ver `ocupacaoPorDia`) as máquinas das cópias ainda não criadas. */
export function somarOcupacao(base: Map<string, number>, copias: EventoOcupacao[]): Map<string, number> {
  const mapa = new Map(base)
  for (const c of copias) for (const d of diasOcupados(c)) mapa.set(d.data, (mapa.get(d.data) ?? 0) + totalDia(d))
  return mapa
}

export interface FaltaMaquinas {
  data: string
  /** Quantas máquinas passam do que a empresa tem. */
  faltam: number
}

/**
 * Dias da cópia em que faltariam máquinas: a ocupação do dia mais as máquinas (titulares e
 * reservas) da cópia passa da capacidade. `jaContada` quando `ocupacao` já inclui esta cópia.
 */
export function faltasDaCopia(
  copia: EventoOcupacao,
  ocupacao: Map<string, number>,
  capacidade: number,
  jaContada = false,
): FaltaMaquinas[] {
  const faltas: FaltaMaquinas[] = []
  for (const d of diasOcupados(copia)) {
    const total = (ocupacao.get(d.data) ?? 0) + (jaContada ? 0 : totalDia(d))
    if (total > capacidade) faltas.push({ data: d.data, faltam: total - capacidade })
  }
  return faltas
}
