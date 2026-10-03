// Contrato de locação em PDF, no papel timbrado, a partir dos dados gravados no contrato (o texto
// vem de shared/contrato.ts). Carregado sob demanda com import(), junto com o jsPDF.
//
// Código de Defesa do Consumidor, art. 54: todo o texto em corpo 12 ou maior (§ 3º) e as cláusulas
// que limitam direitos do consumidor em destaque — aqui, em negrito (§ 4º).

import { jsPDF } from 'jspdf'
import { codigoContrato, textoContrato, textoDataHora } from '#shared/contrato.ts'
import type { Contrato } from '#shared/tipos.ts'
import { carregarTimbrado, LINHA, SECUNDARIO, TINTA, VERDE } from './pdf'
import { nomeArquivoSeguro } from './storage'
import { txt } from './pdfTexto'

const L = 22
const R = 188
const W = R - L
const CENTRO = 105
/** Corpo do texto (nunca menor que 12: CDC, art. 54, § 3º). */
const CORPO = 12
const ENTRELINHA = 5.6
/** O texto nunca passa daqui: abaixo ficam o rodapé com a página e as rubricas, e o rodapé do timbrado. */
const LIMITE = 246
const Y_RODAPE = 254
const INICIO_PRIMEIRA = 58
const INICIO_DEMAIS = 50

/** Vermelho do aviso de contrato cancelado. */
const VERMELHO: [number, number, number] = [190, 40, 40]

