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
import { MSG_SEM_INTERNET, type FuncaoFetch } from './cliente.ts'
import { idGoogle } from './mapeamento.ts'
import { criarModuloGoogle, type ModuloGoogle } from './modulo.ts'
import { criarSimuladorGoogle, EMAIL_TESTE, erroGoogle, gerarContaServico } from './simuladorGoogle.ts'

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
  /** Permite segurar uma chamada ao Google até o teste liberar (simula a demora da rede). */
  let portao: ((url: string) => Promise<void>) | null = null
  const fetch: FuncaoFetch = async (url, init) => {
    if (portao) await portao(url)
    return sim.fetch(url, init)
  }
  const modulo: ModuloGoogle = criarModuloGoogle(ctx, { fetch, agora: () => relogio })
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
    definirPortao: (f: typeof portao) => (portao = f),
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

/** Chamadas que alteram a agenda (as leituras — teste da agenda, conferência — ficam de fora). */
const chamadasApi = () =>
  t.sim.chamadas
    .filter((c) => c.caminho !== 'token' && c.metodo !== 'GET')
    .map((c) => `${c.metodo} ${c.caminho.replace(/\/calendars\/[^/]+/, '')}`)
const syncDe = (e: Evento) => t.repo.obterEvento(e.id)?.google

const TABELAS_COPIA = ['eventos', 'meta', 'google_sync', 'google_estado']
/** Cópia das tabelas do banco (como uma cópia de segurança do .db). */
const copiarBanco = () => Object.fromEntries(TABELAS_COPIA.map((n) => [n, t.ctx.db.prepare(`SELECT * FROM ${n}`).all()]))
/** Volta a cópia por cima do banco atual (como copiar o .db antigo de volta para a pasta). */
function restaurarBanco(copia: ReturnType<typeof copiarBanco>) {
  const db = t.ctx.db
  for (const n of TABELAS_COPIA) {
    db.exec(`DELETE FROM ${n}`)
    for (const l of copia[n] as Array<Record<string, any>>) {
      const cols = Object.keys(l)
      db.prepare(`INSERT INTO ${n} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => l[c]))
    }
  }
}
/** Novo módulo sobre o mesmo banco (servidor reiniciado): inicia, processa a fila e para. */
async function reiniciarServidor() {
  const reiniciado = criarModuloGoogle(t.ctx, { fetch: t.sim.fetch, agora: t.agora })
  try {
    reiniciado.iniciar()
    await reiniciado.sincronizarAgora()
  } finally {
    reiniciado.parar()
  }
}

/** Segura a próxima chamada ao Google cujo endereço satisfaz `filtro`; `chegou` resolve quando ela acontece. */
function segurarChamada(filtro: (url: string) => boolean) {
  let liberar = () => {}
  let avisar = () => {}
  const chegou = new Promise<void>((r) => (avisar = r))
  t.definirPortao((url) =>
    filtro(url)
      ? new Promise<void>((r) => {
          liberar = r
          avisar()
        })
      : Promise.resolve(),
  )
  return {
    chegou,
    liberar() {
      t.definirPortao(null)
      liberar()
    },
  }
}

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
    // O app usa o fetch global: aponta para o Google simulado (ao ativar, a agenda é conferida)
    const sim = criarSimuladorGoogle(conta.chavePublica)
    sim.criarAgenda(AGENDA)
    vi.stubGlobal('fetch', sim.fetch)
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
      vi.unstubAllGlobals()
      await app.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

describe('robustez (revisão)', () => {
  const NOVA = 'nova@group.calendar.google.com'
  const datas = (agenda: string) =>
    t.sim.eventos(agenda).map((g) => [g.id, (g.start as { date: string }).date, (g.end as { date: string }).date])
  const donos = (agenda: string) =>
    t.sim.eventos(agenda).map((g) => (g.extendedProperties as { private: { bcFichasId: string } }).private.bcFichasId)

  it('recusa trocar para uma agenda inexistente (ou ativar com ela) e não toca na agenda atual', async () => {
    t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()

    const r = await t.req('PUT', '/api/google/config', { calendarId: 'erradoo@group.calendar.google.com' })
    expect(r.statusCode).toBe(400)
    expect(r.json().erro).toBe('Agenda não encontrada: confira o ID da agenda.')
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({ calendarId: AGENDA, resumo: { ok: 1 } })
    for (let i = 0; i < 3; i++) {
      t.avancar(60 * 60_000)
      await t.modulo.sincronizarAgora()
    }
    expect(t.sim.eventos(AGENDA)).toHaveLength(2)

    await t.req('PUT', '/api/google/config', { ativo: false })
    const ativar = await t.req('PUT', '/api/google/config', { ativo: true, calendarId: 'erradoo@group.calendar.google.com' })
    expect(ativar.statusCode).toBe(400)
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({ ativo: false, calendarId: AGENDA })
  })

  it('agenda nova sem permissão de edição: nada é apagado da anterior até a troca dar certo', async () => {
    const e1 = t.criarEvento()
    t.criarEvento({ nome: 'Quermesse' })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.criarAgenda(NOVA, 'leitura') // existe e pode ser lida, mas não alterada

    expect((await t.req('PUT', '/api/google/config', { calendarId: NOVA })).statusCode).toBe(200)
    for (let i = 0; i < 4; i++) {
      await t.modulo.sincronizarAgora()
      t.avancar(60 * 60_000)
    }
    expect(t.sim.eventos(AGENDA)).toHaveLength(4)
    expect(syncDe(e1)?.erro).toContain(EMAIL_TESTE)

    // Com a permissão corrigida, cria na nova e só então apaga da anterior
    t.sim.definirAcesso(NOVA, 'edicao')
    t.sim.limparChamadas()
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect(t.sim.eventos(NOVA)).toHaveLength(4)
    const ops = t.sim.chamadas.filter((c) => c.metodo !== 'GET' && c.caminho !== 'token').map((c) => c.caminho)
    const primeiraExclusao = ops.findIndex((c) => c.startsWith(`/calendars/${encodeURIComponent(AGENDA)}`))
    expect(primeiraExclusao).toBeGreaterThan(0)
    expect(ops.slice(0, primeiraExclusao).every((c) => c.startsWith(`/calendars/${encodeURIComponent(NOVA)}`))).toBe(true)
    expect((await t.req('GET', '/api/google/status')).json().resumo).toEqual({ ok: 2, pendentes: 0, erros: 0 })
  })

  it('voltar para a agenda anterior depois de uma troca que falhou não duplica nem apaga nada', async () => {
    t.criarEvento()
    t.criarEvento({ nome: 'Quermesse' })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.criarAgenda(NOVA, 'leitura')
    await t.req('PUT', '/api/google/config', { calendarId: NOVA })
    await t.modulo.sincronizarAgora()

    expect((await t.req('PUT', '/api/google/config', { calendarId: AGENDA })).statusCode).toBe(200)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toHaveLength(4)
    expect(t.sim.eventos(NOVA)).toEqual([])
    expect((await t.req('GET', '/api/google/status')).json().resumo).toEqual({ ok: 2, pendentes: 0, erros: 0 })
  })

  it('envio interrompido no meio: desfazer a edição reenvia tudo (o hash antigo não vale mais)', async () => {
    const dias = [
      { id: 'a', data: '2026-08-01', maquinas: 2 },
      { id: 'b', data: '2026-08-02', maquinas: 2 },
    ]
    const e = t.criarEvento({ dias })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    const b0 = idGoogle(e.id, 0)
    const b1 = idGoogle(e.id, 1)
    expect(datas(AGENDA)).toEqual([[b0, '2026-08-01', '2026-08-03']])

    // Dias 01 e 03: o PUT do b0 (só o dia 01) dá certo e a rede cai no b1
    t.sim.interceptar = (c, seguir) => {
      if (c.caminho.endsWith(b1)) throw new TypeError('fetch failed')
      return seguir()
    }
    t.repo.atualizarEvento(e.id, { ...e, dias: [dias[0], { id: 'b', data: '2026-08-03', maquinas: 2 }] })
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('erro')
    expect(datas(AGENDA)).toEqual([[b0, '2026-08-01', '2026-08-02']])

    // A rede volta e o usuário desfaz a edição
    t.sim.interceptar = null
    t.repo.atualizarEvento(e.id, { ...t.repo.obterEventoBruto(e.id)!, dias })
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('ok')
    expect(datas(AGENDA)).toEqual([[b0, '2026-08-01', '2026-08-03']])
  })

  it('bloco criado por um POST cuja resposta se perdeu é apagado quando deixa de existir', async () => {
    const e = t.criarEvento()
    await t.ativar()
    const b1 = idGoogle(e.id, 1)
    t.sim.interceptar = (c, seguir) => {
      const r = seguir()
      if (c.metodo === 'POST' && c.corpo?.id === b1) throw new TypeError('tempo esgotado')
      return r
    }
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('erro')
    expect(t.sim.eventos(AGENDA)).toHaveLength(2) // o Google aplicou o POST

    t.sim.interceptar = null
    t.repo.atualizarEvento(e.id, { ...e, dias: e.dias.filter((d) => d.data !== '2026-08-05') })
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).map((g) => g.id)).toEqual([idGoogle(e.id, 0)])
  })

  it('alterar o nome ou o telefone do cliente reenvia os eventos dele', async () => {
    const e = t.criarEvento()
    const cancelado = t.criarEvento({ nome: 'Cancelado', status: 'CANCELADO' })
    await t.ativar()
    await t.modulo.sincronizarAgora()

    // O e-mail não aparece no Google: nada a reenviar
    t.repo.atualizarCliente(t.cliente.id, { ...t.cliente, email: 'contato@padaria.com.br' })
    expect(syncDe(e)?.status).toBe('ok')

    t.sim.limparChamadas()
    const atual = t.repo.obterCliente(t.cliente.id)!
    t.repo.atualizarCliente(t.cliente.id, { ...atual, nome: 'Padaria Nova', telefone: '19911112222' })
    expect(syncDe(e)?.status).toBe('pendente')
    expect(syncDe(cancelado)).toBeUndefined()
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('ok')
    expect(chamadasApi()).toEqual([`PUT /events/${idGoogle(e.id, 0)}`, `PUT /events/${idGoogle(e.id, 1)}`])
    const g = t.sim.eventos(AGENDA)[0]
    expect(g.summary).toBe('Baile da Cidade — Padaria Nova (2–3 máquinas)')
    expect(String(g.description)).toContain('Telefone: 19911112222')
  })

  it('renomear uma máquina reenvia os eventos para onde ela foi enviada', async () => {
    const maquina = t.repo.criarMaquina({ tipo: 'P', identificacao: 'P-01' })
    const outra = t.repo.criarMaquina({ tipo: 'P', identificacao: 'P-02' })
    const e = t.criarEvento({ maquinasIds: [maquina.id] })
    const semEla = t.criarEvento({ nome: 'Quermesse', maquinasIds: [outra.id] })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    expect(String(t.sim.eventos(AGENDA).find((g) => g.id === idGoogle(e.id, 0))?.description)).toContain(
      'Máquinas enviadas: P-01',
    )

    // Mudar só o modelo não aparece no Google: nada a reenviar
    t.repo.atualizarMaquina(maquina.id, { ...maquina, modelo: 'Compacta' })
    expect(syncDe(e)?.status).toBe('ok')

    const atual = t.repo.obterMaquina(maquina.id)!
    t.repo.atualizarMaquina(maquina.id, { ...atual, identificacao: 'P-21' })
    expect(syncDe(e)?.status).toBe('pendente')
    expect(syncDe(semEla)?.status).toBe('ok')
    await t.modulo.sincronizarAgora()
    expect(String(t.sim.eventos(AGENDA).find((g) => g.id === idGoogle(e.id, 0))?.description)).toContain(
      'Máquinas enviadas: P-21',
    )
  })

  it('cliente alterado com a integração desativada: não marca eventos que nunca foram ao Google', async () => {
    const e = t.criarEvento()
    t.repo.atualizarCliente(t.cliente.id, { ...t.cliente, nome: 'Padaria Nova' })
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM google_sync').get()).toEqual({ n: 0 })
    expect(syncDe(e)).toBeUndefined()
  })

  it('troca de agenda com a API desativada ao apagar da anterior: tenta de novo e não deixa cópia duplicada', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.criarAgenda(NOVA)
    expect((await t.req('PUT', '/api/google/config', { calendarId: NOVA })).statusCode).toBe(200)

    t.sim.interceptar = (c, seguir) =>
      c.metodo === 'DELETE'
        ? erroGoogle(403, 'Google Calendar API has not been used in project 123 before or it is disabled.', 'accessNotConfigured')
        : seguir()
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)).toMatchObject({ status: 'erro', erro: expect.stringMatching(/não está ativada/) })
    expect(t.sim.eventos(NOVA)).toHaveLength(2)
    expect(t.sim.eventos(AGENDA)).toHaveLength(2)

    // A API volta a funcionar
    t.sim.interceptar = null
    t.avancar(30 * 60_000)
    await t.modulo.sincronizarAgora()
    expect(syncDe(e)?.status).toBe('ok')
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect(t.sim.eventos(NOVA)).toHaveLength(2)
  })

  it('excluir ou cancelar com a agenda inacessível (404) não é dado como feito', async () => {
    const e1 = t.criarEvento()
    const e2 = t.criarEvento({ nome: 'Quermesse' })
    await t.ativar()
    await t.modulo.sincronizarAgora()

    t.sim.definirAcesso(AGENDA, 'nenhum') // compartilhamento removido por engano
    t.repo.excluirEvento(e1.id)
    t.repo.alterarEvento(e2.id, { status: 'CANCELADO' })
    for (let i = 0; i < 3; i++) {
      await t.modulo.sincronizarAgora()
      t.avancar(60 * 60_000)
    }
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({
      ultimoErro: 'Agenda não encontrada: confira o ID da agenda.',
      resumo: { erros: 2 },
    })
    expect(syncDe(e2)?.status).toBe('erro')

    // O compartilhamento é refeito: as exclusões acontecem de fato
    t.sim.definirAcesso(AGENDA, 'edicao')
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toEqual([])
    expect((await t.req('GET', '/api/google/status')).json().resumo).toEqual({ ok: 0, pendentes: 0, erros: 0 })
  })

  it('ao iniciar, confere a agenda: corrige o Google depois de voltar uma cópia antiga do banco (.db)', async () => {
    const db = t.ctx.db
    const y = t.criarEvento({ nome: 'Y' })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    // Dia 1: cópia de segurança
    const copia = copiarBanco()

    // Dia 2: cria X (vai para o Google) e exclui Y (sai do Google)
    const x = t.criarEvento({ nome: 'X' })
    await t.modulo.sincronizarAgora()
    t.repo.excluirEvento(y.id)
    await t.modulo.sincronizarAgora()
    expect(new Set(donos(AGENDA))).toEqual(new Set([x.id]))

    // Dia 3: o .db do dia 1 é copiado por cima e o servidor é iniciado de novo
    t.modulo.parar()
    restaurarBanco(copia)
    expect(syncDe(y)?.status).toBe('ok') // o registro antigo diz que está no Google (não está)
    await reiniciarServidor()
    expect(donos(AGENDA)).toEqual([y.id, y.id])
    expect(db.prepare('SELECT status FROM google_sync WHERE evento_id = ?').get(y.id)).toEqual({ status: 'ok' })
  })

  it('ao iniciar, reenvia os eventos editados depois da cópia antiga do banco (.db) que voltou', async () => {
    const v = t.criarEvento({ nome: 'V', dias: [{ id: 'a', data: '2026-08-01', maquinas: 2 }] })
    const w = t.criarEvento({ nome: 'W', dias: [{ id: 'a', data: '2026-08-03', maquinas: 1 }] })
    await t.ativar()
    await t.modulo.sincronizarAgora()
    // Dia 1: cópia de segurança
    const copia = copiarBanco()

    // Dia 2: V é adiado, ganha outro bloco de datas e é finalizado (o Google recebe tudo)
    t.repo.atualizarEvento(v.id, {
      ...t.repo.obterEventoBruto(v.id)!,
      nome: 'V adiado',
      status: 'FINALIZADO',
      dias: [
        { id: 'a', data: '2026-09-10', maquinas: 2 },
        { id: 'b', data: '2026-09-11', maquinas: 2 },
        { id: 'c', data: '2026-09-20', maquinas: 1 },
      ],
    })
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).filter((g) => String(g.summary).startsWith('V adiado'))).toHaveLength(2)

    // Dia 3: o .db do dia 1 volta e o servidor é iniciado de novo
    t.modulo.parar()
    restaurarBanco(copia)
    expect(syncDe(v)?.status).toBe('ok') // o registro antigo confere com o conteúdo antigo do banco
    t.sim.limparChamadas()
    await reiniciarServidor()

    // O Google volta a mostrar o que está no sistema; W (que não mudou) não é reenviado
    expect(t.sim.eventos(AGENDA).map((g) => [g.summary, (g.start as { date: string }).date, g.colorId])).toEqual([
      ['V — Padaria Ideal (2 máquinas)', '2026-08-01', '9'],
      ['W — Padaria Ideal (1 máquina)', '2026-08-03', '9'],
    ])
    expect(chamadasApi().some((c) => c.includes(idGoogle(w.id, 0)))).toBe(false)
    expect([syncDe(v)?.status, syncDe(w)?.status]).toEqual(['ok', 'ok'])
  })

  it('cópias com conteúdo diferente ou sem impressão digital (versão antiga) são reenviadas na conferência diária', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    const [g0, g1] = t.sim.eventos(AGENDA)
    // g0 como enviado por uma versão antiga do sistema (sem bcHash); g1 com conteúdo trocado
    const { bcFichasId, codigo } = (g0.extendedProperties as { private: Record<string, string> }).private
    t.sim.inserir(AGENDA, { ...g0, summary: 'Antigo', extendedProperties: { private: { bcFichasId, codigo } } })
    t.sim.inserir(AGENDA, {
      ...g1,
      summary: 'Antigo',
      extendedProperties: { private: { bcFichasId, codigo, bcHash: 'conteudo-de-outra-epoca' } },
    })
    // Na rodada normal nada muda (o registro diz que está tudo enviado)…
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).map((g) => g.summary)).toEqual(['Antigo', 'Antigo'])

    // …e a conferência diária corrige
    t.avancar(24 * 60 * 60_000)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).map((g) => g.summary)).toEqual([
      'Baile da Cidade — Padaria Ideal (2–3 máquinas)',
      'Baile da Cidade — Padaria Ideal (1 máquina)',
    ])
    expect(syncDe(e)?.status).toBe('ok')
    // Depois de corrigido, a conferência seguinte não reenvia nada
    t.sim.limparChamadas()
    t.avancar(24 * 60 * 60_000)
    await t.modulo.sincronizarAgora()
    expect(t.sim.chamadas.some((c) => c.caminho.endsWith('/events') && c.metodo === 'GET')).toBe(true)
    expect(chamadasApi()).toEqual([])
  })

  it('PUT /api/google/config: alteração feita enquanto a agenda nova é testada não é desfeita', async () => {
    t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.criarAgenda(NOVA)

    // Segura o teste da agenda nova até as outras alterações chegarem
    const teste = segurarChamada((url) => url.endsWith(`/calendars/${encodeURIComponent(NOVA)}`))
    const troca = t.req('PUT', '/api/google/config', { calendarId: NOVA })
    await teste.chegou
    // Outro computador desativa e liga "Incluir valores" enquanto isso
    const desativar = t.req('PUT', '/api/google/config', { ativo: false })
    const valores = t.req('PUT', '/api/google/config', { incluirValores: true })
    await new Promise((r) => setTimeout(r, 20))
    teste.liberar()

    const [r1, r2, r3] = await Promise.all([troca, desativar, valores])
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([200, 200, 200])
    expect(r1.json()).toMatchObject({ ativo: true, calendarId: NOVA })
    expect(r2.json()).toMatchObject({ ativo: false, calendarId: NOVA })
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({
      ativo: false,
      calendarId: NOVA,
      incluirValores: true,
    })
  })

  it('remover a chave enquanto a agenda é testada não é desfeito pela ativação', async () => {
    expect((await t.req('POST', '/api/google/credenciais', { json: JSON.stringify(conta.json) })).statusCode).toBe(200)
    const teste = segurarChamada((url) => url.includes('/calendars/'))
    const ativar = t.req('PUT', '/api/google/config', { ativo: true, calendarId: AGENDA })
    await teste.chegou
    const remover = t.req('DELETE', '/api/google/credenciais')
    await new Promise((r) => setTimeout(r, 20))
    teste.liberar()

    const [r1, r2] = await Promise.all([ativar, remover])
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200])
    expect((await t.req('GET', '/api/google/status')).json()).toMatchObject({ configurado: false, ativo: false })
    // Ao enviar a chave de novo, a integração não volta ligada sozinha
    const r3 = await t.req('POST', '/api/google/credenciais', { json: JSON.stringify(conta.json) })
    expect(r3.json().ativo).toBe(false)
  })

  it('"Sincronizar tudo" apaga as cópias órfãs do sistema e não toca nos eventos criados à mão', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.tamanhoPagina = 1 // obriga a percorrer várias páginas
    const orfao = { bcFichasId: 'evento-que-nao-existe-mais', codigo: '#0099' }
    t.sim.inserir(AGENDA, { id: idGoogle(orfao.bcFichasId, 0), summary: 'Órfão', extendedProperties: { private: orfao } })
    t.sim.inserir(AGENDA, {
      id: idGoogle(e.id, 5),
      summary: 'Bloco perdido',
      extendedProperties: { private: { bcFichasId: e.id, codigo: '#0001' } },
    })
    t.sim.inserir(AGENDA, { id: 'reuniaofeitaamao1', summary: 'Reunião' })

    expect((await t.req('POST', '/api/google/sincronizar')).statusCode).toBe(200)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA).map((g) => g.summary)).toEqual([
      'Baile da Cidade — Padaria Ideal (2–3 máquinas)',
      'Baile da Cidade — Padaria Ideal (1 máquina)',
      'Reunião',
    ])
  })

  it('uma vez por dia confere a agenda e recria as cópias apagadas direto no Google', async () => {
    const e = t.criarEvento()
    await t.ativar()
    await t.modulo.sincronizarAgora()
    t.sim.apagar(AGENDA, idGoogle(e.id, 0))
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toHaveLength(1)

    t.avancar(24 * 60 * 60_000)
    await t.modulo.sincronizarAgora()
    expect(t.sim.eventos(AGENDA)).toHaveLength(2)
    expect(syncDe(e)?.status).toBe('ok')
  })

  it('quando a conexão volta, os outros eventos em erro de rede são enviados na hora', async () => {
    const e1 = t.criarEvento()
    const e2 = t.criarEvento({ nome: 'Quermesse' })
    await t.ativar()
    t.sim.offline = true
    await t.modulo.sincronizarAgora()
    t.avancar(1_000)
    await t.modulo.sincronizarAgora()
    expect([syncDe(e1)?.status, syncDe(e2)?.status]).toEqual(['erro', 'erro'])

    // A internet volta e um evento novo é enviado: os demais não esperam o próprio prazo
    t.sim.offline = false
    const e3 = t.criarEvento({ nome: 'Festa junina' })
    await t.modulo.sincronizarAgora()
    expect([syncDe(e1)?.status, syncDe(e2)?.status, syncDe(e3)?.status]).toEqual(['ok', 'ok', 'ok'])
    expect(t.sim.eventos(AGENDA)).toHaveLength(6)
  })

  it('sem internet, a espera entre tentativas não passa de 5 minutos', async () => {
    t.criarEvento()
    await t.ativar()
    t.sim.offline = true
    const proxima = () => (t.ctx.db.prepare('SELECT proxima_tentativa AS p FROM google_sync').get() as { p: number }).p
    for (let i = 0; i < 10; i++) {
      t.avancar(Math.max(0, proxima() - t.agora()))
      await t.modulo.sincronizarAgora()
    }
    expect(proxima() - t.agora()).toBe(5 * 60_000)
  })
})
