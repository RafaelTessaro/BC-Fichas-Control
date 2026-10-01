import Fastify from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente, Evento, MensagemTempoReal } from '#shared/tipos.ts'
import { criarApp } from '../app.ts'
import { BackupsAutomaticos } from '../backup.ts'
import type { Contexto } from '../contexto.ts'
import { abrirBanco } from '../db.ts'
import { ErroApi } from '../erros.ts'
import { Repositorio } from '../repositorio.ts'
import { TempoReal } from '../tempoReal.ts'
import { MSG_SEM_INTERNET } from './cliente.ts'
import { idGoogle } from './mapeamento.ts'
import { criarModuloGoogle, type ModuloGoogle } from './modulo.ts'
import { criarSimuladorGoogle, EMAIL_TESTE, gerarContaServico } from './simuladorGoogle.ts'

const conta = gerarContaServico()
const AGENDA = 'bcfichas@group.calendar.google.com'
const H = { 'x-bc-fichas': '1' }

const logMudo = { warn() {}, error() {}, info() {}, debug() {} } as unknown as FastifyBaseLogger

/** Módulo isolado com o Google simulado e relógio controlado. */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), 'bcf-google-'))
  const db = abrirBanco(':memory:')
  const publicadas: MensagemTempoReal[] = []
  const repo = new Repositorio(db, (m) => publicadas.push(m))
  const tempoReal = new TempoReal()
  const ctx: Contexto = {
    db,
    repo,
    tempoReal,
    backups: new BackupsAutomaticos(db, join(pasta, 'backups')),
    pastaDados: pasta,
    log: logMudo,
  }
  const sim = criarSimuladorGoogle(conta.chavePublica)
  sim.criarAgenda(AGENDA)
  let relogio = Date.parse('2026-10-01T12:00:00Z')
  const modulo: ModuloGoogle = criarModuloGoogle(ctx, { fetch: sim.fetch, agora: () => relogio })
  repo.registrarExtensao(modulo.extensao)

  const app = Fastify()
  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof ErroApi) return reply.code(erro.status).send({ erro: erro.message })
    return reply.code(500).send({ erro: String(erro) })
  })
  await modulo.rotas(app)

  const cliente = repo.criarCliente({
    tipo: 'PJ',
    nome: 'Padaria Ideal',
    documento: '12.403.843/0001-18',
    telefone: '19998765432',
  })
  const criarEvento = (extra: object = {}) =>
    repo.criarEvento({
      clienteId: cliente.id,
      nome: 'Baile da Cidade',
      local: 'Clube',
      cidade: 'Rio Claro',
      dias: [
        { id: 'a', data: '2026-08-01', maquinas: 2 },
        { id: 'b', data: '2026-08-02', maquinas: 3 },
        { id: 'c', data: '2026-08-05', maquinas: 1 },
      ],
      valorDiaria: 80,
      valorBobina: 6,
      bobinasConsignadas: 50,
      status: 'EM_ABERTO',
      ...extra,
    })

  const req = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: H })

  const ativar = async (extra: object = {}) => {
    expect((await req('POST', '/api/google/credenciais', { json: JSON.stringify(conta.json) })).statusCode).toBe(200)
    const r = await req('PUT', '/api/google/config', { ativo: true, calendarId: AGENDA, ...extra })
    expect(r.statusCode, r.body).toBe(200)
  }

  return {
    pasta,
    ctx,
    repo,
    sim,
    modulo,
    cliente: cliente as Cliente,
    publicadas,
    criarEvento,
    req,
    ativar,
    avancar: (ms: number) => (relogio += ms),
    agora: () => relogio,
    async fechar() {
      modulo.parar()
      await app.close()
      tempoReal.fechar()
      db.close()
      rmSync(pasta, { recursive: true, force: true })
    },
  }
}

type Ambiente = Awaited<ReturnType<typeof montar>>
let t: Ambiente

beforeEach(async () => {
  t = await montar()
})
afterEach(async () => {
  await t.fechar()
})

const chamadasApi = () =>
  t.sim.chamadas.filter((c) => c.caminho !== 'token').map((c) => `${c.metodo} ${c.caminho.replace(/\/calendars\/[^/]+/, '')}`)
const syncDe = (e: Evento) => t.repo.obterEvento(e.id)?.google

