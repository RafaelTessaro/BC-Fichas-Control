import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hojeLocalIso } from '#shared/dominio.ts'
import type { Backup, Cliente, DadosCompletos, Evento, Maquina, OrdemServico } from '#shared/tipos.ts'
import { criarApp } from './app.ts'

const H = { 'x-bc-fichas': '1' }

let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-maq-'))
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

const criarMaquina = async (identificacao: string, extra: object = {}) =>
  (await req<Maquina>('POST', '/api/maquinas', { tipo: identificacao[0], identificacao, ...extra }, 201)).json

async function criarCliente() {
  return (await req<Cliente>('POST', '/api/clientes', { tipo: 'AVULSO', nome: 'Barraca' }, 201)).json
}

const eventoCom = (clienteId: string, datas: string[], maquinasIds: string[] = []) => ({
  clienteId,
  nome: 'Festa',
  cabecalho: 'FESTA DA PRIMAVERA\r\nESCOLA ESTADUAL',
  dias: datas.map((data, i) => ({ id: `d${i}`, data, maquinas: Math.max(1, maquinasIds.length) })),
  maquinasIds,
  status: 'EM_ABERTO',
})

describe('máquinas', () => {
  it('cadastra, impede identificação repetida e controla edições simultâneas', async () => {
    const m = await criarMaquina('P-01')
    expect(m).toMatchObject({ tipo: 'P', identificacao: 'P-01', status: 'DISPONIVEL', versao: 1 })

    const dup = await req<{ erro: string; duplicado: { id: string } }>('POST', '/api/maquinas', {
      tipo: 'P',
      identificacao: ' p-01 ',
    })
    expect(dup.status).toBe(409)
    expect(dup.json.duplicado.id).toBe(m.id)

    const editada = await req<Maquina>('PUT', `/api/maquinas/${m.id}`, { ...m, modelo: 'Compacta' }, 200)
    expect(editada.json).toMatchObject({ modelo: 'Compacta', versao: 2 })
    const velha = await req('PUT', `/api/maquinas/${m.id}`, { ...m, modelo: 'Outra' })
    expect(velha.status).toBe(409)

    await req('POST', '/api/maquinas', { tipo: 'P', identificacao: '' }, 400)
  })

  it('ajusta a quantidade de um tipo: cadastra as que faltam e retira as que sobram', async () => {
    const r = await req<{ criadas: Maquina[] }>('POST', '/api/maquinas/quantidade', { tipo: 'P', quantidade: 3 }, 200)
    expect(r.json.criadas.map((m) => m.identificacao)).toEqual(['P-01', 'P-02', 'P-03'])
    await req('POST', '/api/maquinas/quantidade', { tipo: 'G', quantidade: 2 }, 200)

    // P-02 já foi usada num evento antigo: tem histórico, então fica desativada (P-03 é apagada)
    const cli = await criarCliente()
    const [, p2] = (await dados()).maquinas
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2020-05-01'], [p2.id]), 201)
    const menos = await req<{ excluidas: string[]; desativadas: Maquina[] }>(
      'POST',
      '/api/maquinas/quantidade',
      { tipo: 'P', quantidade: 1 },
      200,
    )
    expect(menos.json.desativadas.map((m) => m.identificacao)).toEqual(['P-02'])
    expect(menos.json.excluidas).toHaveLength(1)
    const depois = (await dados()).maquinas
    expect(depois.map((m) => `${m.identificacao}:${m.status}`)).toEqual([
      'P-01:DISPONIVEL',
      'P-02:DESATIVADA',
      'G-01:DISPONIVEL',
      'G-02:DISPONIVEL',
    ])

    // Aumentar de novo continua a numeração (P-02 desativada conta como usada)
    const mais = await req<{ criadas: Maquina[] }>('POST', '/api/maquinas/quantidade', { tipo: 'P', quantidade: 2 }, 200)
    expect(mais.json.criadas.map((m) => m.identificacao)).toEqual(['P-03'])
  })

  it('não retira máquinas com eventos de hoje em diante', async () => {
    await req('POST', '/api/maquinas/quantidade', { tipo: 'G', quantidade: 1 }, 200)
    const cli = await criarCliente()
    const [g1] = (await dados()).maquinas
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2099-01-10'], [g1.id]), 201)
    const r = await req<{ erro: string }>('POST', '/api/maquinas/quantidade', { tipo: 'G', quantidade: 0 })
    expect(r.status).toBe(409)
    expect(r.json.erro).toMatch(/eventos de hoje em diante/)
    await req('POST', '/api/maquinas/quantidade', { tipo: 'X', quantidade: 1 }, 400)
    await req('POST', '/api/maquinas/quantidade', { tipo: 'P', quantidade: -1 }, 400)
  })

  it('só exclui máquina sem histórico', async () => {
    const livre = await criarMaquina('P-01')
    const usada = await criarMaquina('P-02')
    const cli = await criarCliente()
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2026-03-01'], [usada.id]), 201)
    const r = await req<{ erro: string }>('DELETE', `/api/maquinas/${usada.id}`)
    expect(r.status).toBe(409)
    expect(r.json.erro).toMatch(/Desative-a/)
    await req('DELETE', `/api/maquinas/${livre.id}`, undefined, 204)
  })
})

