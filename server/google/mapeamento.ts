import { createHash } from 'node:crypto'
import { calcularEvento, FORMAS_PAGAMENTO, STATUS_EVENTO } from '#shared/calc.ts'
import type { Cliente, Evento, StatusEvento } from '#shared/tipos.ts'

/**
 * Conversão de um evento do sistema em eventos de dia inteiro do Google Agenda.
 * Cada bloco de datas consecutivas vira um evento no Google (dias soltos viram
 * eventos separados), com id determinístico para o envio ser idempotente.
 */

export const AVISO_FINAL = 'Gerado automaticamente pelo BC Fichas Control. Alterações feitas aqui serão substituídas.'

/** Cores do Google Agenda (colorId) por status: azul, amarelo, verde e grafite. */
export const COR_POR_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: '9', // Mirtilo
  PENDENTE: '5', // Banana
  FINALIZADO: '10', // Manjericão
  CANCELADO: '8', // Grafite
}

export interface BlocoDatas {
  /** Primeiro dia (yyyy-MM-dd). */
  inicio: string
  /** Último dia (inclusivo). */
  fim: string
  dias: Array<{ data: string; maquinas: number }>
}

export interface EventoGoogle {
  id: string
  summary: string
  location: string
  description: string
  start: { date: string }
  end: { date: string }
  colorId: string
  status: 'confirmed'
  transparency: 'opaque'
  extendedProperties: {
    private: {
      bcFichasId: string
      codigo: string
      /** Impressão digital do conteúdo deste evento (ver `hashEventoGoogle`). */
      bcHash: string
    }
  }
}

const DIA_MS = 86_400_000
const dataValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
const paraUTC = (s: string) => Date.parse(`${s}T00:00:00Z`)
const deUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Dia seguinte em UTC (o `end.date` do Google é exclusivo). */
export const diaSeguinte = (data: string) => deUTC(paraUTC(data) + DIA_MS)

/** Agrupa os dias do evento em blocos de datas consecutivas, somando datas repetidas. */
export function blocosDeDatas(dias: Evento['dias']): BlocoDatas[] {
  const porData = new Map<string, number>()
  for (const d of dias) {
    if (!d || !dataValida(d.data)) continue
    porData.set(d.data, (porData.get(d.data) ?? 0) + (Number(d.maquinas) || 0))
  }
  const ordenadas = [...porData.keys()].sort()
  const blocos: BlocoDatas[] = []
  for (const data of ordenadas) {
    const atual = blocos[blocos.length - 1]
    const dia = { data, maquinas: porData.get(data) ?? 0 }
    if (atual && paraUTC(data) - paraUTC(atual.fim) === DIA_MS) {
      atual.fim = data
      atual.dias.push(dia)
    } else {
      blocos.push({ inicio: data, fim: data, dias: [dia] })
    }
  }
  return blocos
}

/**
 * Id válido no Google (somente [a-v0-9], 5 a 1024 caracteres), derivado do id do
 * evento e do índice do bloco. UUIDs viram hexadecimal sem hífens; outros ids
 * (ex.: de backups antigos) são convertidos em hexadecimal.
 */
export function idGoogle(eventoId: string, indice: number): string {
  const id = eventoId.toLowerCase()
  let corpo: string
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) corpo = `u${id.replace(/-/g, '')}`
  else {
    const hex = Buffer.from(eventoId, 'utf8').toString('hex')
    corpo = hex.length <= 900 ? `h${hex}` : `s${createHash('sha256').update(eventoId).digest('hex')}`
  }
  return `bcf${corpo}b${indice}`
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const inteiro = new Intl.NumberFormat('pt-BR')
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const plural = (n: number, um: string, varios: string) => `${inteiro.format(n)} ${n === 1 ? um : varios}`
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const codigo = (n: number) => `#${String(n).padStart(4, '0')}`

function textoMaquinas(dias: BlocoDatas['dias']) {
  const qtds = dias.map((d) => d.maquinas)
  const min = Math.min(...qtds)
  const max = Math.max(...qtds)
  return min === max ? plural(min, 'máquina', 'máquinas') : `${inteiro.format(min)}–${inteiro.format(max)} máquinas`
}