describe('sincronização com o Google Agenda', () => {
  it('não faz nada nem decora os eventos enquanto a integração está desativada', async () => {
    const e = t.criarEvento()
    await t.modulo.sincronizarAgora()
    expect(t.sim.chamadas).toEqual([])
    expect(syncDe(e)).toBeUndefined()
  })

  it('envia cada bloco de datas como evento de dia inteiro (PUT 404 → POST) e não reenvia sem mudança', async () => {
    const e = t.criarEvento()
    await t.ativar()
    expect(syncDe(e)).toEqual({ status: 'pendente' })

    await t.modulo.sincronizarAgora()
    const b0 = idGoogle(e.id, 0)
    const b1 = idGoogle(e.id, 1)
    expect(chamadasApi()).toEqual([`PUT /events/${b0}`, 'POST /events', `PUT /events/${b1}`, 'POST /events'])
    const enviados = t.sim.eventos(AGENDA)
    expect(enviados.map((g) => [g.id, (g.start as { date: string }).date, (g.end as { date: string }).date])).toEqual([
      [b0, '2026-08-01', '2026-08-03'],
      [b1, '2026-08-05', '2026-08-06'],
    ])
    expect(enviados[0].summary).toBe('Baile da Cidade — Padaria Ideal (2–3 máquinas)')
    expect(syncDe(e)).toMatchObject({ status: 'ok', em: '2026-10-01T12:00:00.000Z' })
    // O navegador recebe o novo status em tempo real
    expect(t.publicadas.at(-1)).toMatchObject({ tipo: 'evento', dado: { id: e.id, google: { status: 'ok' } } })

    // Alteração que não muda o conteúdo enviado (observações): nenhuma chamada
    t.sim.limparChamadas()
    t.repo.alterarEvento(e.id, { observacoes: 'só interno' })
    expect(syncDe(e)?.status).toBe('pendente')
    await t.modulo.sincronizarAgora()
    expect(t.sim.chamadas).toEqual([])
    expect(syncDe(e)?.status).toBe('ok')
  })

  it('atualiza com PUT e apaga o bloco que deixou de existir', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.limparChamadas()

    t.repo.atualizarEvento(e.id, { ...e, nome: 'Baile Novo', dias: e.dias.filter((d) => d.data !== '2026-08-05') })
    await t.modulo.sincronizarAgora()
    expect(chamadasApi()).toEqual([`PUT /events/${idGoogle(e.id, 0)}`, `DELETE /events/${idGoogle(e.id, 1)}`])
    expect(t.sim.eventos(AGENDA).map((g) => g.summary)).toEqual(['Baile Novo — Padaria Ideal (2–3 máquinas)'])
  })

  it('apaga do Google ao cancelar e recupera (PUT) ao reabrir', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()

    t.repo.alterarEvento(e.id, { status: 'CANCELADO' })
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect(syncDe(e)).toBeUndefined() // cancelado e já removido: sem selo

    t.sim.limparChamadas()
    t.repo.alterarEvento(e.id, { status: 'FINALIZADO' })
    await t.modulo.sincronizarAgora()
    expect(chamadasApi()).toEqual([`PUT /events/${idGoogle(e.id, 0)}`, `PUT /events/${idGoogle(e.id, 1)}`])
    expect(t.sim.eventos(AGENDA).map((g) => g.colorId)).toEqual(['10', '10'])
  })

  it('apaga do Google ao excluir o evento e ao limpar todos os dados', async () => {
    const e1 = t.criarEvento()
    const e2 = t.criarEvento({ nome: 'Quermesse' })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toHaveLength(4)

    t.repo.excluirEvento(e1.id)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).every((g) => (g.extendedProperties as any).private.bcFichasId === e2.id)).toBe(true)

    t.repo.limparTudo()
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect((await t.req('GET', '/api/google/status')).json().resumo).toEqual({ ok: 0, pendentes: 0, erros: 0 })
  })

  it('ao trocar de agenda, apaga da antiga e cria na nova', async () => {
    t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.criarAgenda('nova@group.calendar.google.com')

    const r = await t.req('PUT', '/api/google/config', { calendarId: 'nova@group.calendar.google.com' })
    expect(r.json().resumo.pendentes).toBe(1)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect(t.sim.eventos('nova@group.calendar.google.com')).toHaveLength(2)
  })

  it('sem internet: marca erro com mensagem amigável e tenta de novo com espera crescente', async () => {
    const e = t.criarEvento()
    await t.ativar()
    t.sim.offline = true
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)).toEqual({ status: 'erro', erro: MSG_SEM_INTERNET })
    const status = (await t.req('GET', '/api/google/status')).json()
    expect(status).toMatchObject({ ultimoErro: MSG_SEM_INTERNET, resumo: { ok: 0, pendentes: 0, erros: 1 } })

    // Antes de 30 s não tenta de novo
    const tentativas = () => t.ctx.db.prepare('SELECT tentativas, proxima_tentativa FROM google_sync').get() as any
    expect(tentativas()).toEqual({ tentativas: 1, proxima_tentativa: t.agora() + 30_000 })
    t.avancar(29_000)
    await t.modulo.sincronizarAgora()
    expect(tentativas().tentativas).toBe(1)

    t.avancar(1_000)
    await t.modulo.sincronizarAgora()
    expect(tentativas()).toEqual({ tentativas: 2, proxima_tentativa: t.agora() + 60_000 })

    // A conexão volta
    t.sim.offline = false
    t.avancar(60_000)
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('ok')
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({ ultimoErro: '', resumo: { ok: 1, erros: 0 } })
  })

  it('em segundo plano, envia logo após a alteração e repete enquanto houver pendências', async () => {
    await t.ativar()
    vi.useFakeTimers()
    try {
      t.modulo.iniciar()
      const e = t.criarEvento()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(t.sim.eventos(AGENDA)).toHaveLength(0) // ainda aguardando novas edições
      await vi.advanceTimersByTimeAsync(600)
      expect(t.sim.eventos(AGENDA)).toHaveLength(2)
      expect(syncDe(e)?.status).toBe('ok')

      // Falha temporária: o temporizador periódico tenta de novo após a espera
      t.sim.falharCom = 503
      t.repo.alterarEvento(e.id, { status: 'FINALIZADO' })
      await vi.advanceTimersByTimeAsync(1_600)
      expect(syncDe(e)?.status).toBe('erro')
      expect(syncDe(e)?.erro).toMatch(/temporariamente indisponível/)
      t.sim.falharCom = 0
      t.avancar(30_000)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(syncDe(e)?.status).toBe('ok')
      expect(t.sim.eventos(AGENDA)[0].colorId).toBe('10')
    } finally {
      t.modulo.parar()
      vi.useRealTimers()
    }
  })

  it('uma edição durante a espera tenta de novo na hora', async () => {
    const e = t.criarEvento()
    await t.ativar()
    t.sim.offline = true
    await t.modulo.sincronizarAgora()
    t.sim.offline = false
    t.repo.alterarEvento(e.id, { status: 'PENDENTE' })
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('ok')
  })

  it('explica a falta de permissão citando o e-mail da conta de serviço', async () => {
    t.sim.criarAgenda('alheia@group.calendar.google.com', false)
    const e = t.criarEvento()
    await t.ativar({ calendarId: 'alheia@group.calendar.google.com' })
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('erro')
    expect(syncDe(e)?.erro).toContain(EMAIL_TESTE)
  })

  it('inclui os valores na descrição somente com a opção ligada', async () => {
    t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    expect(String(t.sim.eventos(AGENDA)[0].description)).not.toContain('Total')

    await t.req('PUT', '/api/google/config', { incluirValores: true })
    await t.modulo.sincronizarAgora()
    expect(String(t.sim.eventos(AGENDA)[0].description)).toMatch(/Total: R\$\s?480,00/)
  })
})

