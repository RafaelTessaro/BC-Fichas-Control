import { describe, expect, it } from 'vitest'
import type { Cliente, Evento } from '#shared/tipos.ts'
import {
  AVISO_FINAL,
  blocosDeDatas,
  diaSeguinte,
  hashConteudo,
  hashEventoGoogle,
  idGoogle,
  montarEventosGoogle,
} from './mapeamento.ts'

const ID_VALIDO = /^[a-v0-9]{5,1024}$/

const cliente = { id: 'c1', nome: 'Padaria Ideal', telefone: '(19) 99876-5432' } as Cliente

const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: '3f2a9c4e-8b1d-4e6f-9a7c-0d1e2f3a4b5c',
  versao: 1,
  codigo: 7,
  clienteId: 'c1',
  nome: 'Festa do Peão',
  cidade: 'Rio Claro',
  cabecalho: '',
  dias: [
    { id: 'd3', data: '2026-08-05', maquinas: 4 },
    { id: 'd1', data: '2026-08-01', maquinas: 2 },
    { id: 'd2', data: '2026-08-02', maquinas: 3 },
  ],
  maquinasIds: [],
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 50,
  bobinasDevolvidas: 10,
  desconto: 0,
  formaPagamento: 'PIX',
  dataPagamento: '2026-08-06',
  status: 'EM_ABERTO',
  rodape: '',
  observacoes: 'Observação interna',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

describe('blocos de datas', () => {
  it('agrupa dias consecutivos e separa os não consecutivos', () => {
    const blocos = blocosDeDatas(evento().dias)
    expect(blocos.map((b) => [b.inicio, b.fim])).toEqual([
      ['2026-08-01', '2026-08-02'],
      ['2026-08-05', '2026-08-05'],
    ])
  })

  it('atravessa virada de mês e de ano e soma datas repetidas', () => {
    const blocos = blocosDeDatas([
      { id: 'a', data: '2026-12-31', maquinas: 1 },
      { id: 'b', data: '2027-01-01', maquinas: 2 },
      { id: 'c', data: '2027-01-01', maquinas: 1 },
      { id: 'd', data: '', maquinas: 5 },
    ])
    expect(blocos).toEqual([
      {
        inicio: '2026-12-31',
        fim: '2027-01-01',
        dias: [
          { data: '2026-12-31', maquinas: 1 },
          { data: '2027-01-01', maquinas: 3 },
        ],
      },
    ])
  })

  it('calcula o fim exclusivo em UTC (sem efeito do fuso ou horário de verão)', () => {
    expect(diaSeguinte('2026-02-28')).toBe('2026-03-01')
    expect(diaSeguinte('2028-02-28')).toBe('2028-02-29')
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01')
    expect(diaSeguinte('2026-10-17')).toBe('2026-10-18')
  })
})

describe('ids no Google', () => {
  it('são válidos, determinísticos e diferentes por bloco', () => {
    const a = idGoogle('3f2a9c4e-8b1d-4e6f-9a7c-0d1e2f3a4b5c', 0)
    expect(a).toMatch(ID_VALIDO)
    expect(a).toBe(idGoogle('3F2A9C4E-8B1D-4E6F-9A7C-0D1E2F3A4B5C', 0))
    expect(idGoogle('3f2a9c4e-8b1d-4e6f-9a7c-0d1e2f3a4b5c', 1)).not.toBe(a)
  })

  it('convertem ids antigos ou com caracteres fora do padrão', () => {
    for (const id of ['e1', 'XYZ-Wz', 'evento com espaço e acentuação', 'x'.repeat(2000)]) {
      expect(idGoogle(id, 3)).toMatch(ID_VALIDO)
    }
    expect(idGoogle('e1', 0)).not.toBe(idGoogle('e2', 0))
  })
})

