// Contratos de locação na tela: situação, busca, o contrato que vale para cada evento, o que mudou
// no aluguel depois de gerado e o arquivo da cópia assinada. Sem React, para poder ser testado.

import type { Tone } from '#shared/calc.ts'
import { codigoContrato, dataBR, montarDadosContrato, mudancasDesde } from '#shared/contrato.ts'
import { necessidadeMaquinas, quantidadeCurta, quantidadePorExtenso } from '#shared/maquinas.ts'
import type {
  Cliente,
  Configuracoes,
  Contrato,
  DadosContrato,
  DataHora,
  Evento,
  Maquina,
  NovoContrato,
  StatusContrato,
} from '#shared/tipos.ts'
import { normalizar } from './format'

export const STATUS_CONTRATO: Record<StatusContrato, { label: string; tone: Tone; descricao: string }> = {
  AGUARDANDO: { label: 'Esperando assinatura', tone: 'warning', descricao: 'Gerado e ainda não assinado pelo cliente.' },
  ASSINADO: { label: 'Assinado', tone: 'success', descricao: 'Assinado pelo cliente.' },
  CANCELADO: { label: 'Cancelado', tone: 'neutral', descricao: 'Não vale mais (cancelado ou substituído por outro).' },
}

/** Filtro da aba Contratos. */
export type FiltroContratos = StatusContrato | 'TODOS'

/** Abre nos que esperam a assinatura (o que precisa de atenção); sem nenhum, em todos. */
export const filtroInicial = (contratos: Pick<Contrato, 'status'>[]): FiltroContratos =>
  contratos.some((c) => c.status === 'AGUARDANDO') ? 'AGUARDANDO' : 'TODOS'

/** Contratos do evento, do mais novo (maior número) para o mais antigo. */
export const contratosDoEvento = <T extends Pick<Contrato, 'eventoId' | 'numero'>>(contratos: T[], eventoId: string) =>
  contratos.filter((c) => c.eventoId === eventoId).sort((a, b) => b.numero - a.numero)

/** O contrato que vale para o evento: o mais recente que não foi cancelado. */
export const contratoVigente = <T extends Pick<Contrato, 'eventoId' | 'numero' | 'status'>>(contratos: T[], eventoId: string) =>
  contratosDoEvento(contratos, eventoId).find((c) => c.status !== 'CANCELADO')

/** O contrato do evento que espera a assinatura (um contrato novo o substitui). */
export const contratoAguardando = <T extends Pick<Contrato, 'eventoId' | 'numero' | 'status'>>(
  contratos: T[],
  eventoId: string,
) => contratosDoEvento(contratos, eventoId).find((c) => c.status === 'AGUARDANDO')

/**
 * Busca por número ("7", "0007", "nº 7", "#7"), cliente (o nome que saiu no contrato ou o do
 * cadastro, em `extra`) e evento. Só algarismos procuram o número exato (ou um nome com eles).
 */
