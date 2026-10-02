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
