import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backup, Cliente, DadosCompletos, Evento, Maquina } from '#shared/tipos.ts'
import { criarApp } from './app.ts'

const H = { 'x-bc-fichas': '1' }

let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-24-'))
  ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null }))
})

afterEach(async () => {
  await app.close()
  rmSync(pasta, { recursive: true, force: true })
})

async function req<T = unknown>(method: string, url: string, payload?: unknown, esperado?: number) {
  const r = await app.inject({ method: method as 'GET', url, headers: H, payload: payload as object })
  if (esperado !== undefined) expect(r.statusCode, r.body).toBe(esperado)
  return { status: r.statusCode, json: (r.body ? r.json() : undefined) as T }
}

const dados = async () => (await req<DadosCompletos>('GET', '/api/dados')).json
const criarCliente = async (nome = 'Paróquia') =>
  (await req<Cliente>('POST', '/api/clientes', { tipo: 'AVULSO', nome }, 201)).json
const criarMaquina = async (identificacao: string) =>
  (await req<Maquina>('POST', '/api/maquinas', { tipo: identificacao[0], identificacao }, 201)).json
const dia = (data: string, maquinas: number, reservas = 0, reservasUsadas = 0) => ({
  id: data,
  data,
  maquinas,
  reservas,
  reservasUsadas,
})
const evento = (clienteId: string, extra: object = {}) => ({
  clienteId,
  nome: 'Quermesse',
  dias: [dia('2099-06-12', 3, 1), dia('2099-06-13', 3, 1, 1)],
  valorDiaria: 50,
  status: 'EM_ABERTO',
  ...extra,
})

describe('máquina reserva', () => {
  it('grava as reservas por dia e quais máquinas vão como reserva (sempre entre as enviadas)', async () => {
    const cli = await criarCliente()
    const [p1, p2, p3, p4] = await Promise.all(['P-01', 'P-02', 'P-03', 'P-04'].map(criarMaquina))
    const e = (
      await req<Evento>(
        'POST',
        '/api/eventos',
        evento(cli.id, {
          maquinasIds: [p1.id, p2.id, p3.id, p4.id],
          // P-05 não foi enviada: não pode ser reserva
          reservasIds: [p4.id, 'nao-enviada'],
          dias: [dia('2099-06-12', 3, 1), dia('2099-06-13', 3, 1, 5)],
        }),
        201,
      )
    ).json
    expect(e.reservasIds).toEqual([p4.id])
    expect(e.dias.map((d) => [d.maquinas, d.reservas, d.reservasUsadas])).toEqual([
      [3, 1, 0],
      // Não dá para usar mais reservas do que as que foram
      [3, 1, 1],
    ])
    expect(e.grupoId).toBe('')
    // Tirar a máquina do evento tira também da reserva
    const sem = (await req<Evento>('PUT', `/api/eventos/${e.id}`, { ...e, maquinasIds: [p1.id, p2.id, p3.id] }, 200)).json
    expect(sem.reservasIds).toEqual([])
  })

  it('a máquina reserva fica presa como as outras; a recusa diz que ela está como reserva', async () => {
    const cli = await criarCliente()
    const outro = await criarCliente('Escola')
    const p1 = await criarMaquina('P-01')
    const p2 = await criarMaquina('P-02')
    const e = (
      await req<Evento>('POST', '/api/eventos', evento(cli.id, { maquinasIds: [p1.id, p2.id], reservasIds: [p2.id] }), 201)
    ).json
    const r = await req<{ erro: string }>(
      'POST',
      '/api/eventos',
      evento(outro.id, { dias: [dia('2099-06-13', 1)], maquinasIds: [p2.id] }),
    )
    expect(r.status).toBe(409)
    expect(r.json.erro).toBe(
      `A máquina P-02 já está como reserva no evento #${String(e.codigo).padStart(4, '0')} Quermesse (Paróquia) em 13/06. Escolha outra máquina.`,
    )
  })

  it('duplicar não leva as máquinas nem o uso das reservas; o backup (versão 5) leva tudo', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (await req<Evento>('POST', '/api/eventos', evento(cli.id, { maquinasIds: [p1.id], reservasIds: [p1.id] }), 201))
      .json
    const copia = (await req<Evento>('POST', `/api/eventos/${e.id}/duplicar`, undefined, 201)).json
    expect(copia.dias.map((d) => [d.reservas, d.reservasUsadas])).toEqual([
      [1, 0],
      [1, 0],
    ])
    expect(copia.reservasIds).toEqual([])

    const backup = (await req<Backup>('GET', '/api/backup')).json
    expect(backup.versao).toBe(5)
    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    await req('POST', '/api/backup/restaurar', backup, 200)
    const volta = (await dados()).eventos.find((x) => x.id === e.id)!
    expect(volta.reservasIds).toEqual([p1.id])
    expect(volta.dias[1]).toMatchObject({ reservas: 1, reservasUsadas: 1 })
  })

  it('backup de uma versão anterior (sem reservas) é lido sem reservas', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', evento(cli.id), 201)).json
    const backup = (await req<Backup>('GET', '/api/backup')).json
    const antigo = {
      ...backup,
      versao: 4,
      eventos: backup.eventos.map(({ reservasIds: _r, grupoId: _g, ...x }) => ({
        ...x,
        dias: x.dias.map(({ reservas: _a, reservasUsadas: _b, ...d }) => d),
      })),
    }
    await req('POST', '/api/backup/restaurar', antigo, 200)
    const lido = (await dados()).eventos.find((x) => x.id === e.id)!
    expect(lido.reservasIds).toEqual([])
    expect(lido.grupoId).toBe('')
    expect(lido.dias.every((d) => d.reservas === 0 && d.reservasUsadas === 0)).toBe(true)
  })
})

