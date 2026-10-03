import { describe, expect, it } from 'vitest'
import { CLIENTE_VAZIO } from '#shared/dominio.ts'
import type { Cliente, Evento, Maquina } from '#shared/tipos.ts'
import {
  agruparBloqueios,
  bloqueiosMaquinas,
  fraseBloqueio,
  listaDatas,
  maquinasParaTrocar,
  resumoTrocas,
  trocasMaquinas,
} from './bloqueioMaquinas'

const HOJE = '2026-10-02'

const maq = (identificacao: string, extra: Partial<Maquina> = {}): Maquina => ({
  id: identificacao,
  versao: 1,
  tipo: identificacao.startsWith('G') ? 'G' : 'P',
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

const cli = (id: string, nome: string): Cliente => ({ ...CLIENTE_VAZIO, id, nome, versao: 1, criadoEm: '', atualizadoEm: '' })

const ev = (id: string, codigo: number, datas: string[], maquinasIds: string[], extra: Partial<Evento> = {}): Evento => ({
  id,
  versao: 1,
  codigo,
  clienteId: 'c1',
  nome: `Festa ${id}`,
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: datas.map((data, i) => ({ id: `${id}${i}`, data, maquinas: 1, reservas: 0, reservasUsadas: 0 })),
  maquinasIds,
  reservasIds: [],
  grupoId: '',
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

const maquinas = [
  maq('P-01'),
  maq('P-02'),
  maq('P-03', { status: 'MANUTENCAO' }),
  maq('G-01', { status: 'DESATIVADA' }),
  maq('G-02'),
]
const clientes = [cli('c1', 'Clube Primavera')]
const dias = (...datas: string[]) => datas.map((data) => ({ data }))

describe('máquinas bloqueadas no evento', () => {
  it('lista datas curtas de forma natural', () => {
    expect(listaDatas(['2026-10-11'])).toBe('11/10')
    expect(listaDatas(['2026-10-12', '2026-10-11'])).toBe('11/10 e 12/10')
    expect(listaDatas(['2026-10-11', '2026-10-12', '2026-10-13'])).toBe('11/10, 12/10 e 13/10')
    expect(listaDatas(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'])).toBe(
      '11/10, 12/10, 13/10 e mais 2 dias',
    )
  })

  it('bloqueia desativada, em manutenção (de hoje em diante) e ocupada em outro evento, dizendo onde', () => {
    const eventos = [
      ev('a', 12, ['2026-10-11', '2026-10-12'], ['P-01']),
      ev('b', 13, ['2026-10-11'], ['P-02'], { status: 'CANCELADO' }),
      ev('c', 14, ['2026-10-20'], ['G-02']),
    ]
    const b = bloqueiosMaquinas({ maquinas, eventos, clientes, dias: dias('2026-10-11'), hoje: HOJE })
    expect([...b.keys()].sort()).toEqual(['G-01', 'P-01', 'P-03'])
    expect(b.get('P-01')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 11/10')
    expect(b.get('P-03')?.texto).toBe('Em manutenção')
    expect(b.get('G-01')?.motivo).toBe('DESATIVADA')
    expect(fraseBloqueio('P-01', b.get('P-01')!)).toBe('P-01 já está no evento #0012 Festa a — Clube Primavera, em 11/10')
    expect(fraseBloqueio('P-03', b.get('P-03')!)).toBe('P-03 está em manutenção')
  })

  it('não conta o próprio evento, nem manutenção num evento que já passou, nem nada num evento cancelado', () => {
    const eventos = [ev('a', 12, ['2026-09-01'], ['P-01'])]
    const passado = bloqueiosMaquinas({ maquinas, eventos, clientes, dias: dias('2026-09-01'), eventoId: 'a', hoje: HOJE })
    expect(passado.has('P-01')).toBe(false)
    expect(passado.has('P-03')).toBe(false)
    const cancelado = bloqueiosMaquinas({ maquinas, eventos, clientes, dias: dias('2026-09-01'), cancelado: true, hoje: HOJE })
    expect(cancelado.size).toBe(0)
  })

  it('resume as trocas uma vez por motivo, no plural quando são várias', () => {
    const eventos = [ev('a', 36, ['2026-10-02'], ['P-01', 'P-02', 'G-02'])]
    const b = bloqueiosMaquinas({ maquinas, eventos, clientes, dias: dias('2026-10-02'), hoje: HOJE })
    const itens = ['P-01', 'P-02', 'P-03', 'G-01', 'G-02'].map((x) => ({ identificacao: x, bloqueio: b.get(x)! }))
    expect(resumoTrocas(itens)).toBe(
      'P-01, P-02 e G-02 já estão no evento #0036 Festa a — Clube Primavera, em 02/10; P-03 está em manutenção; G-01 está desativada',
    )
  })

  it('agrupa por evento e junta as em manutenção', () => {
    const eventos = [ev('a', 12, ['2026-10-11'], ['P-01', 'P-02']), ev('x', 15, ['2026-10-11'], ['G-02'])]
    const d = dias('2026-10-11')
    const b = bloqueiosMaquinas({ maquinas, eventos, clientes, dias: d, hoje: HOJE })
    const grupos = agruparBloqueios(maquinas, b, clientes, d)
    expect(grupos.map((g) => [g.titulo, g.maquinas.map((m) => m.identificacao)])).toEqual([
      ['#0012 Festa a — Clube Primavera, em 11/10', ['P-01', 'P-02']],
      ['#0015 Festa x — Clube Primavera, em 11/10', ['G-02']],
      ['Em manutenção', ['P-03']],
    ])
  })

  // Atalho: todas as máquinas e eventos do teste, evento em edição 'e'
  const trocar = (selecionadas: string[], eventos: Evento[], d: { data: string }[], extra = {}) =>
    maquinasParaTrocar({ selecionadas, maquinas, eventos, dias: d, eventoId: 'e', hoje: HOJE, ...extra })

  it('evento novo: troca toda marcada desativada, em manutenção ou em outro evento', () => {
    const outro = ev('a', 12, ['2026-10-11'], ['P-01'])
    expect(trocar(['P-01', 'P-02', 'P-03', 'G-01'], [outro], dias('2026-10-11'))).toEqual(['P-01', 'P-03', 'G-01'])
    // Cancelado não cobra nada
    expect(trocar(['P-01', 'P-03', 'G-01'], [outro], dias('2026-10-11'), { cancelado: true })).toEqual([])
    // Num evento novo que já passou, a manutenção não conta (a desativada e o conflito sim)
    const antigo = ev('a', 12, ['2026-09-01'], ['P-01'])
    expect(trocar(['P-01', 'P-03', 'G-01'], [antigo], dias('2026-09-01'))).toEqual(['P-01', 'G-01'])
  })

  it('o que já estava gravado não trava a edição, mesmo num evento que ainda vai acontecer', () => {
    // P-01 entrou em outro evento e P-03 entrou em manutenção depois de gravadas aqui
    const outro = ev('a', 12, ['2026-10-11'], ['P-01'])
    const salvo = ev('e', 20, ['2026-10-11'], ['P-01', 'P-03'])
    expect(trocar(['P-01', 'P-03'], [outro, salvo], dias('2026-10-11'), { salvo })).toEqual([])
    // Mas acrescentar um dia de hoje em diante cobra as duas nesse dia
    const outro2 = ev('a', 12, ['2026-10-11', '2026-10-12'], ['P-01'])
    expect(trocar(['P-01', 'P-03'], [outro2, salvo], dias('2026-10-11', '2026-10-12'), { salvo })).toEqual(['P-01', 'P-03'])
    // Dia novo sem conflito: P-01 passa; P-03 (manutenção) continua cobrada, o dia é futuro
    expect(trocar(['P-01', 'P-03'], [outro, salvo], dias('2026-10-11', '2026-10-13'), { salvo })).toEqual(['P-03'])
  })

  it('num evento que já passou, o que já estava gravado não trava; dia acrescentado com conflito trava', () => {
    const outro = ev('a', 12, ['2026-09-01', '2026-09-02'], ['P-01', 'G-02'])
    const salvo = ev('e', 20, ['2026-09-01'], ['P-01', 'G-01'])
    const mesmos = dias('2026-09-01')
    // G-01 está desativada, mas já estava gravada num evento que passou: é histórico
    expect(trocar(['P-01', 'G-01'], [outro], mesmos, { salvo })).toEqual([])
    // G-02 acrescentada agora: trava
    expect(trocar(['P-01', 'G-02'], [outro], mesmos, { salvo })).toEqual(['G-02'])
    // Dia 02/09 acrescentado: P-01 passa a coincidir com o outro evento num dia novo; G-01 (passado) fica
    expect(trocar(['P-01', 'G-01'], [outro], dias('2026-09-01', '2026-09-02'), { salvo })).toEqual(['P-01'])
  })

  it('evento gravado como cancelado: ao reativar, tudo conta como acrescentado (menos a desativada que já estava)', () => {
    const outro = ev('a', 12, ['2026-09-01'], ['P-01'])
    const salvo = ev('e', 20, ['2026-09-01'], ['P-01', 'G-01'], { status: 'CANCELADO' })
    expect(trocar(['P-01', 'G-01'], [outro], dias('2026-09-01'), { salvo })).toEqual(['P-01'])
    // Num evento futuro a desativada volta a ser cobrada
    const futuro = ev('e', 20, ['2026-10-11'], ['G-01'], { status: 'CANCELADO' })
    expect(trocar(['G-01'], [], dias('2026-10-11'), { salvo: futuro })).toEqual(['G-01'])
  })

  it('o motivo da troca é o que de fato a impede (e cita só os dias acrescentados)', () => {
    // P-01 já estava gravada e depois foi desativada; o dia acrescentado (passado) bate com outro evento
    const outro = ev('a', 12, ['2026-09-29'], ['P-01'])
    const desat = [maq('P-01', { status: 'DESATIVADA' })]
    const salvo = ev('e', 20, ['2026-10-01'], ['P-01'])
    const t = trocasMaquinas({
      selecionadas: ['P-01'],
      maquinas: desat,
      eventos: [outro],
      clientes,
      dias: dias('2026-09-29', '2026-10-01'),
      eventoId: 'e',
      salvo,
      hoje: HOJE,
    })
    expect(t.get('P-01')).toMatchObject({ motivo: 'OCUPADA', texto: 'No evento #0012 Festa a — Clube Primavera, em 29/09' })
    // Em manutenção, gravada num dia futuro, com dia passado acrescentado em conflito: também é o conflito
    const manut = [maq('P-01', { status: 'MANUTENCAO' })]
    const salvoFuturo = ev('e', 20, ['2026-10-03'], ['P-01'])
    const t2 = trocasMaquinas({
      selecionadas: ['P-01'],
      maquinas: manut,
      eventos: [outro],
      clientes,
      dias: dias('2026-09-29', '2026-10-03'),
      eventoId: 'e',
      salvo: salvoFuturo,
      hoje: HOJE,
    })
    expect(t2.get('P-01')?.motivo).toBe('OCUPADA')
    // Conflito antigo em 03/10 já aceito; 04/10 acrescentado: o texto cita só 04/10
    const antigo = ev('a', 12, ['2026-10-03', '2026-10-04'], ['P-01'])
    const t3 = trocasMaquinas({
      selecionadas: ['P-01'],
      maquinas: [maq('P-01')],
      eventos: [antigo],
      clientes,
      dias: dias('2026-10-03', '2026-10-04'),
      eventoId: 'e',
      salvo: salvoFuturo,
      hoje: HOJE,
    })
    expect(t3.get('P-01')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 04/10')
  })
})

// A reserva também prende a máquina (está com o cliente); o texto diz que ela foi como reserva,
// como o servidor ("A máquina P-01 já está como reserva no evento …")
describe('máquina que está como reserva no outro evento', () => {
  const comReserva = (extra: Partial<Evento> = {}) =>
    ev('a', 12, ['2026-10-11'], ['P-01', 'P-02'], { reservasIds: ['P-02'], ...extra })

  it('bloqueia a reserva como a titular, dizendo que ela está como reserva', () => {
    const b = bloqueiosMaquinas({ maquinas, eventos: [comReserva()], clientes, dias: dias('2026-10-11'), hoje: HOJE })
    expect(b.get('P-01')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 11/10')
    expect(b.get('P-02')).toMatchObject({
      motivo: 'OCUPADA',
      texto: 'Como reserva no evento #0012 Festa a — Clube Primavera, em 11/10',
    })
    expect(fraseBloqueio('P-02', b.get('P-02')!)).toBe(
      'P-02 já está como reserva no evento #0012 Festa a — Clube Primavera, em 11/10',
    )
  })

  it('no resumo da troca, a reserva fica separada da titular do mesmo evento', () => {
    const trocas = trocasMaquinas({
      selecionadas: ['P-01', 'P-02'],
      maquinas,
      eventos: [comReserva()],
      clientes,
      dias: dias('2026-10-11'),
      eventoId: 'e',
      hoje: HOJE,
    })
    const itens = ['P-01', 'P-02'].map((x) => ({ identificacao: x, bloqueio: trocas.get(x)! }))
    expect(resumoTrocas(itens)).toBe(
      'P-01 já está no evento #0012 Festa a — Clube Primavera, em 11/10; P-02 já está como reserva no evento #0012 Festa a — Clube Primavera, em 11/10',
    )
  })

  it('em vários eventos, marca em qual deles ela é reserva', () => {
    const outro = ev('x', 15, ['2026-10-11'], ['P-02'])
    const b = bloqueiosMaquinas({
      maquinas,
      eventos: [comReserva(), outro],
      clientes,
      dias: dias('2026-10-11'),
      hoje: HOJE,
    })
    expect(b.get('P-02')?.texto).toBe(
      'Nos eventos #0012 Festa a — Clube Primavera (como reserva), em 11/10; #0015 Festa x — Clube Primavera, em 11/10',
    )
    expect(fraseBloqueio('P-02', b.get('P-02')!)).toMatch(
      /^P-02 já está nos eventos #0012 Festa a — Clube Primavera \(como reserva\)/,
    )
  })

  it('o agrupamento das indisponíveis diz quais são reserva no outro evento', () => {
    const d = dias('2026-10-11')
    const b = bloqueiosMaquinas({ maquinas, eventos: [comReserva()], clientes, dias: d, hoje: HOJE })
    const [grupo] = agruparBloqueios(maquinas, b, clientes, d)
    expect(grupo.maquinas.map((m) => m.identificacao)).toEqual(['P-01', 'P-02'])
    expect(grupo.reservas).toEqual(['P-02'])
  })

  it('evento antigo sem reservasIds continua funcionando', () => {
    const antigo = { ...ev('a', 12, ['2026-10-11'], ['P-01']), reservasIds: undefined } as unknown as Evento
    const b = bloqueiosMaquinas({ maquinas, eventos: [antigo], clientes, dias: dias('2026-10-11'), hoje: HOJE })
    expect(b.get('P-01')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 11/10')
  })
})

// As mesmas situações de server/novidades23.test.ts ("com período corrido, a máquina fica presa
// também nos dias do meio"), para a tela recusar exatamente o que o servidor recusa.
describe('período corrido (as máquinas ficam com o cliente entre os dias de uso)', () => {
  // Feira nos fins de semana de 03/10 e 10/10; em período corrido, ocupa de 03/10 a 11/10
  const feira = (extra: Partial<Evento> = {}) =>
    ev('f', 30, ['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11'], ['P-01'], { periodoCorrido: true, ...extra })
  const trocar = (selecionadas: string[], eventos: Evento[], d: { data: string }[], extra = {}) =>
    maquinasParaTrocar({ selecionadas, maquinas, eventos, dias: d, eventoId: 'e', hoje: HOJE, ...extra })

  it('a máquina fica presa nos dias do meio do outro evento (e livre depois do último dia)', () => {
    const b = bloqueiosMaquinas({ maquinas, eventos: [feira()], clientes, dias: dias('2026-10-07'), hoje: HOJE })
    expect(b.get('P-01')?.texto).toBe('No evento #0030 Festa f — Clube Primavera, em 07/10')
    expect(trocar(['P-01'], [feira()], dias('2026-10-07'))).toEqual(['P-01'])
    // Sem o período corrido, livre no meio da semana
    expect(
      bloqueiosMaquinas({
        maquinas,
        eventos: [feira({ periodoCorrido: false })],
        clientes,
        dias: dias('2026-10-07'),
        hoje: HOJE,
      }).has('P-01'),
    ).toBe(false)
    expect(trocar(['P-01'], [feira({ periodoCorrido: false })], dias('2026-10-07'))).toEqual([])
    // Depois do último dia (e antes do primeiro), livre
    expect(trocar(['P-01'], [feira()], dias('2026-10-12'))).toEqual([])
    expect(trocar(['P-01'], [feira()], dias('2026-10-02'))).toEqual([])
  })

  it('o evento com período corrido também não pode levar máquina presa no meio do período', () => {
    const outro = ev('a', 12, ['2026-10-07'], ['P-02'])
    const d = dias('2026-10-03', '2026-10-11')
    expect(trocar(['P-02'], [outro], d)).toEqual([])
    expect(trocar(['P-02'], [outro], d, { periodoCorrido: true })).toEqual(['P-02'])
    const b = bloqueiosMaquinas({ maquinas, eventos: [outro], clientes, dias: d, periodoCorrido: true, hoje: HOJE })
    expect(b.get('P-02')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 07/10')
    // O resumo das indisponíveis cita o dia do meio
    expect(agruparBloqueios(maquinas, b, clientes, d, true).map((g) => g.titulo)).toEqual([
      '#0012 Festa a — Clube Primavera, em 07/10',
      'Em manutenção',
    ])
  })

  it('ligar o período corrido num evento gravado cobra só os dias acrescentados (os do meio)', () => {
    const d = dias('2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11')
    const salvo = feira({ id: 'e', periodoCorrido: false, maquinasIds: ['P-01', 'P-03'] })
    const meio = ev('a', 12, ['2026-10-08'], ['P-01'])
    // Como estava: nada a trocar (P-03 entrou em manutenção depois de gravada)
    expect(trocar(['P-01', 'P-03'], [meio, salvo], d, { salvo })).toEqual([])
    // Ligando: 05/10 a 09/10 entram; P-01 está em outro evento em 08/10 e P-03 em manutenção
    const t = trocasMaquinas({
      selecionadas: ['P-01', 'P-03'],
      maquinas,
      eventos: [meio, salvo],
      clientes,
      dias: d,
      periodoCorrido: true,
      eventoId: 'e',
      salvo,
      hoje: HOJE,
    })
    expect(t.get('P-01')?.texto).toBe('No evento #0012 Festa a — Clube Primavera, em 08/10')
    expect(t.get('P-03')?.motivo).toBe('MANUTENCAO')
    // Já gravado com período corrido: manter não cobra nada; desligar também não (só tira dias)
    const corrido = { ...salvo, periodoCorrido: true }
    expect(trocar(['P-01', 'P-03'], [corrido], d, { salvo: corrido, periodoCorrido: true })).toEqual([])
    expect(trocar(['P-01', 'P-03'], [meio, corrido], d, { salvo: corrido })).toEqual([])
  })

  it('num evento que já passou, ligar o período corrido só trava conflito nos dias do meio', () => {
    const d = dias('2026-09-05', '2026-09-12')
    const salvo = ev('e', 20, ['2026-09-05', '2026-09-12'], ['P-01', 'P-03'])
    const meio = ev('a', 12, ['2026-09-08'], ['P-01'])
    // P-03 em manutenção não conta (os dias acrescentados já passaram); P-01 em outro evento no meio, sim
    expect(trocar(['P-01', 'P-03'], [meio], d, { salvo, periodoCorrido: true })).toEqual(['P-01'])
    expect(trocar(['P-01', 'P-03'], [], d, { salvo, periodoCorrido: true })).toEqual([])
  })
})
