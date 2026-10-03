// Cálculos da aba Manutenção: busca de máquinas, resumo, histórico, reclamações, serviços
// cadastrados e sugestões do formulário de manutenção ("ordem de serviço" no código).
// Funções puras (sem React), testadas em manutencao.test.ts.

import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { LIMITES } from '#shared/dominio.ts'
import {
  chaveIdentificacao,
  chaveServico,
  diasOcupados,
  localDaLocacao,
  numeroDaIdentificacao,
  osEmAberto,
  periodoEvento,
  type DiaOcupado,
} from '#shared/maquinas.ts'
import type { Evento, Maquina, OrdemServico, Reclamacao, StatusMaquina, StatusOS } from '#shared/tipos.ts'
import { ehReserva } from './bloqueioMaquinas'
import { codigoEvento, dataCurta, normalizar, periodo } from './format'

/** A máquina combina com a busca pela identificação ("p1" acha "P-01", "máquina 1" acha P-01 e G-01). */
export function maquinaCombina(m: Pick<Maquina, 'tipo' | 'identificacao'>, busca: string) {
  const termo = normalizar(busca)
  if (!termo) return true
  if (normalizar(m.identificacao).includes(termo)) return true
  if (chaveIdentificacao(m.identificacao) === chaveIdentificacao(busca)) return true
  const n = numeroDaIdentificacao(busca, m.tipo)
  if (n !== null && n === numeroDaIdentificacao(m.identificacao, m.tipo)) return true
  // "máquina 01" / "maq 1": o número vale para os dois tipos (P-01 e G-01)
  const resto = /^\s*m[aá]q(?:uina)?\.?\s*(\d{1,6})\s*$/i.exec(busca)
  return !!resto && Number(resto[1]) === numeroDaIdentificacao(m.identificacao, m.tipo)
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

/** Por máquina: data da última manutenção concluída e quantas manutenções estão em aberto. */
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

/** Quantas reclamações de clientes cada máquina tem (id da máquina → quantidade). */
export function reclamacoesPorMaquina(reclamacoes: Pick<Reclamacao, 'maquinaId'>[]) {
  const mapa = new Map<string, number>()
  for (const r of reclamacoes) mapa.set(r.maquinaId, (mapa.get(r.maquinaId) ?? 0) + 1)
  return mapa
}

// ---- Máquina reserva ---------------------------------------------------------------

/**
 * O uso das reservas é anotado por dia, sem dizer qual máquina: só dá para ter certeza de que
 * uma máquina reserva foi usada quando o cliente usou todas as reservas do dia (com uma reserva
 * só, o caso comum, basta ela ter sido usada).
 */
const reservaUsadaNoDia = (d: Pick<DiaOcupado, 'reservas' | 'reservasUsadas'>, marcadas: number) =>
  d.reservasUsadas > 0 && d.reservasUsadas >= Math.max(d.reservas, marcadas)

/** Como está a máquina reserva num dia: parada com o cliente, usada, ou o cliente usou só parte das reservas. */
export type UsoReserva = 'PARADA' | 'USADA' | 'PARTE'

/** Uso da reserva do evento em `data` (dia fora do evento ou sem uso anotado: parada). */
export function usoDaReserva(evento: Pick<Evento, 'dias' | 'periodoCorrido' | 'reservasIds'>, data: string): UsoReserva {
  const dia = diasOcupados(evento).find((d) => d.data === data)
  if (!dia?.reservasUsadas) return 'PARADA'
  return reservaUsadaNoDia(dia, evento.reservasIds?.length ?? 0) ? 'USADA' : 'PARTE'
}

/** Dica de quando a máquina está com o cliente como reserva, conforme o uso de hoje. */
export const DICA_RESERVA: Record<UsoReserva, string> = {
  PARADA: 'Está com o cliente como reserva (sem uso, a não ser que ele use).',
  USADA: 'Está com o cliente como reserva e foi usada hoje: é cobrada como uma diária.',
  PARTE: 'Está com o cliente como reserva. Hoje ele usou só parte das reservas: esta pode estar parada.',
}

/** Uso da reserva hoje em poucas palavras: "parada com o cliente", "usada hoje". */
export const USO_RESERVA_CURTO: Record<UsoReserva, string> = {
  PARADA: 'parada com o cliente',
  USADA: 'usada hoje',
  PARTE: 'cliente usou parte das reservas hoje',
}

export interface ResumoMaquina {
  concluidas: number
  emAberto: number
  /** Data da última manutenção concluída. */
  ultimaManutencao: string | null
  /** Reclamações de clientes registradas para a máquina. */
  reclamacoes: number
  /** Data da reclamação mais recente. */
  ultimaReclamacao: string | null
  /** Eventos (não cancelados) para os quais a máquina foi enviada. */
  eventos: number
  /**
   * Dias de uso desses eventos até hoje em que a máquina foi como titular: cada um conta uma
   * diária (os futuros ficam de fora).
   */
  diarias: number
  /** Dias de uso até hoje em que ela ficou com o cliente como reserva (sem diária, a não ser que ele use). */
  diasReserva: number
  /** Desses dias como reserva, em quantos ela com certeza foi usada (ver `reservaUsadaNoDia`). */
  diasReservaUsada: number
  /** Desses eventos, quantos ainda vão começar. */
  agendados: number
}

export function resumoMaquina(
  maquinaId: string,
  ordens: OrdemServico[],
  eventos: Evento[],
  reclamacoes: Reclamacao[],
  hoje: string,
): ResumoMaquina {
  const r: ResumoMaquina = {
    concluidas: 0,
    emAberto: 0,
    ultimaManutencao: null,
    reclamacoes: 0,
    ultimaReclamacao: null,
    eventos: 0,
    diarias: 0,
    diasReserva: 0,
    diasReservaUsada: 0,
    agendados: 0,
  }
  for (const o of ordens) {
    if (o.maquinaId !== maquinaId) continue
    if (osEmAberto(o)) r.emAberto++
    if (o.status === 'CONCLUIDA') {
      r.concluidas++
      if (o.conclusao && o.conclusao > (r.ultimaManutencao ?? '')) r.ultimaManutencao = o.conclusao
    }
  }
  for (const e of eventos) {
    if (e.status === 'CANCELADO' || !e.maquinasIds.includes(maquinaId)) continue
    r.eventos++
    // Só os dias de uso (com período corrido, os do meio não contam diária)
    const dias = diasOcupados(e).filter((d) => d.uso && d.data <= hoje)
    if (ehReserva(e, maquinaId)) {
      r.diasReserva += dias.length
      r.diasReservaUsada += dias.filter((d) => reservaUsadaNoDia(d, e.reservasIds.length)).length
    } else r.diarias += dias.length
    const p = periodoEvento(e)
    if (p && p.inicio > hoje) r.agendados++
  }
  for (const rec of reclamacoes) {
    if (rec.maquinaId !== maquinaId) continue
    r.reclamacoes++
    if (rec.data > (r.ultimaReclamacao ?? '')) r.ultimaReclamacao = rec.data
  }
  return r
}

export interface Locacao {
  evento: Evento
  inicio: string
  fim: string
  /** A máquina vai (ou foi) como reserva neste evento. */
  reserva: boolean
}

/** Eventos (não cancelados) com a máquina que terminam hoje ou depois, do mais próximo ao mais distante. */
export function locacoesDeHojeEmDiante(maquinaId: string, eventos: Evento[], hoje: string): Locacao[] {
  const lista: Locacao[] = []
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.includes(maquinaId)) continue
    const p = periodoEvento(evento)
    if (p && p.fim >= hoje) lista.push({ evento, ...p, reserva: ehReserva(evento, maquinaId) })
  }
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.evento.codigo - b.evento.codigo)
}

