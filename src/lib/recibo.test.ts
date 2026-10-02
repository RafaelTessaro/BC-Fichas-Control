import { describe, expect, it } from 'vitest'
import { CLIENTE_VAZIO, CONFIG_PADRAO } from '#shared/dominio.ts'
import type { Cliente, Evento } from '#shared/tipos.ts'
import { dataPorExtenso, montarRecibo, periodoRecibo, podeGerarRecibo } from './recibo'

const cliente = (extra: Partial<Cliente>): Cliente => ({
  ...CLIENTE_VAZIO,
  id: 'c1',
  versao: 1,
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: 'e1',
  versao: 1,
  codigo: 31,
  clienteId: 'c1',
  nome: 'Baile da Cidade',
  cidade: 'Rio Claro',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: [
    { id: 'd1', data: '2026-10-11', maquinas: 3 },
    { id: 'd2', data: '2026-10-12', maquinas: 3 },
  ],
  maquinasIds: [],
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 0,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'PIX',
  dataPagamento: '2026-10-02',
  status: 'FINALIZADO',
  rodape: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

describe('recibo', () => {
  it('só existe para pagamento em PIX ou dinheiro, fora de evento cancelado', () => {
    expect(podeGerarRecibo({ formaPagamento: 'PIX', status: 'FINALIZADO' })).toBe(true)
    expect(podeGerarRecibo({ formaPagamento: 'DINHEIRO', status: 'EM_ABERTO' })).toBe(true)
    expect(podeGerarRecibo({ formaPagamento: 'BOLETO', status: 'FINALIZADO' })).toBe(false)
    expect(podeGerarRecibo({ formaPagamento: 'NAO_PAGO', status: 'FINALIZADO' })).toBe(false)
    expect(podeGerarRecibo({ formaPagamento: 'PIX', status: 'CANCELADO' })).toBe(false)
  })

  it('escreve as datas do evento de forma natural', () => {
    expect(periodoRecibo([])).toBe('')
    expect(periodoRecibo(['2026-10-11'])).toBe('em 11/10/2026')
    expect(periodoRecibo(['2026-10-12', '2026-10-11', '2026-10-13'])).toBe('de 11 a 13/10/2026')
    expect(periodoRecibo(['2026-09-30', '2026-10-01'])).toBe('de 30/09 a 01/10/2026')
    expect(periodoRecibo(['2025-12-31', '2026-01-01'])).toBe('de 31/12/2025 a 01/01/2026')
    expect(periodoRecibo(['2026-10-11', '2026-10-12', '2026-10-18'])).toBe('nos dias 11, 12 e 18/10/2026')
    expect(periodoRecibo(['2026-09-27', '2026-10-04'])).toBe('nos dias 27/09 e 04/10/2026')
    const soltos = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-11-25']
    expect(periodoRecibo(soltos)).toBe('entre 01/10 e 25/11/2026 (6 dias)')
  })

  it('escreve a data por extenso, com "1º" no primeiro dia do mês', () => {
    expect(dataPorExtenso('2026-10-02')).toBe('2 de outubro de 2026')
    expect(dataPorExtenso('2026-03-01')).toBe('1º de março de 2026')
  })

  it('monta o texto para empresa com razão social e CNPJ', () => {
    const c = cliente({
      tipo: 'PJ',
      nome: 'Padaria Ideal',
      razaoSocial: 'PADARIA IDEAL LTDA',
      documento: '12.403.843/0001-18',
    })
    const r = montarRecibo(evento(), c, CONFIG_PADRAO)
    expect(r.numero).toBe('Nº 0031')
    expect(r.valorTexto).toBe('R$ 480,00')
    expect(r.texto).toBe(
      'Recebemos de PADARIA IDEAL LTDA, CNPJ 12.403.843/0001-18, a importância de R$ 480,00 (quatrocentos e oitenta reais), ' +
        'referente à locação de máquinas de fichas para o evento “Baile da Cidade”, de 11 a 12/10/2026, em Rio Claro.',
    )
    expect(r.detalhes).toEqual([{ rotulo: 'Diárias', conta: '6 diárias × R$ 80,00', valor: 'R$ 480,00' }])
    expect(r.total).toBeNull()
    expect(r.pagamento).toBe('PIX, em 02/10/2026')
    expect(r.fecho).toBe('Para maior clareza, firmamos o presente recibo.')
    expect(r.localData).toBe('Rio Claro - SP, 2 de outubro de 2026.')
    expect(r.assinatura).toEqual(['FABIO DE GODOY LIMA LTDA', 'Balanças.com', 'CNPJ 12.403.843/0001-18'])
    expect(r.nomeArquivo).toBe('Recibo_0031_Padaria_Ideal.pdf')
  })

  it('inclui bobinas conferidas e desconto, com centavos por extenso', () => {
    const c = cliente({ tipo: 'PF', nome: 'Juliana Martins', documento: '123.456.789-09' })
    const r = montarRecibo(
      evento({
        dias: [{ id: 'd1', data: '2026-10-11', maquinas: 2 }],
        valorDiaria: 80.5,
        bobinasConsignadas: 50,
        bobinasDevolvidas: 13,
        desconto: 10.25,
        formaPagamento: 'DINHEIRO',
        cidade: '',
      }),
      c,
      CONFIG_PADRAO,
    )
    // 2 × 80,50 + 37 × 6 − 10,25 = 372,75
    expect(r.valorTexto).toBe('R$ 372,75')
    expect(r.texto).toBe(
      'Recebemos de Juliana Martins, CPF 123.456.789-09, a importância de R$ 372,75 ' +
        '(trezentos e setenta e dois reais e setenta e cinco centavos), referente à locação de máquinas de fichas ' +
        'para o evento “Baile da Cidade”, em 11/10/2026.',
    )
    expect(r.detalhes).toEqual([
      { rotulo: 'Diárias', conta: '2 diárias × R$ 80,50', valor: 'R$ 161,00' },
      { rotulo: 'Bobinas', conta: '37 bobinas × R$ 6,00', valor: 'R$ 222,00' },
      { rotulo: 'Desconto', conta: '', valor: '– R$ 10,25' },
    ])
    expect(r.total).toBe('R$ 372,75')
    expect(r.pagamento).toBe('Dinheiro, em 02/10/2026')
  })

  it('cliente avulso sai só com o nome; bobinas a conferir ficam de fora', () => {
    const c = cliente({ tipo: 'AVULSO', nome: 'Barraca do Seu Zé' })
    const r = montarRecibo(evento({ bobinasConsignadas: 40, bobinasDevolvidas: null }), c, CONFIG_PADRAO)
    expect(r.texto.startsWith('Recebemos de Barraca do Seu Zé, a importância de R$ 480,00')).toBe(true)
    expect(r.detalhes.map((d) => d.rotulo)).toEqual(['Diárias'])
    expect(r.nomeArquivo).toBe('Recibo_0031_Barraca_do_Seu_Zé.pdf')
  })

  it('sem data de pagamento usa hoje; sem cliente deixa espaço para escrever', () => {
    const r = montarRecibo(evento({ dataPagamento: '' }), undefined, { ...CONFIG_PADRAO, empresaCidade: '' }, '2026-03-01')
    expect(r.pagamento).toBe('PIX')
    expect(r.localData).toBe('1º de março de 2026.')
    expect(r.texto.startsWith('Recebemos de ____')).toBe(true)
    expect(r.nomeArquivo).toBe('Recibo_0031.pdf')
  })

  it('avulso sem nome (gravado como “Cliente avulso”) também deixa o espaço em branco', () => {
    const r = montarRecibo(evento(), cliente({ tipo: 'AVULSO', nome: 'Cliente avulso' }), CONFIG_PADRAO)
    expect(r.texto.startsWith('Recebemos de ______________________________, a importância')).toBe(true)
    expect(r.nomeArquivo).toBe('Recibo_0031.pdf')
    // Com documento, o espaço fica para o nome e o CPF sai preenchido
    const comCpf = montarRecibo(
      evento(),
      cliente({ tipo: 'AVULSO', nome: 'Cliente avulso', documento: '123.456.789-09' }),
      CONFIG_PADRAO,
    )
    expect(comCpf.texto.startsWith('Recebemos de ______________________________, CPF 123.456.789-09, a importância')).toBe(true)
  })

  it('sem razão social da empresa assina com o nome; nome com caracteres proibidos vira arquivo válido', () => {
    const c = cliente({ tipo: 'PJ', nome: 'Bar: "Ponto/Final"', razaoSocial: '' })
    const r = montarRecibo(evento(), c, { ...CONFIG_PADRAO, empresaRazaoSocial: '', empresaCnpj: '' })
    expect(r.assinatura).toEqual(['Balanças.com'])
    expect(r.texto.startsWith('Recebemos de Bar: "Ponto/Final", a importância')).toBe(true)
    expect(r.nomeArquivo).toBe('Recibo_0031_Bar-_-Ponto-Final-.pdf')
  })
})
