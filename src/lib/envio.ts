// Envio do recibo, do resumo do evento ou do contrato de locação para o cliente, por e-mail ou
// WhatsApp: os textos prontos, o telefone no formato do WhatsApp e o PDF em base64 para o e-mail.
// Sem React nem jsPDF, para poder ser testado; a janela de envio fica em EnviarDocumentoModal.tsx.

import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { codigoContrato, dataBR, reais } from '#shared/contrato.ts'
import { emailValido } from '#shared/dominio.ts'
import { datasOcupadas } from '#shared/maquinas.ts'
import type { Cliente, Configuracoes, Contrato, DataHora, Evento } from '#shared/tipos.ts'
import { codigoEvento, dataCurta, moeda } from './format'
import { periodoRecibo } from './recibo'

/** O que vai junto da mensagem: o recibo, o resumo do evento ou o contrato de locação em PDF, ou nada. */
export type DocumentoEnvio = 'recibo' | 'resumo' | 'contrato' | 'nenhum'

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
  /** O contrato enviado (com `documento: 'contrato'`): as linhas da mensagem saem dele, como foi gerado. */
  contrato?: Pick<Contrato, 'numero' | 'dados'>
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
  return primeiroNomeDe(cliente.responsavel.trim() || (cliente.tipo === 'PF' ? cliente.nome.trim() : ''))
}

