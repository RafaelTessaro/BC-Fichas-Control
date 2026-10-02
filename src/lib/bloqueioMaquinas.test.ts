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

  it('pede para trocar as acrescentadas e, num evento que ainda vai acontecer, também as que já estavam', () => {
    const outro = ev('a', 12, ['2026-10-11'], ['P-01'])
    const d = dias('2026-10-11')
    const b = bloqueiosMaquinas({ maquinas, eventos: [outro], clientes, dias: d, eventoId: 'e', hoje: HOJE })
    // Evento novo: qualquer marcada bloqueada
    expect(maquinasParaTrocar({ selecionadas: ['P-01', 'P-02', 'P-03'], bloqueios: b, dias: d, hoje: HOJE })).toEqual([
      'P-01',
      'P-03',
    ])
    // Já gravadas num evento futuro: também precisam ser trocadas
    const salvo = ev('e', 20, ['2026-10-11'], ['P-01', 'P-03'])
    expect(maquinasParaTrocar({ selecionadas: ['P-01', 'P-03'], bloqueios: b, dias: d, salvo, hoje: HOJE })).toEqual([
      'P-01',
      'P-03',
    ])
  })

  it('num evento que já passou, o que já estava gravado não trava; dia acrescentado com conflito trava', () => {
    const outro = ev('a', 12, ['2026-09-01', '2026-09-02'], ['P-01', 'G-02'])
    const salvo = ev('e', 20, ['2026-09-01'], ['P-01', 'G-01'])
    const mesmos = dias('2026-09-01')
    const b1 = bloqueiosMaquinas({ maquinas, eventos: [outro], clientes, dias: mesmos, eventoId: 'e', hoje: HOJE })
    expect(maquinasParaTrocar({ selecionadas: ['P-01', 'G-01'], bloqueios: b1, dias: mesmos, salvo, hoje: HOJE })).toEqual([])
    // G-02 acrescentada agora: trava
    expect(maquinasParaTrocar({ selecionadas: ['P-01', 'G-02'], bloqueios: b1, dias: mesmos, salvo, hoje: HOJE })).toEqual([
      'G-02',
    ])
    // Dia 02/09 acrescentado: P-01 passa a coincidir com o outro evento num dia novo
    const novos = dias('2026-09-01', '2026-09-02')
    const b2 = bloqueiosMaquinas({ maquinas, eventos: [outro], clientes, dias: novos, eventoId: 'e', hoje: HOJE })
    expect(maquinasParaTrocar({ selecionadas: ['P-01'], bloqueios: b2, dias: novos, salvo, hoje: HOJE })).toEqual(['P-01'])
    // Evento gravado como cancelado: tudo conta como acrescentado
    const cancelado = { ...salvo, status: 'CANCELADO' as const }
    expect(maquinasParaTrocar({ selecionadas: ['P-01'], bloqueios: b1, dias: mesmos, salvo: cancelado, hoje: HOJE })).toEqual([
      'P-01',
    ])
  })
})
