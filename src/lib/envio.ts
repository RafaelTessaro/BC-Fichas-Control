// Envio do recibo ou do resumo do evento para o cliente, por e-mail ou WhatsApp: os textos
// prontos, o telefone no formato do WhatsApp e o PDF em base64 para o e-mail. Sem React nem
// jsPDF, para poder ser testado; a janela de envio fica em EnviarDocumentoModal.tsx.

import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { emailValido } from '#shared/dominio.ts'
import { datasOcupadas } from '#shared/maquinas.ts'
import type { Cliente, Configuracoes, Evento } from '#shared/tipos.ts'
import { codigoEvento, dataCurta, moeda } from './format'
import { periodoRecibo } from './recibo'

/** O que vai junto da mensagem: o recibo em PDF, o resumo do evento em PDF ou nada. */
export type DocumentoEnvio = 'recibo' | 'resumo' | 'nenhum'

// ---- Telefone e link do WhatsApp ----------------------------------------------------

/**
 * Telefone para o link do WhatsApp: só os dígitos, com o 55 do Brasil na frente. Aceita o número
 * com DDD (10 ou 11 dígitos) ou já com o 55 (12 ou 13 dígitos); o zero de discagem na frente
 * ("019…", "0055…") é ignorado. Devolve `null` quando não dá para saber o número completo
 * (ex.: sem DDD), e aí o WhatsApp abre para escolher o contato.
 */
export function telefoneWhatsApp(telefone: string): string | null {
  let d = telefone.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  if (d.length === 10 || d.length === 11) return `55${d}`
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  return null
}

/** "+55 (19) 98100-1000", para mostrar o número que vai ser aberto. */
export function telefoneLegivel(numero: string) {
  const ddd = numero.slice(2, 4)
  const resto = numero.slice(4)
  const corte = resto.length === 9 ? 5 : 4
  return `+55 (${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** Link que abre a conversa no WhatsApp com a mensagem escrita; sem número, o WhatsApp pede o contato. */
export function linkWhatsApp(numero: string | null, texto: string) {
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`
}

// ---- E-mail ---------------------------------------------------------------------------

/** Separa "a@x.com, b@y.com; c" em e-mails válidos e inválidos (sem repetir). */
export function listaEmails(texto: string): { validos: string[]; invalidos: string[] } {
  const todos = [
    ...new Set(
      texto
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ]
  return { validos: todos.filter(emailValido), invalidos: todos.filter((x) => !emailValido(x)) }
}

/** Conteúdo binário (o PDF) em base64, como o servidor de e-mail recebe os anexos. */
export function paraBase64(dados: ArrayBuffer | Uint8Array): string {
  const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados)
  let binario = ''
  // Em blocos: String.fromCharCode com argumentos demais estoura a pilha em arquivos grandes
  const BLOCO = 0x8000
  for (let i = 0; i < bytes.length; i += BLOCO) binario += String.fromCharCode(...bytes.subarray(i, i + BLOCO))
  return btoa(binario)
}

// ---- Textos prontos ---------------------------------------------------------------------

export interface DadosMensagem {
  evento: Evento
  cliente: Cliente | undefined
  config: Pick<Configuracoes, 'empresaNome' | 'empresaRazaoSocial'>
  documento: DocumentoEnvio
}

/** "JULIANA" e "juliana" → "Juliana"; nomes já escritos com maiúsculas e minúsculas ficam como estão. */
const capitalizar = (p: string) =>
  p === p.toUpperCase() || p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p

/**
 * Primeiro nome de quem vai ler: o responsável cadastrado ou, numa pessoa física, o próprio
 * cliente. Empresa sem responsável e avulso (o nome é um apelido) ficam sem nome.
 */
export function primeiroNome(cliente: Cliente | undefined): string {
  if (!cliente) return ''
  const nome = cliente.responsavel.trim() || (cliente.tipo === 'PF' ? cliente.nome.trim() : '')
  const [primeiro = '', segundo = ''] = nome.split(/\s+/)
  if (!/\p{L}/u.test(primeiro)) return ''
  // "Pe. Antônio", "Dona Maria": o tratamento sozinho ("Olá, Pe.!") não chama ninguém
  if (TRATAMENTOS.has(primeiro.toLowerCase().replace(/\.$/, '')) && /\p{L}/u.test(segundo))
    return `${capitalizar(primeiro)} ${capitalizar(segundo)}`
  return capitalizar(primeiro)
}

/** Tratamentos que vêm antes do nome (com ou sem ponto). */
const TRATAMENTOS = new Set(
  'pe padre dr dra sr sra srta prof profa pr pra pastor pastora frei ir irmã irmão dom dona seu me mestre'.split(' '),
)

/**
 * Datas do evento numa linha, sem a preposição do recibo: "11/10/2026", "11 a 13/10/2026",
 * "11, 12 e 18/10/2026"; com muitos dias soltos, "6 dias, de 01/10 a 25/11/2026".
 */
