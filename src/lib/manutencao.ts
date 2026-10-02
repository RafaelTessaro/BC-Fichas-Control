// Cálculos da aba Manutenção: busca de máquinas, resumo, histórico e sugestões da O.S.
// Funções puras (sem React), testadas em manutencao.test.ts.

import { differenceInCalendarDays, parseISO } from 'date-fns'
import { chaveIdentificacao, localDaLocacao, numeroDaIdentificacao, osEmAberto, periodoEvento } from '#shared/maquinas.ts'
import type { Evento, Maquina, OrdemServico, StatusMaquina, StatusOS } from '#shared/tipos.ts'
import { normalizar, periodo } from './format'

/** A máquina combina com a busca pela identificação ("p1" acha "P-01"), modelo ou nº de série. */
export function maquinaCombina(m: Pick<Maquina, 'tipo' | 'identificacao' | 'modelo' | 'numeroSerie'>, busca: string) {
  const termo = normalizar(busca)
  if (!termo) return true
  if (normalizar(`${m.identificacao} ${m.modelo} ${m.numeroSerie}`).includes(termo)) return true
  if (chaveIdentificacao(m.identificacao) === chaveIdentificacao(busca)) return true
  const n = numeroDaIdentificacao(busca, m.tipo)
  if (n !== null && n === numeroDaIdentificacao(m.identificacao, m.tipo)) return true
  // "máquina 01" / "maq 1": o número vale para os dois tipos (P-01 e G-01)
  const resto = /^\s*m[aá]q(?:uina)?\.?\s*(\d{1,6})\s*$/i.exec(busca)
  return !!resto && Number(resto[1]) === numeroDaIdentificacao(m.identificacao, m.tipo)
}

/** Nome do evento, quando diz algo além do local (a 1ª linha do cabeçalho costuma ser o próprio nome). */
export function nomeAlemDoLocal(evento: Pick<Evento, 'nome' | 'cabecalho'>) {
  return normalizar(evento.nome) === normalizar(localDaLocacao(evento)) ? undefined : evento.nome
}

/** Dias corridos de `de` até `ate` (datas `yyyy-MM-dd`). */
export const diasEntre = (de: string, ate: string) => differenceInCalendarDays(parseISO(ate), parseISO(de))

/** "hoje", "ontem", "há 5 dias" (data no passado em relação a `hoje`). */
export function haQuantoTempo(data: string, hoje: string) {
  const d = diasEntre(data, hoje)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

/** Em aberto primeiro (a mais antiga antes); depois as outras, da mais recente para a mais antiga. */
export function ordenarOrdens<T extends Pick<OrdemServico, 'status' | 'abertura' | 'conclusao' | 'numero'>>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const abertaA = osEmAberto(a)
    const abertaB = osEmAberto(b)
    if (abertaA !== abertaB) return abertaA ? -1 : 1
    if (abertaA) return a.abertura.localeCompare(b.abertura) || a.numero - b.numero
    return (b.conclusao || b.abertura).localeCompare(a.conclusao || a.abertura) || b.numero - a.numero
  })
}

/** Por máquina: data da última manutenção concluída e quantas O.S. estão em aberto. */
export function indicesOrdens(ordens: OrdemServico[]) {
  const ultima = new Map<string, string>()
  const abertas = new Map<string, number>()
  for (const o of ordens) {
    if (osEmAberto(o)) abertas.set(o.maquinaId, (abertas.get(o.maquinaId) ?? 0) + 1)
    else if (o.status === 'CONCLUIDA' && o.conclusao && o.conclusao > (ultima.get(o.maquinaId) ?? '')) {
      ultima.set(o.maquinaId, o.conclusao)
    }
  }
  return { ultima, abertas }
}

export interface ResumoMaquina {
  concluidas: number
  emAberto: number
  /** Soma do custo das O.S. que não foram canceladas. */
  gasto: number
  /** Data da última O.S. concluída. */
  ultimaManutencao: string | null
  /** Eventos (não cancelados) para os quais a máquina foi enviada. */
  eventos: number
  /** Dias desses eventos até hoje: cada dia com a máquina conta uma diária (os futuros ficam de fora). */
  diarias: number
  /** Desses eventos, quantos ainda vão começar. */
  agendados: number
}

export function resumoMaquina(maquinaId: string, ordens: OrdemServico[], eventos: Evento[], hoje: string): ResumoMaquina {
  const r: ResumoMaquina = { concluidas: 0, emAberto: 0, gasto: 0, ultimaManutencao: null, eventos: 0, diarias: 0, agendados: 0 }
  for (const o of ordens) {
    if (o.maquinaId !== maquinaId) continue
    if (osEmAberto(o)) r.emAberto++
    if (o.status !== 'CANCELADA') r.gasto += o.custo
    if (o.status === 'CONCLUIDA') {
      r.concluidas++
      if (o.conclusao && o.conclusao > (r.ultimaManutencao ?? '')) r.ultimaManutencao = o.conclusao
    }
  }
  for (const e of eventos) {
    if (e.status === 'CANCELADO' || !e.maquinasIds.includes(maquinaId)) continue
    r.eventos++
    r.diarias += new Set(e.dias.map((d) => d.data).filter((d) => d && d <= hoje)).size
    const p = periodoEvento(e)
    if (p && p.inicio > hoje) r.agendados++
  }
  r.gasto = Math.round(r.gasto * 100) / 100
  return r
}

export interface Locacao {
  evento: Evento
  inicio: string
  fim: string
}

