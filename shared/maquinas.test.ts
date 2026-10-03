import { describe, expect, it } from 'vitest'
import { normalizarEvento, normalizarOS, programacaoPadrao, validarBackup } from './dominio.ts'
import { ocupacaoPorDia } from './calc.ts'
import {
  cabecalhoEmLinha,
  capacidade,
  chaveIdentificacao,
  conflitosMaquinas,
  datasOcupadas,
  diasOcupados,
  localDaLocacao,
  maquinasOcupadas,
  numeroDaIdentificacao,
  ordenarMaquinas,
  planoAjuste,
  proximasIdentificacoes,
  situacaoMaquina,
} from './maquinas.ts'
import type { Evento, Maquina, OrdemServico } from './tipos.ts'

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
  codigo: 1,
  clienteId: 'c',
  nome: `Evento ${id}`,
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
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

describe('identificação das máquinas', () => {
  it('trata como iguais as identificações escritas de jeitos diferentes', () => {
    expect(chaveIdentificacao('P-01')).toBe(chaveIdentificacao('p 1'))
    expect(chaveIdentificacao('P01')).toBe(chaveIdentificacao('P-1'))
    expect(chaveIdentificacao('Máquina 01')).toBe(chaveIdentificacao('MAQUINA 1'))
    expect(chaveIdentificacao('P-10')).not.toBe(chaveIdentificacao('P-1'))
    expect(chaveIdentificacao('P-100')).toBe('P100')
  })

  it('entende variações do padrão e ordena de forma natural', () => {
    expect(numeroDaIdentificacao('P-07', 'P')).toBe(7)
    expect(numeroDaIdentificacao(' p 12 ', 'P')).toBe(12)
    expect(numeroDaIdentificacao('G-03', 'P')).toBeNull()
    expect(numeroDaIdentificacao('Máquina 01', 'P')).toBeNull()
    expect(ordenarMaquinas([maq('G-01'), maq('P-10'), maq('P-2')]).map((m) => m.identificacao)).toEqual(['P-2', 'P-10', 'G-01'])
  })

  it('continua a numeração existente sem repetir identificações', () => {
    const lista = [maq('P-01'), maq('P-07', { status: 'DESATIVADA' }), maq('Reserva'), maq('G-02')]
    expect(proximasIdentificacoes(lista, 'P', 2)).toEqual(['P-08', 'P-09'])
    expect(proximasIdentificacoes(lista, 'G', 1)).toEqual(['G-03'])
    expect(proximasIdentificacoes([], 'G', 3)).toEqual(['G-01', 'G-02', 'G-03'])
  })
})

describe('situação da máquina', () => {
  const hoje = '2026-10-02'
  const eventos = [
    ev('passado', ['2026-09-01'], ['P-01']),
    ev('agora', ['2026-10-01', '2026-10-02', '2026-10-03'], ['P-01'], { cabecalho: '\n  FESTA DA PRIMAVERA \nESCOLA' }),
    ev('depois', ['2026-10-20'], ['P-01', 'P-02']),
    ev('cancelado', ['2026-10-02'], ['P-02'], { status: 'CANCELADO' }),
  ]

  it('locada quando um evento em andamento inclui hoje, com o local vindo do nome do evento', () => {
    const s = situacaoMaquina(maq('P-01'), eventos, hoje)
    expect(s.estado).toBe('LOCADA')
    expect(s.evento?.id).toBe('agora')
    expect(s.proxima?.id).toBe('depois')
    expect(localDaLocacao(s.evento!)).toBe('Evento agora')
    expect(cabecalhoEmLinha(s.evento!)).toBe('Evento agora')
    expect(localDaLocacao(ev('x', [], [], { nome: 'Quermesse' }))).toBe('Quermesse')
    expect(s.dataProxima).toBe('2026-10-20')
  })

  it('conta só os dias do evento: nos dias de intervalo a máquina está livre', () => {
    const domingos = [ev('domingos', ['2026-09-27', '2026-10-04'], ['P-09'])]
    expect(situacaoMaquina(maq('P-09'), domingos, '2026-10-01')).toMatchObject({
      estado: 'DISPONIVEL',
      proxima: { id: 'domingos' },
      dataProxima: '2026-10-04',
    })
    expect(situacaoMaquina(maq('P-09'), domingos, '2026-10-04').estado).toBe('LOCADA')
  })

  it('eventos cancelados não contam; manutenção e desativada valem o cadastro', () => {
    expect(situacaoMaquina(maq('P-02'), eventos, hoje)).toMatchObject({ estado: 'DISPONIVEL', proxima: { id: 'depois' } })
    expect(situacaoMaquina(maq('P-01', { status: 'MANUTENCAO' }), eventos, hoje).estado).toBe('MANUTENCAO')
    expect(situacaoMaquina(maq('P-01', { status: 'DESATIVADA' }), eventos, hoje)).toEqual({ estado: 'DESATIVADA' })
  })

  it('aponta conflitos de máquina entre eventos nas mesmas datas', () => {
    const novo = { id: 'novo', dias: [{ id: 'a', data: '2026-10-03', maquinas: 2 }], maquinasIds: ['P-01', 'P-02'] }
    const conflitos = conflitosMaquinas(novo, eventos)
    expect([...conflitos.keys()]).toEqual(['P-01'])
    expect(conflitos.get('P-01')!.map((e) => e.id)).toEqual(['agora'])
    expect([...maquinasOcupadas(['2026-10-20'], eventos).keys()]).toEqual(['P-01', 'P-02'])
    expect(maquinasOcupadas(['2026-10-20'], eventos, 'depois').size).toBe(0)
  })
})