export async function gerarContratoPDF(contrato: Pick<Contrato, 'numero' | 'dados' | 'status' | 'motivoCancelamento'>) {
  const img = await carregarTimbrado()
  const d = contrato.dados
  const numero = codigoContrato(contrato.numero)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.setProperties({
    title: `Contrato de locação ${numero} - ${d.cliente.nome} - ${d.evento.nome}`,
    creator: 'BC Fichas Control',
  })

  const novaPagina = (primeira = false) => {
    if (!primeira) doc.addPage()
    doc.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    y = primeira ? INICIO_PRIMEIRA : INICIO_DEMAIS
    if (contrato.status === 'CANCELADO') {
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(CORPO)
        .setTextColor(...VERMELHO)
      doc.text(txt(`CONTRATO CANCELADO${contrato.motivoCancelamento ? ` - ${contrato.motivoCancelamento}` : ''}`), L, y - 8, {
        maxWidth: W,
      })
    }
  }
  let y = INICIO_PRIMEIRA
  novaPagina(true)
  const caber = (altura: number) => {
    if (y + altura > LIMITE) novaPagina()
  }

  /** Escreve um parágrafo quebrando as linhas; continua na página seguinte se não couber. */
  const paragrafo = (texto: string, negrito = false, recuo = 0) => {
    doc
      .setFont('helvetica', negrito ? 'bold' : 'normal')
      .setFontSize(CORPO)
      .setTextColor(...TINTA)
    const linhas = doc.splitTextToSize(txt(texto), W - recuo) as string[]
    // Evita uma linha sozinha no fim da página
    caber(Math.min(linhas.length, 2) * ENTRELINHA)
    for (const linha of linhas) {
      caber(ENTRELINHA)
      doc.text(linha, L + recuo, y)
      y += ENTRELINHA
    }
    y += 1.6
  }

  const blocos = textoContrato(d, contrato.numero)
  const fecho = blocos.flatMap((b) => (b.tipo === 'fecho' ? [b.texto] : []))
  for (const bloco of blocos) {
    if (bloco.tipo === 'fecho') continue
    if (bloco.tipo === 'titulo') {
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(14)
        .setTextColor(...TINTA)
      const linhas = doc.splitTextToSize(txt(bloco.texto), W) as string[]
      linhas.forEach((l, i) => doc.text(l, CENTRO, y + i * 6.4, { align: 'center' }))
      y += (linhas.length - 1) * 6.4 + 3
      doc.setFillColor(...VERDE).roundedRect(CENTRO - 12, y, 24, 1.1, 0.5, 0.5, 'F')
      y += 9
    } else if (bloco.tipo === 'campos') {
      // Quadro-resumo: rótulo em negrito e o valor ao lado, com fundo claro
      const linhas = bloco.itens.map(([rotulo, valor]) => {
        doc.setFont('helvetica', 'bold').setFontSize(CORPO)
        const r = txt(`${rotulo}: `)
        const larguraRotulo = doc.getTextWidth(r)
        doc.setFont('helvetica', 'normal')
        return { r, larguraRotulo, valor: doc.splitTextToSize(txt(valor), W - 8 - larguraRotulo) as string[] }
      })
      const altura = linhas.reduce((s, l) => s + l.valor.length * ENTRELINHA, 0) + 6
      caber(altura)
      doc.setFillColor(244, 246, 245).roundedRect(L, y - 4.6, W, altura, 2, 2, 'F')
      y += 1
      for (const l of linhas) {
        doc
          .setFont('helvetica', 'bold')
          .setFontSize(CORPO)
          .setTextColor(...TINTA)
        doc.text(l.r, L + 4, y)
        doc.setFont('helvetica', 'normal')
        l.valor.forEach((v, i) => doc.text(v, L + 4 + l.larguraRotulo, y + i * ENTRELINHA))
        y += l.valor.length * ENTRELINHA
      }
      y += 7
    } else if (bloco.tipo === 'clausula') {
      // O título da cláusula nunca fica sozinho no fim da página
      y += 2
      caber(ENTRELINHA * 3)
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(CORPO)
        .setTextColor(...VERDE)
      doc.text(txt(bloco.texto), L, y)
      y += ENTRELINHA + 0.8
    } else {
      const item = /^(•|[a-z]\))\s/.test(bloco.texto)
      paragrafo(bloco.texto, bloco.destaque, item ? 4 : 0)
    }
  }

  // Assinaturas (sempre juntas): linha e, embaixo, quem assina (cada lado quebra em até 76 mm)
  const LARGURA_ASSINATURA = 76
  const quebrar = (linhas: string[]) =>
    linhas.flatMap((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal').setFontSize(CORPO)
      return (doc.splitTextToSize(txt(l), LARGURA_ASSINATURA) as string[]).map((t) => ({ t, negrito: i === 0 }))
    })
  const locadora = quebrar(
    [
      'LOCADORA',
      d.empresa.razaoSocial,
      d.empresa.representante ? d.empresa.representante : '',
      d.empresa.representanteCpf ? `CPF ${d.empresa.representanteCpf}` : '',
    ].filter(Boolean),
  )
  const locatario = quebrar(
    [
      'LOCATÁRIO',
      d.cliente.nome || 'Nome: ____________________',
      d.assinante.nome || (d.cliente.tipo === 'PF' ? '' : 'Representante: ____________________'),
      d.assinante.cpf
        ? `CPF ${d.assinante.cpf}`
        : d.cliente.tipo === 'PF' && d.cliente.documento
          ? ''
          : 'CPF: ____________________',
    ].filter(Boolean),
  )
  const ESPACO_ASSINAR = 20
  const alturaAssinaturas = ESPACO_ASSINAR + Math.max(locadora.length, locatario.length) * ENTRELINHA + 2
  // A declaração, o local e a data vão junto com as assinaturas (nunca separados delas)
  doc.setFont('helvetica', 'normal').setFontSize(CORPO)
  const linhasFecho = fecho.map((t) => doc.splitTextToSize(txt(t), W) as string[])
  const alturaFecho = linhasFecho.reduce((s, l) => s + l.length * ENTRELINHA + 1.6, 0) + 2
  caber(alturaFecho + alturaAssinaturas)
  y += 2
  linhasFecho.forEach((linhas, i) => {
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(CORPO)
      .setTextColor(...TINTA)
    linhas.forEach((l) => {
      doc.text(l, i === linhasFecho.length - 1 ? R : L, y, { align: i === linhasFecho.length - 1 ? 'right' : 'left' })
      y += ENTRELINHA
    })
    y += 1.6
  })
  const yLinha = y + ESPACO_ASSINAR
  for (const [x, linhas] of [
    [CENTRO - 42, locadora],
    [CENTRO + 42, locatario],
  ] as const) {
    doc
      .setDrawColor(...TINTA)
      .setLineWidth(0.3)
      .line(x - 38, yLinha, x + 38, yLinha)
    linhas.forEach((l, i) => {
      doc
        .setFont('helvetica', l.negrito ? 'bold' : 'normal')
        .setFontSize(CORPO)
        .setTextColor(...(l.negrito ? TINTA : SECUNDARIO))
      doc.text(l.t, x, yLinha + 5.6 + i * ENTRELINHA, { align: 'center' })
    })
  }
  y += alturaAssinaturas

  termoDeEntrega(
    doc,
    contrato,
    novaPagina,
    () => y,
    (v) => (y = v),
  )

  // Rodapé de cada página: número do contrato, página e espaço para as rubricas
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(CORPO)
      .setTextColor(...SECUNDARIO)
    doc.text(txt(`Contrato ${numero} - página ${p} de ${total}`), L, Y_RODAPE)
    doc.text('Rubricas: _______  _______', R, Y_RODAPE, { align: 'right' })
  }

  const nome = `${nomeArquivoSeguro(`Contrato ${String(contrato.numero).padStart(4, '0')} - ${d.cliente.nome || 'Cliente'} - ${d.evento.nome}`)}.pdf`
  return { doc, nome }
}

/**
 * Termo de Entrega e Devolução (anexo do contrato): uma linha por máquina para conferir na retirada
 * e na devolução, as bobinas e as assinaturas dos dois momentos.
 */