/** Eventos (não cancelados) com a máquina que terminam hoje ou depois, do mais próximo ao mais distante. */
export function locacoesDeHojeEmDiante(maquinaId: string, eventos: Evento[], hoje: string): Locacao[] {
  const lista: Locacao[] = []
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.includes(maquinaId)) continue
    const p = periodoEvento(evento)
    if (p && p.fim >= hoje) lista.push({ evento, ...p })
  }
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.evento.codigo - b.evento.codigo)
}

export type ItemHistorico =
  | { tipo: 'os'; id: string; data: string; ordem: OrdemServico }
  | { tipo: 'locacao'; id: string; data: string; fim: string; evento: Evento; quando: 'passada' | 'agora' | 'futura' }

/**
 * Linha do tempo da máquina: O.S. (pela data de abertura) e locações (pelo primeiro dia do evento;
 * eventos cancelados ficam de fora), da mais recente para a mais antiga.
 */
export function historicoMaquina(maquinaId: string, ordens: OrdemServico[], eventos: Evento[], hoje: string): ItemHistorico[] {
  const itens: ItemHistorico[] = []
  for (const ordem of ordens) {
    if (ordem.maquinaId === maquinaId) itens.push({ tipo: 'os', id: ordem.id, data: ordem.abertura, ordem })
  }
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.includes(maquinaId)) continue
    const p = periodoEvento(evento)
    if (!p) continue
    const quando = p.inicio > hoje ? 'futura' : p.fim < hoje ? 'passada' : 'agora'
    itens.push({ tipo: 'locacao', id: evento.id, data: p.inicio, fim: p.fim, evento, quando })
  }
  const desempate = (x: ItemHistorico) => (x.tipo === 'os' ? x.ordem.numero : x.evento.codigo)
  return itens.sort((a, b) => b.data.localeCompare(a.data) || desempate(b) - desempate(a))
}

/** Mudança sugerida na situação da máquina ao salvar uma O.S. */
export type SugestaoMaquina = 'MANUTENCAO' | 'LIBERAR' | null

/**
 * O.S. aberta ou em andamento com a máquina disponível: colocar em manutenção.
 * O.S. concluída ou cancelada com a máquina em manutenção: liberar. Desativada: nada.
 */
export function sugestaoMaquina(statusOS: StatusOS, statusMaquina: StatusMaquina): SugestaoMaquina {
  if (statusMaquina === 'DESATIVADA') return null
  if (osEmAberto({ status: statusOS })) return statusMaquina === 'DISPONIVEL' ? 'MANUTENCAO' : null
  return statusMaquina === 'MANUTENCAO' ? 'LIBERAR' : null
}

/**
 * Se a caixa da sugestão já vem marcada: só quando a O.S. é nova ou a situação dela mudou
 * (editar o texto de uma O.S. não mexe na máquina). Para pôr em manutenção, não se a máquina
 * estiver locada agora (ela ainda está no evento); para liberar, só sem outra O.S. em aberto.
 */
export function sugestaoMarcada(
  sugestao: SugestaoMaquina,
  contexto: { nova: boolean; situacaoMudou: boolean; outrasEmAberto: number; locadaAgora?: boolean },
) {
  if (!sugestao || (!contexto.nova && !contexto.situacaoMudou)) return false
  return sugestao === 'MANUTENCAO' ? !contexto.locadaAgora : contexto.outrasEmAberto === 0
}

export interface PerguntaSituacao {
  titulo: string
  descricao: string
  confirmar: string
  perigo?: boolean
}

/** "Atenção: ela está em 2 eventos de hoje em diante — … Troque a máquina nesses eventos." (vazio sem eventos) */
export function avisoLocacoes(locacoes: Locacao[]) {
  const n = locacoes.length
  if (!n) return ''
  const lista = locacoes
    .slice(0, 3)
    .map((l) => `${localDaLocacao(l.evento)} (${periodo(l.inicio, l.fim)})`)
    .join('; ')
  return `Atenção: ela está em ${n === 1 ? '1 evento' : `${n} eventos`} de hoje em diante — ${lista}${n > 3 ? ' e outros' : ''}. Troque a máquina ${n === 1 ? 'nesse evento' : 'nesses eventos'}.`
}

/**
 * Confirmação ao trocar a situação da máquina (`null` quando não precisa perguntar):
 * desativar sempre pergunta; manutenção só quando a máquina está em eventos de hoje em diante.
 */
export function perguntaSituacao(
  maquina: Pick<Maquina, 'identificacao' | 'status'>,
  nova: StatusMaquina,
  locacoes: Locacao[],
): PerguntaSituacao | null {
  if (nova === maquina.status) return null
  const aviso = avisoLocacoes(locacoes)
  if (nova === 'DESATIVADA') {
    return {
      titulo: `Desativar a máquina ${maquina.identificacao}?`,
      descricao: [
        'Ela deixa de contar entre as suas máquinas e não aparece mais para novos eventos. O histórico fica guardado e dá para reativá-la depois.',
        aviso,
      ]
        .filter(Boolean)
        .join(' '),
      confirmar: 'Desativar máquina',
      perigo: true,
    }
  }
  if (nova === 'MANUTENCAO' && aviso) {
    return {
      titulo: `Colocar a máquina ${maquina.identificacao} em manutenção?`,
      descricao: `${aviso.replace(/ Troque a máquina.*$/, '')} Se o conserto não ficar pronto a tempo, troque a máquina ${locacoes.length === 1 ? 'nesse evento' : 'nesses eventos'}.`,
      confirmar: 'Colocar em manutenção',
    }
  }
  return null
}