describe('rotas /api/google', () => {
  it('guarda a chave com permissão restrita e nunca devolve a chave privada', async () => {
    const r = await t.req('POST', '/api/google/credenciais', { json: conta.json })
    expect(r.statusCode).toBe(200)
    expect(r.body).not.toContain('PRIVATE KEY')
    expect(r.json()).toMatchObject({ configurado: true, ativo: false, contaServico: EMAIL_TESTE, projeto: 'bc-fichas-teste' })

    const arquivo = join(t.pasta, 'google', 'credenciais.json')
    expect(JSON.parse(readFileSync(arquivo, 'utf8')).client_email).toBe(EMAIL_TESTE)
    if (process.platform !== 'win32') expect(statSync(arquivo).mode & 0o777).toBe(0o600)

    const status = await t.req('GET', '/api/google/status')
    expect(status.body).not.toContain('PRIVATE KEY')
    expect(status.body).not.toContain('private_key')
  })

  it('valida o arquivo de credenciais', async () => {
    const casos = [
      { json: '' },
      { json: 'não é json' },
      { json: { ...conta.json, type: 'authorized_user' } },
      { json: { ...conta.json, private_key: undefined } },
    ]
    for (const payload of casos) {
      const r = await t.req('POST', '/api/google/credenciais', payload)
      expect(r.statusCode).toBe(400)
      expect(r.json().erro).toBeTruthy()
    }
    expect((await t.req('GET', '/api/google/status')).json().configurado).toBe(false)
  })

  it('só ativa com credenciais e ID da agenda válidos', async () => {
    const semChave = await t.req('PUT', '/api/google/config', { ativo: true, calendarId: AGENDA })
    expect(semChave.statusCode).toBe(400)
    expect(semChave.json().erro).toMatch(/chave da conta de serviço/)

    await t.req('POST', '/api/google/credenciais', { json: conta.json })
    expect((await t.req('PUT', '/api/google/config', { ativo: true })).statusCode).toBe(400)
    expect((await t.req('PUT', '/api/google/config', { ativo: true, calendarId: 'primary' })).statusCode).toBe(400)
    expect((await t.req('PUT', '/api/google/config', { ativo: 'sim' })).statusCode).toBe(400)

    // Aceita o link de incorporação da agenda e extrai o ID
    const link = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(AGENDA)}&ctz=America%2FSao_Paulo`
    const ok = await t.req('PUT', '/api/google/config', { ativo: true, calendarId: link })
    expect(ok.json()).toMatchObject({ ativo: true, calendarId: AGENDA })
  })

  it('testa a conexão lendo a agenda', async () => {
    expect((await t.req('POST', '/api/google/testar', { calendarId: AGENDA })).statusCode).toBe(400)
    await t.req('POST', '/api/google/credenciais', { json: conta.json })

    const ok = await t.req('POST', '/api/google/testar', { calendarId: AGENDA })
    expect(ok.json()).toMatchObject({ ok: true, agenda: 'Agenda BC Fichas' })

    const inexistente = await t.req('POST', '/api/google/testar', { calendarId: 'outra@group.calendar.google.com' })
    expect(inexistente.statusCode).toBe(400)
    expect(inexistente.json().erro).toBe('Agenda não encontrada: confira o ID da agenda.')

    t.sim.offline = true
    const offline = await t.req('POST', '/api/google/testar', { calendarId: AGENDA })
    expect(offline.statusCode).toBe(503)
    expect(offline.json().erro).toBe(MSG_SEM_INTERNET)
  })

  it('sincronizar tudo reenvia mesmo sem mudanças; remover a chave desativa', async () => {
    expect((await t.req('POST', '/api/google/sincronizar')).statusCode).toBe(400)
    t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.limparChamadas()

    const r = await t.req('POST', '/api/google/sincronizar')
    expect(r.json()).toMatchObject({ marcados: 1, resumo: { pendentes: 1 } })
    await t.modulo.sincronizarAgora()
    expect(chamadasApi().filter((c) => c.startsWith('PUT'))).toHaveLength(2)

    const removido = await t.req('DELETE', '/api/google/credenciais')
    expect(removido.json()).toMatchObject({ configurado: false, ativo: false, contaServico: '' })
    expect(existsSync(join(t.pasta, 'google', 'credenciais.json'))).toBe(false)
  })
})

describe('integração com o servidor', () => {
  it('as rotas exigem o cabeçalho do app e o evento traz o status quando ativo', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'bcf-app-'))
    const { app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null })
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/api/google/credenciais', payload: { json: conta.json } })).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'PUT', url: '/api/google/config', headers: H, payload: { ativo: true, calendarId: AGENDA } }))
          .statusCode,
      ).toBe(400)
      await app.inject({ method: 'POST', url: '/api/google/credenciais', headers: H, payload: { json: conta.json } })
      await app.inject({ method: 'PUT', url: '/api/google/config', headers: H, payload: { ativo: true, calendarId: AGENDA } })

      const c = (
        await app.inject({ method: 'POST', url: '/api/clientes', headers: H, payload: { tipo: 'AVULSO', nome: 'João' } })
      ).json()
      const e = await app.inject({
        method: 'POST',
        url: '/api/eventos',
        headers: H,
        payload: {
          clienteId: c.id,
          nome: 'Aniversário',
          dias: [{ id: 'a', data: '2026-09-10', maquinas: 1 }],
          status: 'EM_ABERTO',
        },
      })
      expect(e.json().google).toEqual({ status: 'pendente' })
      const dados = (await app.inject({ url: '/api/dados' })).json()
      expect(dados.eventos[0].google).toEqual({ status: 'pendente' })
      const status = await app.inject({ url: '/api/google/status' })
      expect(status.json()).toMatchObject({ ativo: true, contaServico: EMAIL_TESTE, resumo: { pendentes: 1 } })
      expect(status.body).not.toContain('PRIVATE KEY')
    } finally {
      await app.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