describe('evento com cabeçalho e máquinas enviadas', () => {
  it('grava o cabeçalho, as máquinas e recusa máquina inexistente', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const g1 = await criarMaquina('G-01')
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2026-08-01'], [p1.id, g1.id, p1.id]), 201)).json
    expect(e.cabecalho).toBe('FESTA DA PRIMAVERA\nESCOLA ESTADUAL')
    expect(e.maquinasIds).toEqual([p1.id, g1.id])
    expect('local' in e).toBe(false)

    const r = await req<{ erro: string }>('POST', '/api/eventos', eventoCom(cli.id, ['2026-08-01'], ['nao-existe']))
    expect(r.status).toBe(400)
    expect(r.json.erro).toMatch(/máquinas selecionadas não existe mais/)

    const copia = (await req<Evento>('POST', `/api/eventos/${e.id}/duplicar`, undefined, 201)).json
    expect(copia.maquinasIds).toEqual([])
    expect(copia.cabecalho).toBe(e.cabecalho)
  })

  it('eventos gravados antes desta versão ganham cabeçalho e máquinas vazios (e perdem o "local")', async () => {
    await app.close()
    const arquivo = join(pasta, 'antigo.db')
    ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: arquivo, pastaEstatica: null }))
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2026-08-01']), 201)).json
    const db = new DatabaseSync(arquivo)
    const { dados: json } = db.prepare('SELECT dados FROM eventos WHERE id = ?').get(e.id) as { dados: string }
    const { cabecalho: _c, maquinasIds: _m, ...antigo } = JSON.parse(json)
    db.prepare('UPDATE eventos SET dados = ? WHERE id = ?').run(JSON.stringify({ ...antigo, local: 'Ginásio' }), e.id)
    db.close()
    const [lido] = (await dados()).eventos
    expect(lido).toMatchObject({ cabecalho: '', maquinasIds: [], observacoes: 'Local: Ginásio' })
    expect('local' in lido).toBe(false)
    // Uma alteração rápida grava o evento já no formato novo, sem perder o local
    await req('PATCH', `/api/eventos/${e.id}`, { status: 'PENDENTE' }, 200)
    const db2 = new DatabaseSync(arquivo)
    const gravado = JSON.parse((db2.prepare('SELECT dados FROM eventos WHERE id = ?').get(e.id) as { dados: string }).dados)
    db2.close()
    expect(gravado).toMatchObject({ observacoes: 'Local: Ginásio', cabecalho: '' })
    expect('local' in gravado).toBe(false)
  })
})