export function contratoCombina(c: Pick<Contrato, 'numero' | 'dados'>, busca: string, extra = ''): boolean {
  const termo = normalizar(busca)
  if (!termo) return true
  const nomes = normalizar(
    `${c.dados.cliente.nome} ${c.dados.cliente.fantasia} ${c.dados.assinante.nome} ${c.dados.evento.nome} ${extra}`,
  )
  const numero = /^(?:contrato\s*)?(?:n[º°o.]*\s*|#\s*)?0*(\d+)$/.exec(termo)
  if (numero) return c.numero === Number(numero[1]) || nomes.includes(termo)
  return normalizar(`contrato ${codigoContrato(c.numero)} ${nomes}`).includes(termo)
}

/** Máquinas do dia de maior uso: "3+1" e "3 máquinas + 1 reserva". */
export function maquinasDoContrato(d: Pick<DadosContrato, 'evento'>) {
  const n = necessidadeMaquinas(d.evento.dias)
  return { curto: quantidadeCurta(n.titulares, n.reservas), extenso: quantidadePorExtenso(n.titulares, n.reservas) }
}

/** "10/10/2026 às 9h" / "10/10/2026 às 14h30" / "10/10/2026" (hora a preencher) / "" (sem data). */
export function dataHoraCurta(d: DataHora): string {
  if (!d.data) return ''
  const m = /^(\d{2}):(\d{2})$/.exec(d.hora)
  if (!m) return dataBR(d.data)
  return `${dataBR(d.data)} às ${Number(m[1])}h${m[2] === '00' ? '' : m[2]}`
}

/** O que foi informado na tela quando o contrato foi gerado (para refazer com os dados de agora). */
export function entradaDoContrato(d: DadosContrato): Omit<NovoContrato, 'eventoId'> {
  return { local: d.evento.local, retirada: d.retirada, devolucao: d.devolucao, assinante: d.assinante, condicoes: '' }
}

export interface FontesAtuais {
  evento: Evento | undefined
  cliente: Cliente | undefined
  maquinas: Maquina[]
  config: Configuracoes
}

/**
 * O que mudou no aluguel (ou no cadastro do cliente) depois que o contrato foi gerado, para a tela
 * pedir um contrato novo. Não contam: o pagamento registrado depois (o combinado não muda) e a
 * escolha das máquinas quando o contrato saiu sem elas (os números vão no Termo de Entrega).
 * Contrato cancelado ou evento excluído: nada a comparar.
 */
export function mudancasDoContrato(contrato: Pick<Contrato, 'status' | 'dados'>, f: FontesAtuais): string[] {
  if (contrato.status === 'CANCELADO' || !f.evento) return []
  const gerado = contrato.dados
  const atual = montarDadosContrato({
    evento: f.evento,
    cliente: f.cliente,
    maquinas: f.maquinas,
    config: f.config,
    entrada: entradaDoContrato(gerado),
    hoje: gerado.emitidoEm,
  })
  atual.valores.formaPagamento = gerado.valores.formaPagamento
  if (!gerado.evento.maquinas.length) atual.evento.maquinas = []
  return mudancasDesde(gerado, atual)
}

/**
 * Nome do cliente para a tela: o do cadastro (como todo o sistema mostra) ou, sem ele, o que saiu
 * no contrato (nome fantasia ou razão social).
 */
export function nomeClienteContrato(c: Pick<Contrato, 'clienteId' | 'dados'>, clientes: Pick<Cliente, 'id' | 'nome'>[]) {
  return (
    clientes.find((x) => x.id === c.clienteId)?.nome.trim() ||
    c.dados.cliente.fantasia ||
    c.dados.cliente.nome ||
    'Cliente sem nome'
  )
}

/** "a", "a e b", "a, b e c". */
export const juntarLista = (itens: string[]) =>
  itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`

// ---- Cópia assinada ----------------------------------------------------------------------

/** Tipos aceitos pelo servidor para a cópia assinada. */
const TIPOS_ACEITOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * Tipo do arquivo da cópia assinada (PDF ou foto), ou `null` se não for aceito. Alguns
 * navegadores não informam o tipo das fotos do iPhone (HEIC): vale a extensão do nome.
 */
export function tipoAssinado(nome: string, tipo: string): string | null {
  const t = tipo.toLowerCase().replace('image/jpg', 'image/jpeg')
  if (TIPOS_ACEITOS.has(t)) return t
  if (t && t !== 'application/octet-stream') return null
  const ext = /\.([a-z0-9]{1,5})$/i.exec(nome)?.[1]?.toLowerCase() ?? ''
  return POR_EXTENSAO[ext] ?? null
}

/** Foto que o navegador consegue desenhar (para juntar várias páginas num PDF só). */
export const fotoComum = (tipo: string) => tipo === 'image/jpeg' || tipo === 'image/png' || tipo === 'image/webp'

/** "Contrato 0007 assinado.pdf". */
export const nomeAssinado = (numero: number, extensao: string) =>
  `Contrato ${String(numero).padStart(4, '0')} assinado.${extensao.replace(/^\./, '')}`

/** Uma página fotografada dentro da folha A4 (mm), com margem, sem distorcer. */
export function encaixarNaPagina(largura: number, altura: number, pagina = { l: 210, a: 297 }, margem = 8) {
  const maxL = pagina.l - margem * 2
  const maxA = pagina.a - margem * 2
  const escala = Math.min(maxL / largura, maxA / altura)
  const l = largura * escala
  const a = altura * escala
  return { x: (pagina.l - l) / 2, y: (pagina.a - a) / 2, l, a }
}