export type ItemHistorico =
  | { tipo: 'os'; id: string; data: string; ordem: OrdemServico }
  | {
      tipo: 'locacao'
      id: string
      data: string
      fim: string
      evento: Evento
      quando: 'passada' | 'agora' | 'futura'
      /** Foi como reserva (ficou com o cliente, só cobrada se usada). */
      reserva: boolean
      /** Como reserva: em quantos dias de uso ela com certeza foi usada (0 quando não é reserva). */
      diasUsada: number
    }
  | { tipo: 'reclamacao'; id: string; data: string; reclamacao: Reclamacao; evento?: Evento }

/**
 * No mesmo dia, a ordem mais provável dos acontecimentos: a locação começa, o cliente reclama e
 * a manutenção é aberta. A lista vai da mais recente para a mais antiga, então a manutenção vem antes.
 */
const PESO_NO_DIA: Record<ItemHistorico['tipo'], number> = { os: 2, reclamacao: 1, locacao: 0 }

/**
 * Linha do tempo da máquina: manutenções (pela data de abertura), reclamações de clientes (pela
 * data da reclamação) e locações (pelo primeiro dia do evento; eventos cancelados ficam de fora),
 * da mais recente para a mais antiga.
 */
export function historicoMaquina(
  maquinaId: string,
  ordens: OrdemServico[],
  eventos: Evento[],
  reclamacoes: Reclamacao[],
  hoje: string,
): ItemHistorico[] {
  const itens: ItemHistorico[] = []
  for (const ordem of ordens) {
    if (ordem.maquinaId === maquinaId) itens.push({ tipo: 'os', id: ordem.id, data: ordem.abertura, ordem })
  }
  const porId = new Map(eventos.map((e) => [e.id, e]))
  for (const reclamacao of reclamacoes) {
    if (reclamacao.maquinaId !== maquinaId) continue
    const evento = reclamacao.eventoId ? porId.get(reclamacao.eventoId) : undefined
    itens.push({ tipo: 'reclamacao', id: reclamacao.id, data: reclamacao.data, reclamacao, evento })
  }
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.includes(maquinaId)) continue
    const p = periodoEvento(evento)
    if (!p) continue
    const quando = p.inicio > hoje ? 'futura' : p.fim < hoje ? 'passada' : 'agora'
    const reserva = ehReserva(evento, maquinaId)
    const diasUsada = reserva
      ? diasOcupados(evento).filter((d) => d.uso && reservaUsadaNoDia(d, evento.reservasIds.length)).length
      : 0
    itens.push({ tipo: 'locacao', id: evento.id, data: p.inicio, fim: p.fim, evento, quando, reserva, diasUsada })
  }
  const desempate = (a: ItemHistorico, b: ItemHistorico) => {
    if (a.tipo === 'os' && b.tipo === 'os') return b.ordem.numero - a.ordem.numero
    if (a.tipo === 'locacao' && b.tipo === 'locacao') return b.evento.codigo - a.evento.codigo
    if (a.tipo === 'reclamacao' && b.tipo === 'reclamacao') return b.reclamacao.criadoEm.localeCompare(a.reclamacao.criadoEm)
    return PESO_NO_DIA[b.tipo] - PESO_NO_DIA[a.tipo]
  }
  return itens.sort((a, b) => b.data.localeCompare(a.data) || desempate(a, b))
}