describe('máquinas indisponíveis no evento', () => {
  it('recusa máquina em manutenção ou desativada em evento de hoje em diante', async () => {
    const cli = await criarCliente()
    const manut = await criarMaquina('P-01', { status: 'MANUTENCAO' })
    const desat = await criarMaquina('P-02', { status: 'DESATIVADA' })
    const r = await req<{ erro: string }>('POST', '/api/eventos', eventoCom(cli.id, ['2099-01-10'], [manut.id]))
    expect(r.status).toBe(409)
    expect(r.json.erro).toMatch(/P-01 está em manutenção/)
    const d = await req<{ erro: string }>('POST', '/api/eventos', eventoCom(cli.id, ['2020-01-10'], [desat.id]))
    expect(d.status).toBe(409)
    expect(d.json.erro).toMatch(/P-02 está desativada/)
    // Evento só no passado (lançamento atrasado): a manutenção de hoje não impede
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2020-01-10'], [manut.id]), 201)
    // Evento cancelado não é cobrado
    await req('POST', '/api/eventos', { ...eventoCom(cli.id, ['2099-01-10'], [manut.id]), status: 'CANCELADO' }, 201)
  })

  it('recusa a mesma máquina em outro evento nas mesmas datas, dizendo qual', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const p2 = await criarMaquina('P-02')
    const a = (
      await req<Evento>(
        'POST',
        '/api/eventos',
        { ...eventoCom(cli.id, ['2099-01-10', '2099-01-11'], [p1.id]), nome: 'Festa A' },
        201,
      )
    ).json
    const r = await req<{ erro: string; conflitos: unknown[] }>(
      'POST',
      '/api/eventos',
      eventoCom(cli.id, ['2099-01-11'], [p2.id, p1.id]),
    )
    expect(r.status).toBe(409)
    expect(r.json.erro).toBe(
      `A máquina P-01 já está no evento #${String(a.codigo).padStart(4, '0')} Festa A (Barraca) em 11/01. Escolha outra máquina.`,
    )
    expect(r.json.conflitos).toHaveLength(1)
    // Outra data: pode
    const b = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-01-12'], [p1.id]), 201)).json
    // Acrescentar ao evento B um dia em que a P-01 está na Festa A: recusa
    const novoDia = { ...b, dias: [...b.dias, { id: 'x', data: '2099-01-10', maquinas: 1 }] }
    expect((await req('PUT', `/api/eventos/${b.id}`, novoDia)).status).toBe(409)
  })

  it('reativar um evento cancelado confere as máquinas dele', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const cancelado = (
      await req<Evento>('POST', '/api/eventos', { ...eventoCom(cli.id, ['2099-02-01'], [p1.id]), status: 'CANCELADO' }, 201)
    ).json
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2099-02-01'], [p1.id]), 201)
    const r = await req<{ erro: string }>('PATCH', `/api/eventos/${cancelado.id}`, { status: 'EM_ABERTO' })
    expect(r.status).toBe(409)
    expect(r.json.erro).toMatch(/^A máquina P-01 já está no evento .* em 01\/02\. Abra o evento e troque a máquina\.$/)
  })

  it('máquina que entrou em manutenção depois de gravada não trava a edição; dia novo de hoje em diante trava', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-04-01'], [p1.id]), 201)).json
    await req('PUT', `/api/maquinas/${p1.id}`, { ...p1, status: 'MANUTENCAO' }, 200)
    const renomeado = (await req<Evento>('PUT', `/api/eventos/${e.id}`, { ...e, nome: 'Renomeado' }, 200)).json
    await req('PATCH', `/api/eventos/${e.id}`, { status: 'PENDENTE' }, 200)
    const atual = (await dados()).eventos.find((x) => x.id === e.id)!
    expect(atual.versao).toBe(renomeado.versao + 1)
    const maisUmDia = { ...atual, dias: [...atual.dias, { id: 'x', data: '2099-04-02', maquinas: 1 }] }
    const r = await req<{ erro: string }>('PUT', `/api/eventos/${e.id}`, maisUmDia)
    expect(r.status).toBe(409)
    expect(r.json.erro).toBe('A máquina P-01 está em manutenção. Escolha outra máquina ou conclua a manutenção antes.')
  })

  it('reativar um evento antigo com máquina desativada depois: é histórico, não trava', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (
      await req<Evento>('POST', '/api/eventos', { ...eventoCom(cli.id, ['2020-05-01'], [p1.id]), status: 'CANCELADO' }, 201)
    ).json
    await req('PUT', `/api/maquinas/${p1.id}`, { ...p1, status: 'DESATIVADA' }, 200)
    await req('PATCH', `/api/eventos/${e.id}`, { status: 'EM_ABERTO' }, 200)
    // Mas não pode entrar num evento antigo em que não estava
    const outro = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2020-05-02']), 201)).json
    const r = await req<{ erro: string }>('PUT', `/api/eventos/${outro.id}`, { ...outro, maquinasIds: [p1.id] })
    expect(r.status).toBe(409)
    expect(r.json.erro).toBe('A máquina P-01 está desativada. Escolha outra máquina.')
  })

  it('conflitos que já estavam gravados não travam outras alterações do evento', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const backup = (await req<Backup>('GET', '/api/backup')).json
    // Dois eventos com a mesma máquina no mesmo dia (vindos de uma versão sem a trava)
    const evento = (id: string, codigo: number) => ({ ...eventoCom(cli.id, ['2099-03-01'], [p1.id]), id, codigo })
    await req('POST', '/api/backup/restaurar', { ...backup, eventos: [evento('a', 1), evento('b', 2)] }, 200)
    const [, b] = (await dados()).eventos
    await req('PUT', `/api/eventos/${b.id}`, { ...b, nome: 'Renomeado' }, 200)
    await req('PATCH', `/api/eventos/${b.id}`, { status: 'PENDENTE' }, 200)
  })
})