export function datasDoEvento(datas: string[]): string {
  const texto = periodoRecibo(datas)
  const muitos = /^entre (.+) e (.+) \((\d+) dias\)$/.exec(texto)
  if (muitos) return `${muitos[3]} dias, de ${muitos[1]} a ${muitos[2]}`
  return texto.replace(/^(em|de|nos dias) /, '')
}

/** Nome da empresa para assinar a mensagem (nome fantasia ou, sem ele, a razão social). */
const empresa = (c: DadosMensagem['config']) => c.empresaNome.trim() || c.empresaRazaoSocial.trim()

/** Linhas do resumo (evento, datas, total, pagamento), com o rótulo separado do valor. */
export function linhasResumo({ evento }: Pick<DadosMensagem, 'evento'>): Array<[rotulo: string, valor: string]> {
  const r = calcularEvento(evento)
  const datas = [...new Set(evento.dias.map((d) => d.data).filter(Boolean))]
  const linhas: Array<[string, string]> = [['Evento', `${evento.nome.trim()} (${codigoEvento(evento.codigo)})`]]
  if (datas.length) linhas.push([datas.length === 1 ? 'Data' : 'Datas', datasDoEvento(datas)])
  // Período corrido: as máquinas ficam com o cliente também entre os dias de uso
  const ocupadas = evento.periodoCorrido ? datasOcupadas(evento) : []
  if (ocupadas.length > datas.length) {
    linhas.push(['Máquinas com vocês', `de ${dataCurta(ocupadas[0])} a ${dataCurta(ocupadas[ocupadas.length - 1])}`])
  }
  // Bobinas ainda não conferidas: o total ainda vai mudar
  const aConferir = evento.bobinasConsignadas > 0 && r.conferencia !== 'CONFERIDO'
  linhas.push(['Valor total', `${moeda(r.total).replace(/\s/g, ' ')}${aConferir ? ' (sem as bobinas, ainda a conferir)' : ''}`])
  linhas.push([
    'Pagamento',
    r.pago
      ? `${FORMAS_PAGAMENTO[evento.formaPagamento].label}${evento.dataPagamento ? `, pago em ${dataCurta(evento.dataPagamento)}` : ''}`
      : 'em aberto',
  ])
  return linhas
}

/** Assunto do e-mail: "Recibo nº 0031 – Baile da Cidade – Balanças.com". */
export function assuntoEmail({ evento, config, documento }: DadosMensagem) {
  const titulo = documento === 'recibo' ? `Recibo nº ${String(evento.codigo).padStart(4, '0')}` : 'Resumo da locação'
  return [titulo, evento.nome.trim(), empresa(config)].filter(Boolean).join(' – ')
}

const ABERTURA: Record<DocumentoEnvio, string> = {
  recibo: 'Segue em anexo o recibo do pagamento da locação das máquinas de fichas.',
  resumo: 'Segue em anexo o resumo da locação das máquinas de fichas.',
  nenhum: 'Segue o resumo da locação das máquinas de fichas.',
}

/** Corpo do e-mail, em texto simples. */
export function textoEmail(dados: DadosMensagem) {
  const nome = primeiroNome(dados.cliente)
  const assinatura = empresa(dados.config)
  return [
    nome ? `Olá, ${nome}!` : 'Olá!',
    '',
    ABERTURA[dados.documento],
    '',
    ...linhasResumo(dados).map(([rotulo, valor]) => `${rotulo}: ${valor}`),
    '',
    'Qualquer dúvida, estamos à disposição.',
    '',
    'Atenciosamente,',
    ...(assinatura ? [assinatura] : []),
  ].join('\n')
}

const FECHO_WHATSAPP: Record<DocumentoEnvio, string> = {
  recibo: 'O recibo em PDF vai logo abaixo.',
  resumo: 'O resumo em PDF vai logo abaixo.',
  nenhum: '',
}

/** Mensagem do WhatsApp, com os rótulos em *negrito* (como o WhatsApp mostra). */
export function textoWhatsApp(dados: DadosMensagem) {
  const nome = primeiroNome(dados.cliente)
  const assinatura = empresa(dados.config)
  const fecho = FECHO_WHATSAPP[dados.documento]
  return [
    `${nome ? `Olá, ${nome}!` : 'Olá!'} Tudo bem?`,
    '',
    dados.documento === 'recibo'
      ? 'Segue o recibo do pagamento da locação das máquinas de fichas:'
      : 'Segue o resumo da locação das máquinas de fichas:',
    '',
    ...linhasResumo(dados).map(([rotulo, valor]) => `*${rotulo}:* ${valor}`),
    '',
    ...(fecho ? [fecho] : []),
    'Qualquer dúvida, estamos à disposição.',
    ...(assinatura ? [assinatura] : []),
  ].join('\n')
}