describe('conteúdo enviado ao Google', () => {
  it('gera um evento de dia inteiro por bloco com título, local, cor e propriedades', () => {
    const [b1, b2] = montarEventosGoogle(evento(), cliente, { incluirValores: false })
    expect(b1).toMatchObject({
      summary: 'Festa do Peão — Padaria Ideal (2–3 máquinas)',
      location: 'Rio Claro',
      start: { date: '2026-08-01' },
      end: { date: '2026-08-03' },
      colorId: '9',
      status: 'confirmed',
      extendedProperties: { private: { bcFichasId: evento().id, codigo: '#0007' } },
    })
    expect(b2).toMatchObject({
      summary: 'Festa do Peão — Padaria Ideal (4 máquinas)',
      start: { date: '2026-08-05' },
      end: { date: '2026-08-06' },
    })
    expect(b1.id).toMatch(ID_VALIDO)
    expect(b1.id).not.toBe(b2.id)
  })

  it('descreve código, cliente, dias, bobinas, status e pagamento, sem valores por padrão', () => {
    const [b] = montarEventosGoogle(evento(), cliente, { incluirValores: false })
    const d = b.description
    expect(d).toContain('Evento #0007')
    expect(d).toContain('Cliente: Padaria Ideal')
    expect(d).toContain('Telefone: (19) 99876-5432')
    expect(d).toContain('01/08/2026 (sáb): 2 máquinas')
    expect(d).toContain('05/08/2026 (qua): 4 máquinas')
    expect(d).toContain('Bobinas consignadas: 50')
    expect(d).toContain('Status: Em aberto')
    expect(d).toContain('Pagamento: PIX')
    expect(d).not.toMatch(/R\$|Total/)
    expect(d).not.toContain('Observação interna')
    expect(d.trim().endsWith(AVISO_FINAL)).toBe(true)
  })

  it('inclui o total quando a opção está ligada', () => {
    // 9 diárias × 80 + 40 bobinas × 6 = 960
    const [b] = montarEventosGoogle(evento(), cliente, { incluirValores: true })
    expect(b.description).toMatch(/Total: R\$\s?960,00/)
  })

  it('usa cor por status e não envia eventos cancelados', () => {
    expect(montarEventosGoogle(evento({ status: 'FINALIZADO' }), cliente, { incluirValores: false })[0].colorId).toBe('10')
    expect(montarEventosGoogle(evento({ status: 'PENDENTE' }), cliente, { incluirValores: false })[0].colorId).toBe('5')
    expect(montarEventosGoogle(evento({ status: 'CANCELADO' }), cliente, { incluirValores: false })).toEqual([])
  })

  it('funciona sem cliente e muda o hash quando o conteúdo ou a agenda mudam', () => {
    const g = montarEventosGoogle(evento(), undefined, { incluirValores: false })
    expect(g[0].summary).toContain('Cliente removido')
    expect(hashConteudo('a', g)).toBe(hashConteudo('a', montarEventosGoogle(evento(), undefined, { incluirValores: false })))
    expect(hashConteudo('a', g)).not.toBe(hashConteudo('b', g))
    expect(hashConteudo('a', g)).not.toBe(
      hashConteudo('a', montarEventosGoogle(evento({ nome: 'Outro' }), undefined, { incluirValores: false })),
    )
  })
})

describe('impressão digital de cada evento do Google (bcHash)', () => {
  const montar = (extra: Partial<Evento> = {}, incluirValores = false) =>
    montarEventosGoogle(evento(extra), cliente, { incluirValores })

  it('vai em cada evento, é estável e corresponde ao conteúdo dele', () => {
    const [b1, b2] = montar()
    expect(b1.extendedProperties.private.bcHash).toMatch(/^[0-9a-f]{32}$/)
    expect(b1.extendedProperties.private.bcHash).toBe(hashEventoGoogle(b1))
    expect(b1.extendedProperties.private.bcHash).not.toBe(b2.extendedProperties.private.bcHash)
    expect(montar()[0].extendedProperties.private.bcHash).toBe(b1.extendedProperties.private.bcHash)
  })

  it('muda com nome, datas, status, cliente ou valores', () => {
    const base = montar()[0].extendedProperties.private.bcHash
    const variantes = [
      montar({ nome: 'Outro' }),
      montar({ dias: [{ id: 'd1', data: '2026-08-10', maquinas: 2 }] }),
      montar({ status: 'FINALIZADO' }),
      montarEventosGoogle(evento(), { ...cliente, nome: 'Padaria Nova' }, { incluirValores: false }),
      montar({}, true),
    ]
    for (const v of variantes) expect(v[0].extendedProperties.private.bcHash).not.toBe(base)
  })
})