describe('ordens de serviço', () => {
  it('numera, muda a situação da máquina junto e valida as datas', async () => {
    const m = await criarMaquina('G-04')
    const abre = await req<OrdemServico>(
      'POST',
      '/api/ordens',
      { maquinaId: m.id, tipo: 'CORRETIVA', abertura: '2026-09-01', problema: 'Papel enroscando', statusMaquina: 'MANUTENCAO' },
      201,
    )
    expect(abre.json).toMatchObject({ numero: 1, status: 'ABERTA', conclusao: '' })
    let maquina = (await dados()).maquinas[0]
    expect(maquina.status).toBe('MANUTENCAO')

    const segunda = await req<OrdemServico>(
      'POST',
      '/api/ordens',
      { maquinaId: m.id, servicos: ['Limpeza completa', 'limpeza completa', 'Higienização'], abertura: '2026-09-02' },
      201,
    )
    expect(segunda.json).toMatchObject({ numero: 2, tipo: 'PREVENTIVA', servicos: ['Limpeza completa', 'Higienização'] })

    // Concluir sem data: hoje; e devolver a máquina
    const conclui = await req<OrdemServico>(
      'PUT',
      `/api/ordens/${abre.json.id}`,
      { ...abre.json, status: 'CONCLUIDA', solucao: 'Rolete trocado', statusMaquina: 'DISPONIVEL' },
      200,
    )
    expect(conclui.json).toMatchObject({ status: 'CONCLUIDA', conclusao: hojeLocalIso(), versao: 2 })
    maquina = (await dados()).maquinas[0]
    expect(maquina.status).toBe('DISPONIVEL')

    await req('PUT', `/api/ordens/${abre.json.id}`, { ...abre.json, solucao: 'x' }, 409) // versão antiga
    await req('POST', '/api/ordens', { maquinaId: m.id, abertura: '2026-09-01' }, 400) // sem serviço nem problema
    const antes = await req<{ erro: string }>('POST', '/api/ordens', {
      maquinaId: m.id,
      problema: 'x',
      status: 'CONCLUIDA',
      abertura: '2026-09-10',
      conclusao: '2026-09-01',
    })
    expect(antes.status).toBe(400)
    expect(antes.json.erro).toMatch(/antes da abertura/)
    await req('POST', '/api/ordens', { maquinaId: 'nao-existe', problema: 'x' }, 400)

    await req('DELETE', `/api/ordens/${segunda.json.id}`, undefined, 204)
    expect((await dados()).ordens.map((o) => o.numero)).toEqual([1])
  })
})

