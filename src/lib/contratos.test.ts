import { describe, expect, it } from 'vitest'
import { montarDadosContrato } from '#shared/contrato.ts'
import { CLIENTE_VAZIO, CONFIG_PADRAO, MAQUINA_VAZIA } from '#shared/dominio.ts'
import type { Cliente, Contrato, Evento, Maquina, StatusContrato } from '#shared/tipos.ts'
import {
  contratoAguardando,
  contratoCombina,
  contratosDoEvento,
  contratoVigente,
  dataHoraCurta,
  encaixarNaPagina,
  filtroInicial,
  fotoComum,
  juntarLista,
  maquinasDoContrato,
  mudancasDoContrato,
  nomeAssinado,
  tipoAssinado,
} from './contratos'

const cliente = (extra: Partial<Cliente> = {}): Cliente => ({
  ...CLIENTE_VAZIO,
  id: 'c1',
  versao: 1,
  criadoEm: '',
  atualizadoEm: '',
  tipo: 'PF',
  nome: 'Juliana Martins',
  documento: '529.982.247-25',
  telefone: '(19) 99999-0000',
  ...extra,
})

const maquina = (identificacao: string): Maquina => ({
  ...MAQUINA_VAZIA,
  id: identificacao,
  versao: 1,
  identificacao,
  criadoEm: '',
  atualizadoEm: '',
})

const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: 'e1',
  versao: 1,
  codigo: 12,
  clienteId: 'c1',
  nome: 'Feira de Artesanato',
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: [
    { id: 'd1', data: '2026-10-11', maquinas: 3, reservas: 1, reservasUsadas: 0 },
    { id: 'd2', data: '2026-10-12', maquinas: 2, reservas: 0, reservasUsadas: 0 },
  ],
  maquinasIds: [],
  reservasIds: [],
  grupoId: '',
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 0,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'NAO_PAGO',
  dataPagamento: '',
  status: 'EM_ABERTO',
  rodape: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const dados = (e = evento(), c: Cliente | undefined = cliente(), maquinas: Maquina[] = []) =>
  montarDadosContrato({
    evento: e,
    cliente: c,
    maquinas,
    config: CONFIG_PADRAO,
    entrada: {
      local: '',
      retirada: { data: '2026-10-10', hora: '09:00' },
      devolucao: { data: '2026-10-13', hora: '' },
      assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
      condicoes: '',
    },
    hoje: '2026-10-01',
  })