describe('capacidade e ajuste de quantidade', () => {
  it('sem máquinas cadastradas usa a quantidade das configurações', () => {
    expect(capacidade([], { frotaMaquinas: 10 })).toEqual({ P: 0, G: 0, total: 10, manutencao: 0, cadastradas: false })
    const lista = [maq('P-01'), maq('P-02', { status: 'MANUTENCAO' }), maq('P-03', { status: 'DESATIVADA' }), maq('G-01')]
    expect(capacidade(lista, { frotaMaquinas: 10 })).toEqual({ P: 2, G: 1, total: 3, manutencao: 1, cadastradas: true })
  })

  it('planeja a retirada: apaga sem histórico, desativa com histórico, preserva as ocupadas', () => {
    const lista = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05'].map((i) => maq(i))
    lista[1].status = 'MANUTENCAO'
    const eventos = [ev('antigo', ['2026-01-01'], ['P-04']), ev('futuro', ['2026-12-01'], ['P-05'])]
    const ordens = [{ maquinaId: 'P-03' } as OrdemServico]
    const plano = planoAjuste(lista, eventos, ordens, 'P', 2, '2026-10-02')
    // sobram 3; P-05 tem evento futuro e P-02 está em manutenção: saem P-04 (desativa), P-03 (desativa), P-01 (apaga)
    expect(plano.desativar.map((m) => m.id)).toEqual(['P-04', 'P-03'])
    expect(plano.excluir.map((m) => m.id)).toEqual(['P-01'])
    expect(plano.faltam).toBe(0)
    const zero = planoAjuste(lista, eventos, ordens, 'P', 0, '2026-10-02')
    expect(zero.faltam).toBe(2)
    expect(zero.presas.manutencao.map((m) => m.id)).toEqual(['P-02'])
    expect(zero.presas.eventos.map((m) => m.id)).toEqual(['P-05'])
    expect(planoAjuste(lista, eventos, ordens, 'P', 7, '2026-10-02').criar).toEqual(['P-06', 'P-07'])
  })
})

describe('validação', () => {
  it('evento: cabeçalho antigo vira observação e máquinas sem repetição', () => {
    const { valor } = normalizarEvento({ nome: 'Festa', cabecalho: ' LINHA 1\r\nLINHA 2 ', maquinasIds: ['a', 'a', '', 'b', 3] })
    // O nome é o topo das fichas: o cabeçalho antigo vai para as observações
    expect(valor.cabecalho).toBe('')
    expect(valor.observacoes).toBe('Cabeçalho das fichas: LINHA 1 / LINHA 2')
    expect(valor.maquinasIds).toEqual(['a', 'b', '3'])
    expect(valor).toMatchObject({ periodoCorrido: false, programacao: 'NAO_INICIADA' })
  })

  it('O.S.: conclusão só quando concluída, serviços sem repetição', () => {
    const aberta = normalizarOS({ maquinaId: 'm', status: 'ABERTA', conclusao: '2026-10-01', servicos: ['A', 'a', ' B '] })
    expect(aberta.valor).toMatchObject({ conclusao: '', servicos: ['A', 'B'] })
    expect(aberta.erros).toEqual([])
    expect(normalizarOS({ maquinaId: 'm' }).erros).toContain('Marque pelo menos um serviço ou descreva o problema.')
    expect(normalizarOS({ problema: 'x' }).erros).toContain('Selecione a máquina.')
  })

  it('backup: identificação repetida ganha sufixo, O.S. sem máquina é recusada, números ficam únicos', () => {
    const base = { app: 'bc-fichas-control', clientes: [{ id: 'c', tipo: 'AVULSO', nome: 'X' }] }
    const b = validarBackup({
      ...base,
      maquinas: [maq('P-01'), { ...maq('p-01'), id: 'outra' }],
      eventos: [{ ...ev('e', ['2026-01-01'], ['P-01', 'sumiu']), clienteId: 'c' }],
      ordens: [
        { id: 'o1', numero: 3, maquinaId: 'P-01', problema: 'x' },
        { id: 'o2', numero: 3, maquinaId: 'outra', problema: 'y' },
      ],
    })
    expect(b.maquinas.map((m) => m.identificacao)).toEqual(['P-01', 'p-01 (duplicada 2)'])
    expect(b.eventos[0].maquinasIds).toEqual(['P-01'])
    expect(b.ordens.map((o) => o.numero).sort()).toEqual([3, 4])
    expect(b.proximaOS).toBe(5)
    expect(() => validarBackup({ ...base, eventos: [], ordens: [{ id: 'o', maquinaId: 'nada', problema: 'x' }] })).toThrow(
      /sem máquina correspondente/,
    )
  })
})