describe('backup com máquinas e O.S.', () => {
  async function montarDados() {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2026-08-01'], [p1.id]), 201)
    await req('POST', '/api/ordens', { maquinaId: p1.id, servicos: ['Higienização'] }, 201)
    return p1
  }

  it('exporta e restaura máquinas, O.S. e a numeração', async () => {
    await montarDados()
    const backup = (await req<Backup>('GET', '/api/backup')).json
    expect(backup).toMatchObject({ versao: 3, proximaOS: 2 })
    expect(backup.maquinas).toHaveLength(1)
    expect(backup.ordens).toHaveLength(1)

    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    expect((await dados()).maquinas).toEqual([])
    const r = await req('POST', '/api/backup/restaurar', backup, 200)
    expect(r.json).toEqual({ clientes: 1, eventos: 1, maquinas: 1 })
    const d = await dados()
    expect(d.eventos[0].maquinasIds).toEqual([d.maquinas[0].id])
    const nova = await req<OrdemServico>('POST', '/api/ordens', { maquinaId: d.maquinas[0].id, problema: 'x' }, 201)
    expect(nova.json.numero).toBe(2)
  })

  it('mescla: mesma identificação é a mesma máquina e as O.S. ganham número novo se repetido', async () => {
    const p1 = await montarDados()
    const backup = (await req<Backup>('GET', '/api/backup')).json
    // Outro computador: mesmos dados com ids diferentes
    const outro = {
      ...backup,
      clientes: backup.clientes.map((c) => ({ ...c, id: `x-${c.id}` })),
      maquinas: backup.maquinas.map((m) => ({ ...m, id: `x-${m.id}`, identificacao: m.identificacao.toLowerCase() })),
      ordens: backup.ordens.map((o) => ({ ...o, id: `x-${o.id}`, maquinaId: `x-${o.maquinaId}` })),
      eventos: backup.eventos.map((e) => ({
        ...e,
        id: `x-${e.id}`,
        clienteId: `x-${e.clienteId}`,
        maquinasIds: e.maquinasIds.map((id) => `x-${id}`),
      })),
    }
    const r = await req('POST', '/api/backup/mesclar', outro, 200)
    expect(r.json).toEqual({ clientes: 1, eventos: 1, maquinas: 0, ordens: 1, ignorados: 1 })
    const d = await dados()
    expect(d.maquinas).toHaveLength(1)
    expect(d.ordens.map((o) => [o.numero, o.maquinaId])).toEqual([
      [2, p1.id],
      [1, p1.id],
    ])
    expect(d.eventos.every((e) => e.maquinasIds.length === 1 && e.maquinasIds[0] === p1.id)).toBe(true)
  })

  it('restaura backup da versão 2 (sem máquinas)', async () => {
    const cli = { id: 'c1', tipo: 'AVULSO', nome: 'Barraca' }
    const v2 = {
      app: 'bc-fichas-control',
      versao: 2,
      clientes: [cli],
      eventos: [
        {
          ...eventoCom('c1', ['2026-01-01']),
          id: 'e1',
          codigo: 5,
          local: 'Ginásio',
          maquinasIds: undefined,
          cabecalho: undefined,
        },
      ],
      config: {},
      proximoCodigo: 6,
    }
    await req('POST', '/api/backup/restaurar', v2, 200)
    const d = await dados()
    expect(d.eventos[0]).toMatchObject({ codigo: 5, cabecalho: '', maquinasIds: [], observacoes: 'Local: Ginásio' })
    expect(d.maquinas).toEqual([])
  })
})

describe('dados de exemplo', () => {
  it('trazem máquinas P e G, O.S. e uma festa acontecendo hoje', async () => {
    await req('POST', '/api/exemplo', undefined, 200)
    const d = await dados()
    expect(d.maquinas.filter((m) => m.tipo === 'P' && m.status !== 'DESATIVADA')).toHaveLength(12)
    expect(d.maquinas.filter((m) => m.tipo === 'G')).toHaveLength(6)
    expect(d.ordens.some((o) => o.status === 'EM_ANDAMENTO')).toBe(true)
    const hoje = hojeLocalIso()
    const festa = d.eventos.find((e) => e.dias.some((x) => x.data === hoje) && e.maquinasIds.length)
    expect(festa).toBeDefined()
    // com máquinas cadastradas não dá para carregar o exemplo de novo
    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    await criarMaquina('P-01')
    await req('POST', '/api/exemplo', undefined, 409)
  })
})
