import { describe, expect, it } from 'vitest'
import type { Evento, Maquina, OrdemServico } from '#shared/tipos.ts'
import {
  avisoLocacoes,
  haQuantoTempo,
  historicoMaquina,
  indicesOrdens,
  locacoesDeHojeEmDiante,
  maquinaCombina,
  nomeAlemDoLocal,
  ordenarOrdens,
  perguntaSituacao,
  resumoMaquina,
  sugestaoMaquina,
  sugestaoMarcada,
} from './manutencao'

const maq = (identificacao: string, extra: Partial<Maquina> = {}): Maquina => ({
  id: identificacao,
  versao: 1,
  tipo: identificacao.toUpperCase().startsWith('G') ? 'G' : 'P',
  identificacao,
  status: 'DISPONIVEL',
  modelo: '',
  numeroSerie: '',
  dataAquisicao: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const ev = (id: string, datas: string[], maquinasIds: string[], extra: Partial<Evento> = {}): Evento => ({
  id,
  versao: 1,
  codigo: Number(id.replace(/\D/g, '')) || 1,
  clienteId: 'c',
  nome: `Evento ${id}`,
  cidade: '',
  cabecalho: '',
  dias: datas.map((data, i) => ({ id: `${id}${i}`, data, maquinas: 1 })),
  maquinasIds,
  valorDiaria: 0,
  valorBobina: 0,
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

const os = (numero: number, maquinaId: string, extra: Partial<OrdemServico> = {}): OrdemServico => ({
  id: `os${numero}`,
  versao: 1,
  numero,
  maquinaId,
  tipo: 'PREVENTIVA',
  status: 'CONCLUIDA',
  abertura: '2026-01-10',
  conclusao: '2026-01-10',
  servicos: ['Limpeza completa'],
  problema: '',
  solucao: '',
  pecas: '',
  responsavel: '',
  custo: 0,
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const HOJE = '2026-10-02'

describe('busca de máquinas', () => {
  const p1 = maq('P-01', { modelo: 'Compacta 2 vias', numeroSerie: 'SN-778' })
  it('acha pela identificação com ou sem traço e zeros', () => {
    expect(maquinaCombina(p1, 'p1')).toBe(true)
    expect(maquinaCombina(p1, 'P 01')).toBe(true)
    expect(maquinaCombina(p1, 'p-01')).toBe(true)
    expect(maquinaCombina(p1, 'g1')).toBe(false)
    expect(maquinaCombina(maq('P-10'), 'p1')).toBe(false)
  })
  it('acha pelo modelo e pelo número de série, sem diferenciar acentos', () => {
    expect(maquinaCombina(p1, 'compacta')).toBe(true)
    expect(maquinaCombina(p1, 'sn-778')).toBe(true)
    expect(maquinaCombina(maq('G-02', { modelo: 'Máquina térmica' }), 'termica')).toBe(true)
    expect(maquinaCombina(p1, '')).toBe(true)
  })
})

describe('nome do evento além do local', () => {
  it('omite o nome quando ele é a própria 1ª linha do cabeçalho', () => {
    expect(nomeAlemDoLocal({ nome: 'Festa Junina', cabecalho: 'FESTA JUNINA\nCLUBE X' })).toBeUndefined()
    expect(nomeAlemDoLocal({ nome: 'Festa Junina', cabecalho: 'ESCOLA ESTADUAL\nARRAIÁ' })).toBe('Festa Junina')
    expect(nomeAlemDoLocal({ nome: 'Festa Junina', cabecalho: '' })).toBeUndefined()
  })
})

describe('tempo e ordenação', () => {
  it('descreve há quanto tempo', () => {
    expect(haQuantoTempo(HOJE, HOJE)).toBe('hoje')
    expect(haQuantoTempo('2026-10-01', HOJE)).toBe('ontem')
    expect(haQuantoTempo('2026-09-27', HOJE)).toBe('há 5 dias')
  })
  it('coloca as O.S. em aberto primeiro, a mais antiga antes', () => {
    const lista = ordenarOrdens([
      os(1, 'a', { conclusao: '2026-03-01' }),
      os(2, 'a', { status: 'ABERTA', abertura: '2026-09-30', conclusao: '' }),
      os(3, 'a', { conclusao: '2026-08-01' }),
      os(4, 'a', { status: 'EM_ANDAMENTO', abertura: '2026-09-01', conclusao: '' }),
    ])
    expect(lista.map((o) => o.numero)).toEqual([4, 2, 3, 1])
  })
})

describe('resumo da máquina', () => {
  const ordens = [
    os(1, 'P-01', { custo: 100, conclusao: '2026-03-02' }),
    os(2, 'P-01', { custo: 50.5, conclusao: '2026-07-20' }),
    os(3, 'P-01', { status: 'CANCELADA', custo: 999, conclusao: '' }),
    os(4, 'P-01', { status: 'ABERTA', custo: 20, conclusao: '' }),
    os(5, 'G-01', { custo: 70 }),
  ]
  const eventos = [
    ev('e1', ['2026-05-01', '2026-05-02'], ['P-01']),
    ev('e2', ['2026-10-10'], ['P-01', 'G-01']),
    ev('e3', ['2026-06-01'], ['P-01'], { status: 'CANCELADO' }),
    ev('e4', ['2026-06-05'], ['G-01']),
  ]

  it('soma manutenções, gasto, eventos e diárias', () => {
    expect(resumoMaquina('P-01', ordens, eventos, HOJE)).toEqual({
      concluidas: 2,
      emAberto: 1,
      gasto: 170.5,
      ultimaManutencao: '2026-07-20',
      eventos: 2,
      diarias: 3,
      agendados: 1,
    })
  })

  it('indexa a última manutenção e as O.S. em aberto de cada máquina', () => {
    const { ultima, abertas } = indicesOrdens(ordens)
    expect(ultima.get('P-01')).toBe('2026-07-20')
    expect(ultima.get('G-01')).toBe('2026-01-10')
    expect(abertas.get('P-01')).toBe(1)
    expect(abertas.has('G-01')).toBe(false)
  })

  it('lista as locações de hoje em diante, da mais próxima para a mais distante', () => {
    const lista = locacoesDeHojeEmDiante(
      'P-01',
      [...eventos, ev('e5', ['2026-10-01', '2026-10-03'], ['P-01']), ev('e6', ['2026-10-09'], ['P-01'])],
      HOJE,
    )
    expect(lista.map((l) => l.evento.id)).toEqual(['e5', 'e6', 'e2'])
  })

  it('monta a linha do tempo sem eventos cancelados, da mais recente para a mais antiga', () => {
    const itens = historicoMaquina('P-01', ordens, [...eventos, ev('e5', ['2026-10-01', '2026-10-03'], ['P-01'])], HOJE)
    expect(itens.map((i) => i.id)).toEqual(['e2', 'e5', 'e1', 'os4', 'os3', 'os2', 'os1'])
    const quando = itens.flatMap((i) => (i.tipo === 'locacao' ? [i.quando] : []))
    expect(quando).toEqual(['futura', 'agora', 'passada'])
  })
})

describe('sugestão para a máquina ao salvar a O.S.', () => {
  it('coloca em manutenção ao abrir e libera ao concluir', () => {
    expect(sugestaoMaquina('ABERTA', 'DISPONIVEL')).toBe('MANUTENCAO')
    expect(sugestaoMaquina('EM_ANDAMENTO', 'MANUTENCAO')).toBeNull()
    expect(sugestaoMaquina('CONCLUIDA', 'MANUTENCAO')).toBe('LIBERAR')
    expect(sugestaoMaquina('CANCELADA', 'MANUTENCAO')).toBe('LIBERAR')
    expect(sugestaoMaquina('CONCLUIDA', 'DISPONIVEL')).toBeNull()
    expect(sugestaoMaquina('ABERTA', 'DESATIVADA')).toBeNull()
  })
  it('só vem marcada em O.S. nova ou quando a situação muda, e não libera com outra O.S. aberta', () => {
    expect(sugestaoMarcada('MANUTENCAO', { nova: true, situacaoMudou: false, outrasEmAberto: 0 })).toBe(true)
    expect(sugestaoMarcada('MANUTENCAO', { nova: false, situacaoMudou: false, outrasEmAberto: 0 })).toBe(false)
    expect(sugestaoMarcada('LIBERAR', { nova: false, situacaoMudou: true, outrasEmAberto: 0 })).toBe(true)
    expect(sugestaoMarcada('LIBERAR', { nova: false, situacaoMudou: true, outrasEmAberto: 1 })).toBe(false)
    expect(sugestaoMarcada(null, { nova: true, situacaoMudou: true, outrasEmAberto: 0 })).toBe(false)
    // Locada agora: a caixa aparece, mas desmarcada (a máquina ainda está no evento)
    expect(sugestaoMarcada('MANUTENCAO', { nova: true, situacaoMudou: false, outrasEmAberto: 0, locadaAgora: true })).toBe(false)
  })
})

describe('confirmação ao trocar a situação', () => {
  const locacoes = locacoesDeHojeEmDiante(
    'P-01',
    [ev('e1', ['2026-10-02', '2026-10-03'], ['P-01'], { cabecalho: 'FESTA DA PRIMAVERA\nCLUBE X' })],
    HOJE,
  )
  const p1 = maq('P-01')

  it('desativar sempre pergunta e avisa dos eventos de hoje em diante', () => {
    const semEventos = perguntaSituacao(p1, 'DESATIVADA', [])
    expect(semEventos?.perigo).toBe(true)
    expect(semEventos?.descricao).not.toContain('Atenção')
    const comEventos = perguntaSituacao(p1, 'DESATIVADA', locacoes)
    expect(comEventos?.descricao).toContain('FESTA DA PRIMAVERA (02 a 03/10/2026)')
    expect(comEventos?.descricao).toContain('Troque a máquina nesse evento.')
  })

  it('manutenção só pergunta com eventos marcados; voltar para disponível não pergunta', () => {
    expect(perguntaSituacao(p1, 'MANUTENCAO', [])).toBeNull()
    expect(perguntaSituacao(p1, 'MANUTENCAO', locacoes)?.descricao).toContain('Se o conserto não ficar pronto a tempo')
    expect(perguntaSituacao({ ...p1, status: 'MANUTENCAO' }, 'DISPONIVEL', locacoes)).toBeNull()
    expect(perguntaSituacao(p1, 'DISPONIVEL', locacoes)).toBeNull()
    expect(avisoLocacoes([])).toBe('')
  })
})