/** Primeiro nome de um nome completo ("Pe. Antônio Carlos" → "Pe. Antônio"); vazio se não houver. */
export function primeiroNomeDe(nome: string): string {
  const [primeiro = '', segundo = ''] = nome.trim().split(/\s+/)
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

/** "10/10/2026, às 09h00"; sem hora, só a data; sem data, "a combinar". */
function quando(d: DataHora) {
  if (!d.data) return 'a combinar'
  const hora = /^\d{2}:\d{2}$/.test(d.hora) ? `, às ${d.hora.slice(0, 2)}h${d.hora.slice(3)}` : ''
  return `${dataBR(d.data)}${hora}`
}

/** Linhas do contrato (evento, datas, retirada, devolução e valor), como foi gerado. */
export function linhasContrato({ dados: d }: Pick<Contrato, 'numero' | 'dados'>): Array<[rotulo: string, valor: string]> {
  const datas = [...new Set(d.evento.dias.map((x) => x.data).filter(Boolean))]
  const linhas: Array<[string, string]> = [
    ['Evento', `${d.evento.nome} (${codigoEvento(d.evento.codigo)})${d.evento.local ? ` - ${d.evento.local}` : ''}`],
  ]
  if (datas.length) linhas.push([datas.length === 1 ? 'Data de uso' : 'Datas de uso', datasDoEvento(datas)])
  if (d.evento.comCliente) {
    linhas.push(['Máquinas com vocês', `de ${dataBR(d.evento.comCliente.inicio)} a ${dataBR(d.evento.comCliente.fim)}`])
  }
  linhas.push(['Retirada', quando(d.retirada)])
  linhas.push(['Devolução', quando(d.devolucao)])
  linhas.push(['Valor das diárias', reais(d.valores.total)])
  return linhas
}

/** As linhas da mensagem: as do contrato, quando é ele que vai, ou o resumo do evento. */
const linhasMensagem = (dados: DadosMensagem) =>
  dados.documento === 'contrato' && dados.contrato ? linhasContrato(dados.contrato) : linhasResumo(dados)

/** Quem vai ler: o primeiro nome do cliente ou, no contrato, o de quem assina por ele. */
const nomeDeQuemLe = ({ cliente, documento, contrato }: DadosMensagem) =>
  primeiroNome(cliente) || (documento === 'contrato' && contrato ? primeiroNomeDe(contrato.dados.assinante.nome) : '')

/** "Contrato de locação nº 0007" (sem o contrato, só "Contrato de locação"). */
const tituloContrato = (contrato: DadosMensagem['contrato']) =>
  `Contrato de locação${contrato ? ` ${codigoContrato(contrato.numero)}` : ''}`

/**
 * Assunto do e-mail: "Recibo nº 0031 – Baile da Cidade – Balanças.com" ou
 * "Contrato de locação nº 0007 – Baile da Cidade – Balanças.com".
 */
export function assuntoEmail({ evento, config, documento, contrato }: DadosMensagem) {
  const titulo =
    documento === 'recibo'
      ? `Recibo nº ${String(evento.codigo).padStart(4, '0')}`
      : documento === 'contrato'
        ? tituloContrato(contrato)
        : 'Resumo da locação'
  const nome = documento === 'contrato' && contrato ? contrato.dados.evento.nome : evento.nome.trim()
  return [titulo, nome, empresa(config)].filter(Boolean).join(' – ')
}

function abertura({ documento, contrato }: DadosMensagem) {
  switch (documento) {
    case 'recibo':
      return 'Segue em anexo o recibo do pagamento da locação das máquinas de fichas.'
    case 'resumo':
      return 'Segue em anexo o resumo da locação das máquinas de fichas.'
    case 'contrato':
      return `Segue em anexo o ${tituloContrato(contrato).replace(/^C/, 'c')} das máquinas de fichas. Por favor, leia com calma antes da retirada.`
    default:
      return 'Segue o resumo da locação das máquinas de fichas.'
  }
}

/** Como o cliente assina o contrato: no papel, na retirada, ou pelo gov.br (de graça). */
const ASSINAR_EMAIL = [
  'Para assinar, você pode:',
  '- imprimir, assinar e trazer na retirada das máquinas (ou assinar aqui, na hora); ou',
  '- assinar pelo gov.br, de graça, em https://assinador.iti.br, e nos devolver o PDF assinado respondendo este e-mail.',
]

/** Corpo do e-mail, em texto simples. */
export function textoEmail(dados: DadosMensagem) {
  const nome = nomeDeQuemLe(dados)
  const assinatura = empresa(dados.config)
  return [
    nome ? `Olá, ${nome}!` : 'Olá!',
    '',
    abertura(dados),
    '',
    ...linhasMensagem(dados).map(([rotulo, valor]) => `${rotulo}: ${valor}`),
    '',
    ...(dados.documento === 'contrato' ? [...ASSINAR_EMAIL, ''] : []),
    'Qualquer dúvida, estamos à disposição.',
    '',
    'Atenciosamente,',
    ...(assinatura ? [assinatura] : []),
  ].join('\n')
}

const FECHO_WHATSAPP: Record<DocumentoEnvio, string> = {
  recibo: 'O recibo em PDF vai logo abaixo.',
  resumo: 'O resumo em PDF vai logo abaixo.',
  contrato:
    'O contrato em PDF vai logo abaixo. Para assinar, traga impresso e assinado na retirada (ou assine aqui, na hora), ou' +
    ' assine pelo gov.br, de graça, em assinador.iti.br e mande o PDF assinado por aqui.',
  nenhum: '',
}

/** Mensagem do WhatsApp, com os rótulos em *negrito* (como o WhatsApp mostra). */
export function textoWhatsApp(dados: DadosMensagem) {
  const nome = nomeDeQuemLe(dados)
  const assinatura = empresa(dados.config)
  const fecho = FECHO_WHATSAPP[dados.documento]
  return [
    `${nome ? `Olá, ${nome}!` : 'Olá!'} Tudo bem?`,
    '',
    dados.documento === 'recibo'
      ? 'Segue o recibo do pagamento da locação das máquinas de fichas:'
      : dados.documento === 'contrato'
        ? `Segue o ${tituloContrato(dados.contrato).replace(/^C/, 'c')} das máquinas de fichas. Por favor, leia antes da retirada:`
        : 'Segue o resumo da locação das máquinas de fichas:',
    '',
    ...linhasMensagem(dados).map(([rotulo, valor]) => `*${rotulo}:* ${valor}`),
    '',
    ...(fecho ? [fecho] : []),
    'Qualquer dúvida, estamos à disposição.',
    ...(assinatura ? [assinatura] : []),
  ].join('\n')
}