// ---- Reclamações de clientes -----------------------------------------------------

/**
 * Eventos em que a máquina esteve (não cancelados e já começados), do mais recente para o mais
 * antigo: as opções de "em qual evento o cliente reclamou" na ficha da máquina.
 */
export function eventosDaMaquina(maquinaId: string, eventos: Evento[], hoje: string): Locacao[] {
  const lista: Locacao[] = []
  for (const evento of eventos) {
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.includes(maquinaId)) continue
    const p = periodoEvento(evento)
    if (p && p.inicio <= hoje) lista.push({ evento, ...p, reserva: ehReserva(evento, maquinaId) })
  }
  return lista.sort((a, b) => b.fim.localeCompare(a.fim) || b.inicio.localeCompare(a.inicio) || b.evento.codigo - a.evento.codigo)
}

/** Até quantos dias depois do fim de um evento ele já vem escolhido numa reclamação nova. */
export const DIAS_SUGESTAO_EVENTO = 30

/**
 * Evento que já vem escolhido numa reclamação nova (a máquina acabou de voltar dele): o mais
 * recente de `locacoes` (ver `eventosDaMaquina`), se terminou há no máximo 30 dias.
 */
export function eventoSugerido(locacoes: Locacao[], hoje: string): Evento | undefined {
  const limite = format(addDays(parseISO(hoje), -DIAS_SUGESTAO_EVENTO), 'yyyy-MM-dd')
  const recente = locacoes[0]
  return recente && recente.fim >= limite ? recente.evento : undefined
}

/**
 * Texto do "problema relatado" de uma manutenção aberta a partir de uma reclamação: o relato do
 * cliente, com o evento e a data para saber de onde veio.
 */