function termoDeEntrega(
  doc: jsPDF,
  contrato: Pick<Contrato, 'numero' | 'dados'>,
  novaPagina: (primeira?: boolean) => void,
  lerY: () => number,
  mudarY: (y: number) => void,
) {
  const d = contrato.dados
  novaPagina()
  let y = lerY()
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(14)
    .setTextColor(...TINTA)
  doc.text('TERMO DE ENTREGA E DEVOLUÇÃO', CENTRO, y, { align: 'center' })
  y += 6.4
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(CORPO)
    .setTextColor(...SECUNDARIO)
  doc.text(txt(`Anexo do contrato ${codigoContrato(contrato.numero)} - ${d.evento.nome}`), CENTRO, y, { align: 'center' })
  y += 9
  doc.setTextColor(...TINTA)
  for (const linha of [
    `Locatário: ${d.cliente.nome || '______________________________'}`,
    `Retirada: ${textoDataHora(d.retirada)}`,
    `Devolução: ${textoDataHora(d.devolucao)}`,
  ]) {
    const partes = doc.splitTextToSize(txt(linha), W) as string[]
    partes.forEach((p) => {
      doc.text(p, L, y)
      y += ENTRELINHA
    })
  }
  y += 3

  // Tabela das máquinas: as escolhidas, ou linhas em branco para anotar na retirada
  const colunas = [
    { titulo: 'Máquina', largura: 26 },
    { titulo: 'Função', largura: 26 },
    { titulo: 'Entrega OK', largura: 28 },
    { titulo: 'Devolução OK', largura: 32 },
    { titulo: 'Observações', largura: W - 26 - 26 - 28 - 32 },
  ]
  const necessarias = Math.max(1, ...d.evento.dias.map((x) => x.maquinas + x.reservas))
  const linhas = d.evento.maquinas.length
    ? d.evento.maquinas.map((m) => [m.identificacao, m.reserva ? 'Reserva' : 'Titular'])
    : Array.from({ length: necessarias }, () => ['', ''])
  const ALTURA = 8
  const cabecalho = () => {
    doc.setFillColor(...VERDE).rect(L, y, W, ALTURA, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(CORPO).setTextColor(255, 255, 255)
    let x = L
    for (const c of colunas) {
      doc.text(txt(c.titulo), x + 2, y + 5.6)
      x += c.largura
    }
    y += ALTURA
  }
  cabecalho()
  doc.setFont('helvetica', 'normal').setTextColor(...TINTA)
  for (const [ident, funcao] of linhas) {
    if (y + ALTURA > LIMITE - 40) {
      mudarY(y)
      novaPagina()
      y = lerY()
      cabecalho()
      doc.setFont('helvetica', 'normal').setTextColor(...TINTA)
    }
    doc
      .setDrawColor(...LINHA)
      .setLineWidth(0.3)
      .rect(L, y, W, ALTURA)
    let x = L
    colunas.forEach((c, i) => {
      if (i > 0) doc.line(x, y, x, y + ALTURA)
      if (i === 0 && ident) doc.text(txt(ident), x + 2, y + 5.6)
      if (i === 1 && funcao) doc.text(txt(funcao), x + 2, y + 5.6)
      // Quadradinho para marcar
      if (i === 2 || i === 3)
        doc
          .setDrawColor(...TINTA)
          .rect(x + c.largura / 2 - 2.2, y + 1.8, 4.4, 4.4)
          .setDrawColor(...LINHA)
      x += c.largura
    })
    y += ALTURA
  }
  y += 7

  const linhasInfo = [
    `Bobinas entregues: ${d.valores.bobinasConsignadas || '______'} (lacradas)`,
    'Bobinas devolvidas lacradas: ______    Abertas ou usadas: ______',
    'Bobinas não devolvidas: ______',
    ...(d.evento.dias.some((x) => x.reservas > 0) ? ['Reserva usada nas datas: ______________________________'] : []),
    'Observações: __________________________________________________________',
  ]
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(CORPO)
    .setTextColor(...TINTA)
  for (const l of linhasInfo) {
    if (y + ENTRELINHA > LIMITE - 36) {
      mudarY(y)
      novaPagina()
      y = lerY()
    }
    const partes = doc.splitTextToSize(txt(l), W) as string[]
    partes.forEach((p) => {
      doc.text(p, L, y)
      y += ENTRELINHA + 1
    })
  }

  // Assinaturas da retirada e da devolução
  if (y + 40 > LIMITE) {
    mudarY(y)
    novaPagina()
    y = lerY()
  }
  y += 6
  for (const momento of ['Na retirada, em ____/____/______', 'Na devolução, em ____/____/______']) {
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(CORPO)
      .setTextColor(...TINTA)
    doc.text(txt(momento), L, y)
    y += 13
    doc.setDrawColor(...TINTA).setLineWidth(0.3)
    doc.line(L, y, L + 74, y)
    doc.line(R - 74, y, R, y)
    doc.setFont('helvetica', 'normal').setTextColor(...SECUNDARIO)
    doc.text('LOCADORA', L + 37, y + 5, { align: 'center' })
    doc.text('LOCATÁRIO', R - 37, y + 5, { align: 'center' })
    y += 12
  }
  mudarY(y)
}

export async function baixarContratoPDF(contrato: Pick<Contrato, 'numero' | 'dados' | 'status' | 'motivoCancelamento'>) {
  const { doc, nome } = await gerarContratoPDF(contrato)
  doc.save(nome)
  return nome
}