const contrato = (numero: number, status: StatusContrato, extra: Partial<Contrato> = {}): Contrato => ({
  id: `k${numero}`,
  versao: 1,
  numero,
  eventoId: 'e1',
  clienteId: 'c1',
  status,
  assinadoEm: '',
  motivoCancelamento: '',
  dados: dados(),
  arquivo: null,
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

describe('contratos de cada evento', () => {
  const lista = [
    contrato(1, 'ASSINADO'),
    contrato(4, 'CANCELADO'),
    contrato(3, 'AGUARDANDO'),
    contrato(2, 'AGUARDANDO', { eventoId: 'outro' }),
  ]

  it('do mais novo para o mais antigo, só os do evento', () => {
    expect(contratosDoEvento(lista, 'e1').map((c) => c.numero)).toEqual([4, 3, 1])
    expect(contratosDoEvento(lista, 'nenhum')).toEqual([])
  })

  it('vale o mais recente que não foi cancelado; o que espera assinatura é o que um novo substitui', () => {
    expect(contratoVigente(lista, 'e1')?.numero).toBe(3)
    expect(contratoAguardando(lista, 'e1')?.numero).toBe(3)
    expect(contratoVigente([contrato(1, 'CANCELADO')], 'e1')).toBeUndefined()
    expect(contratoAguardando([contrato(1, 'ASSINADO')], 'e1')).toBeUndefined()
  })

  it('a aba abre nos que esperam assinatura; sem nenhum, em todos', () => {
    expect(filtroInicial(lista)).toBe('AGUARDANDO')
    expect(filtroInicial([contrato(1, 'ASSINADO')])).toBe('TODOS')
    expect(filtroInicial([])).toBe('TODOS')
  })
})

describe('busca', () => {
  const c = contrato(7, 'AGUARDANDO')

  it('pelo número, com ou sem zeros, "nº" ou "#"', () => {
    for (const termo of ['7', '0007', 'nº 7', 'Nº0007', '#7', 'contrato 7', 'no 7']) expect(contratoCombina(c, termo)).toBe(true)
    expect(contratoCombina(c, '17')).toBe(false)
    expect(contratoCombina(c, '70')).toBe(false)
  })

  it('pelo cliente (sem acento), pelo evento ou pelo nome do cadastro', () => {
    expect(contratoCombina(c, 'juliana')).toBe(true)
    expect(contratoCombina(c, 'feira de artesanato')).toBe(true)
    expect(contratoCombina(c, 'ARTESANATO')).toBe(true)
    expect(contratoCombina(c, 'padaria')).toBe(false)
    expect(contratoCombina(c, 'padaria', 'Padaria Ideal')).toBe(true)
    expect(contratoCombina(c, 'contrato')).toBe(true)
    expect(contratoCombina(c, '   ')).toBe(true)
  })
})

describe('textos curtos', () => {
  it('máquinas do dia de maior uso', () => {
    expect(maquinasDoContrato(dados())).toEqual({ curto: '3+1', extenso: '3 máquinas + 1 reserva' })
    const semReserva = dados(evento({ dias: [{ id: 'd', data: '2026-10-11', maquinas: 1, reservas: 0, reservasUsadas: 0 }] }))
    expect(maquinasDoContrato(semReserva)).toEqual({ curto: '1', extenso: '1 máquina' })
  })

  it('data e hora combinadas', () => {
    expect(dataHoraCurta({ data: '2026-10-10', hora: '09:00' })).toBe('10/10/2026 às 9h')
    expect(dataHoraCurta({ data: '2026-10-10', hora: '14:30' })).toBe('10/10/2026 às 14h30')
    expect(dataHoraCurta({ data: '2026-10-10', hora: '' })).toBe('10/10/2026')
    expect(dataHoraCurta({ data: '', hora: '09:00' })).toBe('')
  })

  it('lista com "e"', () => {
    expect(juntarLista([])).toBe('')
    expect(juntarLista(['valores'])).toBe('valores')
    expect(juntarLista(['a', 'b', 'c'])).toBe('a, b e c')
  })
})

describe('o aluguel mudou depois do contrato', () => {
  const fontes = { evento: evento(), cliente: cliente(), maquinas: [] as Maquina[], config: CONFIG_PADRAO }

  it('nada mudou', () => {
    expect(mudancasDoContrato(contrato(1, 'AGUARDANDO'), fontes)).toEqual([])
  })

  it('datas, valores e cliente', () => {
    const e = evento({ valorDiaria: 90, dias: [{ id: 'd1', data: '2026-10-18', maquinas: 3, reservas: 0, reservasUsadas: 0 }] })
    expect(mudancasDoContrato(contrato(1, 'ASSINADO'), { ...fontes, evento: e })).toEqual([
      'datas ou quantidade de máquinas',
      'valores',
    ])
    expect(
      mudancasDoContrato(contrato(1, 'AGUARDANDO'), { ...fontes, cliente: cliente({ telefone: '(19) 3524-0000' }) }),
    ).toEqual(['dados do cliente'])
  })

  it('não contam: o pagamento registrado depois e as máquinas escolhidas quando o contrato saiu sem elas', () => {
    const pago = evento({ formaPagamento: 'PIX', dataPagamento: '2026-10-02', maquinasIds: ['P-01', 'P-02', 'P-03', 'P-04'] })
    const maquinas = ['P-01', 'P-02', 'P-03', 'P-04'].map(maquina)
    expect(mudancasDoContrato(contrato(1, 'AGUARDANDO'), { ...fontes, evento: pago, maquinas })).toEqual([])
    // Com as máquinas no contrato, trocar uma delas conta
    const comMaquinas = contrato(1, 'AGUARDANDO', { dados: dados(pago, cliente(), maquinas) })
    const trocada = { ...pago, maquinasIds: ['P-01', 'P-02', 'P-03', 'G-01'] }
    expect(mudancasDoContrato(comMaquinas, { ...fontes, evento: trocada, maquinas: [...maquinas, maquina('G-01')] })).toEqual([
      'máquinas enviadas',
    ])
  })

  it('contrato cancelado ou evento excluído: nada a comparar', () => {
    const e = evento({ valorDiaria: 90 })
    expect(mudancasDoContrato(contrato(1, 'CANCELADO'), { ...fontes, evento: e })).toEqual([])
    expect(mudancasDoContrato(contrato(1, 'AGUARDANDO'), { ...fontes, evento: undefined })).toEqual([])
  })
})

describe('cópia assinada', () => {
  it('aceita PDF e fotos; o tipo vem do navegador ou, sem ele, da extensão', () => {
    expect(tipoAssinado('a.pdf', 'application/pdf')).toBe('application/pdf')
    expect(tipoAssinado('a.jpg', 'image/jpeg')).toBe('image/jpeg')
    expect(tipoAssinado('a.jpg', 'image/jpg')).toBe('image/jpeg')
    expect(tipoAssinado('IMG_0001.HEIC', '')).toBe('image/heic')
    expect(tipoAssinado('foto.jpeg', 'application/octet-stream')).toBe('image/jpeg')
    expect(tipoAssinado('a.webp', 'image/webp')).toBe('image/webp')
  })

  it('recusa o que não é PDF nem foto', () => {
    expect(tipoAssinado('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeNull()
    expect(tipoAssinado('a.gif', 'image/gif')).toBeNull()
    expect(tipoAssinado('sem-extensao', '')).toBeNull()
    // Extensão de foto com outro tipo informado pelo navegador: vale o tipo
    expect(tipoAssinado('a.jpg', 'text/plain')).toBeNull()
  })

  it('fotos que dá para juntar num PDF (HEIC o navegador não desenha)', () => {
    expect(fotoComum('image/jpeg')).toBe(true)
    expect(fotoComum('image/png')).toBe(true)
    expect(fotoComum('image/heic')).toBe(false)
    expect(fotoComum('application/pdf')).toBe(false)
  })

  it('nome do arquivo', () => {
    expect(nomeAssinado(7, 'pdf')).toBe('Contrato 0007 assinado.pdf')
    expect(nomeAssinado(123, '.jpg')).toBe('Contrato 0123 assinado.jpg')
  })

  it('encaixa a foto na folha A4 sem distorcer, centralizada', () => {
    // Retrato 3:4 → limitado pela largura (194 mm)
    const r = encaixarNaPagina(3000, 4000)
    expect(r.l).toBeCloseTo(194)
    expect(r.a).toBeCloseTo(258.67, 1)
    expect(r.x).toBeCloseTo(8)
    expect(r.y).toBeCloseTo((297 - r.a) / 2)
    // Paisagem → também pela largura, centralizada na altura
    const p = encaixarNaPagina(4000, 3000)
    expect(p.l).toBeCloseTo(194)
    expect(p.a).toBeCloseTo(145.5)
    // Muito comprida → limitada pela altura (281 mm)
    const c = encaixarNaPagina(1000, 5000)
    expect(c.a).toBeCloseTo(281)
    expect(c.x).toBeCloseTo((210 - c.l) / 2)
  })
})