describe('período corrido (as máquinas ficam com o cliente entre os dias de uso)', () => {
  const fds = ['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11']

  it('sem período corrido, só os dias de uso; com, todos os dias do primeiro ao último com a maior quantidade', () => {
    const e = { dias: fds.map((data, i) => ({ data, maquinas: i === 1 ? 5 : 3 })) }
    expect(diasOcupados(e)).toEqual(fds.map((data, i) => ({ data, maquinas: i === 1 ? 5 : 3, uso: true })))
    const corrido = diasOcupados({ ...e, periodoCorrido: true })
    expect(corrido).toHaveLength(9)
    expect(corrido.every((d) => d.maquinas === 5)).toBe(true)
    expect(corrido.filter((d) => d.uso).map((d) => d.data)).toEqual(fds)
    expect(corrido[2]).toEqual({ data: '2026-10-05', maquinas: 5, uso: false })
    // Virada de mês e um só dia
    expect(datasOcupadas({ dias: [{ data: '2026-10-30' }, { data: '2026-11-02' }], periodoCorrido: true })).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(datasOcupadas({ dias: [{ data: '2026-10-30' }], periodoCorrido: true })).toEqual(['2026-10-30'])
  })

  it('situação, conflitos e ocupação por dia contam os dias do meio', () => {
    const feira = ev('feira', fds, ['P-01'], { periodoCorrido: true })
    // Quarta-feira entre os fins de semana: locada, com o cliente
    expect(situacaoMaquina(maq('P-01'), [feira], '2026-10-07')).toMatchObject({ estado: 'LOCADA', evento: { id: 'feira' } })
    expect(situacaoMaquina(maq('P-01'), [{ ...feira, periodoCorrido: false }], '2026-10-07').estado).toBe('DISPONIVEL')
    const meio = { id: 'meio', dias: [{ id: 'x', data: '2026-10-07', maquinas: 1 }], maquinasIds: ['P-01'] }
    expect([...conflitosMaquinas(meio, [feira]).keys()]).toEqual(['P-01'])
    expect([...maquinasOcupadas(['2026-10-08'], [feira]).keys()]).toEqual(['P-01'])
    expect(ocupacaoPorDia([feira]).get('2026-10-06')).toBe(1)
    expect(ocupacaoPorDia([{ ...feira, periodoCorrido: false }]).get('2026-10-06')).toBeUndefined()
  })

  it('programação padrão dos eventos antigos: concluída no passado, não iniciada no futuro', () => {
    expect(programacaoPadrao(ev('a', ['2026-09-01'], []), '2026-10-02')).toBe('CONCLUIDA')
    expect(programacaoPadrao(ev('a', ['2026-11-01'], []), '2026-10-02')).toBe('NAO_INICIADA')
    // Cancelado que ainda vai acontecer pode ser reativado: a programação continua por fazer
    expect(programacaoPadrao(ev('a', ['2026-11-01'], [], { status: 'CANCELADO' }), '2026-10-02')).toBe('NAO_INICIADA')
    expect(programacaoPadrao(ev('a', ['2026-09-01'], [], { status: 'CANCELADO' }), '2026-10-02')).toBe('CONCLUIDA')
  })
})