export function problemaDaReclamacao(r: Pick<Reclamacao, 'descricao' | 'data'>, evento?: Pick<Evento, 'codigo' | 'nome'>) {
  const origem = evento ? `no evento ${codigoEvento(evento.codigo)} ${evento.nome}`.trim() : ''
  return `Reclamação do cliente${origem ? ` ${origem}` : ''} (${dataCurta(r.data)}): ${r.descricao.trim()}`
}

// ---- Serviços de manutenção cadastrados ---------------------------------------------

/** Nome de serviço como fica gravado: sem espaços sobrando e com a primeira letra maiúscula. */
export function formatarServico(s: string) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1)
}

/** Serviço da lista com o mesmo nome (sem diferenciar maiúsculas, acentos e espaços), ignorando a posição `ignorar`. */
export function servicoIgual(lista: string[], nome: string, ignorar = -1) {
  const chave = chaveServico(nome)
  return lista.find((s, i) => i !== ignorar && chaveServico(s) === chave)
}

export type ResultadoServico = { lista: string[]; nome: string } | { erro: string }

/** Lista com o serviço novo no fim, ou o motivo de não dar para cadastrar. */
export function adicionarServico(lista: string[], nome: string): ResultadoServico {
  const novo = formatarServico(nome)
  if (!novo) return { erro: 'Digite o nome do serviço.' }
  const igual = servicoIgual(lista, novo)
  if (igual) return { erro: `“${igual}” já está na lista.` }
  if (lista.length >= LIMITES.catalogoServicos)
    return { erro: `Dá para cadastrar no máximo ${LIMITES.catalogoServicos} serviços.` }
  return { lista: [...lista, novo], nome: novo }
}

/** Lista com o serviço da posição `indice` renomeado, ou o motivo de não dar para renomear. */
export function renomearServico(lista: string[], indice: number, nome: string): ResultadoServico {
  const novo = formatarServico(nome)
  if (!novo) return { erro: 'O nome não pode ficar vazio.' }
  const igual = servicoIgual(lista, novo, indice)
  if (igual) return { erro: `“${igual}” já está na lista.` }
  return { lista: lista.map((s, i) => (i === indice ? novo : s)), nome: novo }
}

/**
 * Serviços para marcar numa manutenção: os cadastrados e, depois deles, os que o registro já tem
 * e não estão mais na lista (serviço removido ou renomeado depois), sem repetir.
 */
export function opcoesServico(cadastrados: string[], doRegistro: string[]): string[] {
  const lista: string[] = []
  const vistos = new Set<string>()
  for (const s of [...cadastrados, ...doRegistro]) {
    const chave = chaveServico(s)
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(s.trim())
  }
  return lista
}

/** Em quantas manutenções cada serviço aparece (pela chave de `chaveServico`). */
export function usoDosServicos(ordens: Pick<OrdemServico, 'servicos'>[]) {
  const mapa = new Map<string, number>()
  for (const o of ordens) for (const s of new Set(o.servicos.map(chaveServico))) mapa.set(s, (mapa.get(s) ?? 0) + 1)
  return mapa
}

// ---- Sugestões ao salvar a manutenção --------------------------------------------

/** Mudança sugerida na situação da máquina ao salvar uma manutenção. */
export type SugestaoMaquina = 'MANUTENCAO' | 'LIBERAR' | null

/**
 * Manutenção iniciada ou em andamento com a máquina disponível: colocar em manutenção.
 * Manutenção concluída ou cancelada com a máquina em manutenção: liberar. Desativada: nada.
 */
export function sugestaoMaquina(statusOS: StatusOS, statusMaquina: StatusMaquina): SugestaoMaquina {
  if (statusMaquina === 'DESATIVADA') return null
  if (osEmAberto({ status: statusOS })) return statusMaquina === 'DISPONIVEL' ? 'MANUTENCAO' : null
  return statusMaquina === 'MANUTENCAO' ? 'LIBERAR' : null
}

/**
 * Se a caixa da sugestão já vem marcada: só quando a manutenção é nova ou a situação dela mudou
 * (editar o texto de uma manutenção não mexe na máquina). Para pôr em manutenção, não se a
 * máquina estiver locada agora (ela ainda está no evento); para liberar, só sem outra manutenção
 * em aberto.
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
    .map((l) => `${localDaLocacao(l.evento)} (${periodo(l.inicio, l.fim)}${l.reserva ? ', como reserva' : ''})`)
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