describe('repetir em outras datas', () => {
  it('cria uma cópia por data, com o mesmo desenho de dias, sem máquinas, todas no grupo do original', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (
      await req<Evento>(
        'POST',
        '/api/eventos',
        evento(cli.id, {
          // Sexta a domingo, com reserva usada no sábado e já pago
          dias: [dia('2099-06-12', 3, 1), dia('2099-06-13', 4, 1, 1), dia('2099-06-14', 2)],
          maquinasIds: [p1.id],
          reservasIds: [p1.id],
          formaPagamento: 'PIX',
          dataPagamento: '2099-06-14',
          bobinasConsignadas: 50,
          bobinasDevolvidas: 10,
          status: 'FINALIZADO',
          programacao: 'CONCLUIDA',
        }),
        201,
      )
    ).json
    const r = (
      await req<{ original: Evento; criados: Evento[] }>(
        'POST',
        `/api/eventos/${e.id}/repetir`,
        { datas: ['2099-08-14', '2099-07-10'] },
        201,
      )
    ).json
    expect(r.criados.map((x) => x.dias.map((d) => d.data))).toEqual([
      ['2099-07-10', '2099-07-11', '2099-07-12'],
      ['2099-08-14', '2099-08-15', '2099-08-16'],
    ])
    const [julho] = r.criados
    expect(julho.dias.map((d) => [d.maquinas, d.reservas, d.reservasUsadas])).toEqual([
      [3, 1, 0],
      [4, 1, 0],
      [2, 0, 0],
    ])
    expect(julho).toMatchObject({
      nome: 'Quermesse',
      maquinasIds: [],
      reservasIds: [],
      formaPagamento: 'NAO_PAGO',
      dataPagamento: '',
      bobinasConsignadas: 50,
      bobinasDevolvidas: null,
      status: 'EM_ABERTO',
      programacao: 'NAO_INICIADA',
    })
    expect(r.criados[1].codigo).toBeGreaterThan(julho.codigo)
    // O original entra no grupo; as cópias também
    expect(r.original.grupoId).toBeTruthy()
    expect(r.original.versao).toBe(e.versao + 1)
    expect(r.criados.every((x) => x.grupoId === r.original.grupoId)).toBe(true)
    const todos = (await dados()).eventos
    expect(todos.filter((x) => x.grupoId === r.original.grupoId)).toHaveLength(3)

    // Repetir de novo a partir de uma cópia continua no mesmo grupo (o original não muda)
    const mais = (
      await req<{ original: Evento; criados: Evento[] }>(
        'POST',
        `/api/eventos/${julho.id}/repetir`,
        { datas: ['2099-09-11'] },
        201,
      )
    ).json
    expect(mais.criados[0].grupoId).toBe(r.original.grupoId)
    expect(mais.original.versao).toBe(julho.versao)
  })

  it('recusa sem datas, data inválida, repetida, a do próprio evento ou datas demais — e não cria nada', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', evento(cli.id), 201)).json
    const tentar = (datas: unknown) => req<{ erro: string }>('POST', `/api/eventos/${e.id}/repetir`, { datas })
    expect((await tentar([])).json.erro).toBe('Escolha pelo menos uma data.')
    expect((await tentar(['2099-02-30'])).json.erro).toBe('Uma das datas escolhidas é inválida.')
    expect((await tentar(['2099-07-01', '2099-07-01'])).json.erro).toBe('Existem datas repetidas.')
    expect((await tentar(['2099-07-01', '2099-06-12'])).json.erro).toBe('12/06 já é a data deste evento.')
    const muitas = Array.from(
      { length: 61 },
      (_, i) => `2100-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    )
    expect((await tentar(muitas)).json.erro).toBe('Dá para repetir em no máximo 60 datas de uma vez.')
    expect((await req('POST', '/api/eventos/nao-existe/repetir', { datas: ['2099-07-01'] })).status).toBe(404)
    const todos = (await dados()).eventos
    expect(todos).toHaveLength(1)
    expect(todos[0].grupoId).toBe('')
  })
})

describe('séries: proteção contra duplicar e contra perder o grupo', () => {
  it('não repete numa data em que a série já tem evento (a não ser que ele esteja cancelado)', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', evento(cli.id), 201)).json
    const r = (await req<{ criados: Evento[] }>('POST', `/api/eventos/${e.id}/repetir`, { datas: ['2099-07-10'] }, 201)).json
    const outra = await req<{ erro: string }>('POST', `/api/eventos/${e.id}/repetir`, { datas: ['2099-08-14', '2099-07-10'] })
    expect(outra.status).toBe(409)
    expect(outra.json.erro).toBe('10/07 já tem um evento desta série.')
    // A partir da cópia, também não dá para repetir na data do original
    const daCopia = await req<{ erro: string }>('POST', `/api/eventos/${r.criados[0].id}/repetir`, { datas: ['2099-06-12'] })
    expect(daCopia.json.erro).toBe('12/06 já tem um evento desta série.')
    expect((await dados()).eventos).toHaveLength(2)
    // Cancelada a data, pode criar de novo
    await req('PATCH', `/api/eventos/${r.criados[0].id}`, { status: 'CANCELADO' }, 200)
    await req('POST', `/api/eventos/${e.id}/repetir`, { datas: ['2099-07-10'] }, 201)
  })

  it('salvar o evento inteiro (ex.: formulário aberto antes da repetição) não tira o evento da série', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', evento(cli.id), 201)).json
    const { original } = (await req<{ original: Evento }>('POST', `/api/eventos/${e.id}/repetir`, { datas: ['2099-07-10'] }, 201))
      .json
    const salvo = (
      await req<Evento>('PUT', `/api/eventos/${e.id}`, { ...e, versao: original.versao, grupoId: '', rodape: 'OBRIGADO' }, 200)
    ).json
    expect(salvo.grupoId).toBe(original.grupoId)
    expect(salvo.rodape).toBe('OBRIGADO')
  })
})