export interface OpcoesMapeamento {
  incluirValores: boolean
}

/** Descrição em texto do evento (igual em todos os blocos). */
export function descricaoEvento(evento: Evento, cliente: Cliente | undefined, opcoes: OpcoesMapeamento): string {
  const linhas: string[] = [`Evento ${codigo(evento.codigo)}`]
  linhas.push(`Cliente: ${cliente?.nome || 'Cliente removido'}`)
  if (cliente?.telefone) linhas.push(`Telefone: ${cliente.telefone}`)
  const local = [evento.local, evento.cidade].filter(Boolean).join(' — ')
  if (local) linhas.push(`Local: ${local}`)

  const todos = blocosDeDatas(evento.dias).flatMap((b) => b.dias)
  if (todos.length) {
    linhas.push('', 'Dias:')
    for (const d of todos) {
      linhas.push(
        `• ${dataBR(d.data)} (${SEMANA[new Date(paraUTC(d.data)).getUTCDay()]}): ${plural(d.maquinas, 'máquina', 'máquinas')}`,
      )
    }
  }

  linhas.push('', `Bobinas consignadas: ${inteiro.format(evento.bobinasConsignadas || 0)}`)
  linhas.push(`Status: ${STATUS_EVENTO[evento.status]?.label ?? evento.status}`)
  linhas.push(`Pagamento: ${FORMAS_PAGAMENTO[evento.formaPagamento]?.label ?? evento.formaPagamento}`)
  if (opcoes.incluirValores) linhas.push(`Total: ${brl.format(calcularEvento(evento).total)}`)

  linhas.push('', AVISO_FINAL)
  return linhas.join('\n')
}

/** Eventos do Google que representam o evento do sistema (vazio se cancelado ou sem datas). */
export function montarEventosGoogle(evento: Evento, cliente: Cliente | undefined, opcoes: OpcoesMapeamento): EventoGoogle[] {
  if (evento.status === 'CANCELADO') return []
  const description = descricaoEvento(evento, cliente, opcoes)
  const location = [evento.local, evento.cidade].filter(Boolean).join(', ')
  const nomeCliente = cliente?.nome || 'Cliente removido'
  return blocosDeDatas(evento.dias).map((bloco, i) => {
    const g: EventoGoogle = {
      id: idGoogle(evento.id, i),
      summary: `${evento.nome || 'Evento'} — ${nomeCliente} (${textoMaquinas(bloco.dias)})`,
      location,
      description,
      start: { date: bloco.inicio },
      end: { date: diaSeguinte(bloco.fim) },
      colorId: COR_POR_STATUS[evento.status] ?? '9',
      status: 'confirmed',
      transparency: 'opaque',
      extendedProperties: { private: { bcFichasId: evento.id, codigo: codigo(evento.codigo), bcHash: '' } },
    }
    g.extendedProperties.private.bcHash = hashEventoGoogle(g)
    return g
  })
}

/**
 * Impressão digital do conteúdo de UM evento do Google (sem o próprio `bcHash`). Vai junto
 * no envio (`extendedProperties.private.bcHash`) e volta na listagem da agenda: assim a
 * conferência descobre cópias com conteúdo diferente do banco — por exemplo, eventos
 * editados depois de uma cópia antiga do .db que foi restaurada.
 */
export function hashEventoGoogle(g: EventoGoogle): string {
  const semHash = { ...g, extendedProperties: { private: { ...g.extendedProperties.private, bcHash: '' } } }
  return createHash('sha256').update(JSON.stringify(semHash)).digest('hex').slice(0, 32)
}

/** Impressão digital do conteúdo enviado (evita reenviar o que não mudou). */
export function hashConteudo(calendarId: string, eventos: EventoGoogle[]): string {
  return createHash('sha256')
    .update(JSON.stringify([calendarId, eventos]))
    .digest('hex')
}
