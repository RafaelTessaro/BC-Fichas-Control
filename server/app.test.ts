import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Cliente, Evento } from '#shared/tipos.ts'
import { criarApp } from './app.ts'

const H = { 'x-bc-fichas': '1' }

let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-'))
  ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null }))
})

afterEach(async () => {
  await app.close()
  rmSync(pasta, { recursive: true, force: true })
})

const clienteBase = { tipo: 'PJ', nome: 'Padaria Ideal', documento: '12.403.843/0001-18', cidade: 'Rio Claro', uf: 'SP' }
const eventoBase = (clienteId: string) => ({
  clienteId,
  nome: 'Baile da Cidade',
  dias: [
    { id: 'a', data: '2026-08-02', maquinas: 3 },
    { id: 'b', data: '2026-08-01', maquinas: 2 },
  ],
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 50,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'NAO_PAGO',
  status: 'EM_ABERTO',
})

async function criarCliente(dados: object = clienteBase) {
  const r = await app.inject({ method: 'POST', url: '/api/clientes', headers: H, payload: dados })
  expect(r.statusCode).toBe(201)
  return r.json() as Cliente
}

async function criarEvento(clienteId: string, extra: object = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/eventos', headers: H, payload: { ...eventoBase(clienteId), ...extra } })
  expect(r.statusCode, r.body).toBe(201)
  return r.json() as Evento
}

describe('API de dados', () => {
  it('começa vazia e informa a revisão', async () => {
    const r = await app.inject({ url: '/api/dados' })
    expect(r.json()).toMatchObject({ clientes: [], eventos: [], revisao: 0, config: { frotaMaquinas: 10 } })
  })

  it('bloqueia gravações sem o cabeçalho do app ou vindas de outro site', async () => {
    const semCabecalho = await app.inject({ method: 'POST', url: '/api/clientes', payload: clienteBase })
    expect(semCabecalho.statusCode).toBe(403)
    const outroSite = await app.inject({
      method: 'POST',
      url: '/api/clientes',
      headers: { ...H, origin: 'http://site-malicioso.com', host: 'localhost:3000' },
      payload: clienteBase,
    })
    expect(outroSite.statusCode).toBe(403)
    const mesmoSite = await app.inject({
      method: 'POST',
      url: '/api/clientes',
      headers: { ...H, origin: 'http://192.168.0.10:3000', host: '192.168.0.10:3000' },
      payload: clienteBase,
    })
    expect(mesmoSite.statusCode).toBe(201)
  })

  it('não deixa contornar a proteção com caminho codificado (/%61pi/...)', async () => {
    for (const url of ['/%61pi/exemplo', '/%61%70%69/backups', '/API/exemplo']) {
      const r = await app.inject({ method: 'POST', url, headers: { origin: 'http://evil.com', host: 'localhost:3000' } })
      expect(r.statusCode, url).toBe(403)
    }
    expect((await app.inject({ url: '/api/dados' })).json().clientes).toHaveLength(0)
  })

  it('valida e formata o cliente', async () => {
    const c = await criarCliente({ ...clienteBase, documento: '12403843000118', email: 'CONTATO@PADARIA.COM' })
    expect(c.documento).toBe('12.403.843/0001-18')
    expect(c.email).toBe('contato@padaria.com')
    expect(c.versao).toBe(1)

    const invalido = await app.inject({
      method: 'POST',
      url: '/api/clientes',
      headers: H,
      payload: { ...clienteBase, documento: '11.111.111/1111-11' },
    })
    expect(invalido.statusCode).toBe(400)
    expect(invalido.json().erro).toMatch(/CNPJ inválido/)
  })

  it('aceita cliente avulso sem documento', async () => {
    const c = await criarCliente({ tipo: 'AVULSO', nome: '', documento: '123' })
    expect(c).toMatchObject({ tipo: 'AVULSO', nome: 'Cliente avulso', documento: '' })
  })

  it('recusa CNPJ/CPF já cadastrado em outro cliente (409)', async () => {
    const c = await criarCliente()
    const r = await app.inject({ method: 'POST', url: '/api/clientes', headers: H, payload: { ...clienteBase, nome: 'Outra' } })
    expect(r.statusCode).toBe(409)
    expect(r.json().duplicado).toEqual({ id: c.id, nome: 'Padaria Ideal' })
    const outro = await criarCliente({ tipo: 'PJ', nome: 'Outra', documento: '' })
    const troca = await app.inject({
      method: 'PUT',
      url: `/api/clientes/${outro.id}`,
      headers: H,
      payload: { ...outro, documento: clienteBase.documento },
    })
    expect(troca.statusCode).toBe(409)
    // CNPJ alfanumérico (a partir de julho de 2026) é aceito, formatado e também conta para duplicidade
    const alfa = await criarCliente({ tipo: 'PJ', nome: 'Empresa Nova', documento: '12abc34501de35' })
    expect(alfa.documento).toBe('12.ABC.345/01DE-35')
    const alfaDup = await app.inject({
      method: 'POST',
      url: '/api/clientes',
      headers: H,
      payload: { tipo: 'PJ', nome: 'X', documento: '12.ABC.345/01DE-35' },
    })
    expect(alfaDup.statusCode).toBe(409)
    // avulsos sem documento não conflitam entre si
    await criarCliente({ tipo: 'AVULSO', nome: 'A' })
    await criarCliente({ tipo: 'AVULSO', nome: 'B' })
  })

  it('cadastros duplicados antigos (de backup) continuam editáveis', async () => {
    const backup = {
      app: 'bc-fichas-control',
      versao: 2,
      clientes: [
        { id: 'leg-1', tipo: 'PJ', nome: 'Legado 1', documento: '12.403.843/0001-18' },
        { id: 'leg-2', tipo: 'PJ', nome: 'Legado 2', documento: '12.403.843/0001-18' },
      ],
      eventos: [],
      config: {},
      proximoCodigo: 1,
    }
    expect((await app.inject({ method: 'POST', url: '/api/backup/restaurar', headers: H, payload: backup })).statusCode).toBe(200)
    const atual = (await app.inject({ url: '/api/dados' })).json().clientes.find((c: Cliente) => c.id === 'leg-1')
    const r = await app.inject({
      method: 'PUT',
      url: '/api/clientes/leg-1',
      headers: H,
      payload: { ...atual, telefone: '(19) 3333-4444' },
    })
    expect(r.statusCode, r.body).toBe(200)
  })

  it('detecta edição simultânea do mesmo cliente (409)', async () => {
    const c = await criarCliente()
    const r1 = await app.inject({
      method: 'PUT',
      url: `/api/clientes/${c.id}`,
      headers: H,
      payload: { ...c, nome: 'A', versao: 1 },
    })
    expect(r1.json().versao).toBe(2)
    const r2 = await app.inject({
      method: 'PUT',
      url: `/api/clientes/${c.id}`,
      headers: H,
      payload: { ...c, nome: 'B', versao: 1 },
    })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().atual.nome).toBe('A')
  })

  it('impede excluir cliente com eventos', async () => {
    const c = await criarCliente()
    await criarEvento(c.id)
    const r = await app.inject({ method: 'DELETE', url: `/api/clientes/${c.id}`, headers: H })
    expect(r.statusCode).toBe(409)
  })

  it('cria eventos com código sequencial e dias ordenados', async () => {
    const c = await criarCliente()
    const e1 = await criarEvento(c.id)
    const e2 = await criarEvento(c.id)
    expect([e1.codigo, e2.codigo]).toEqual([1, 2])
    expect(e1.dias.map((d) => d.data)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('recusa evento inválido com mensagem clara', async () => {
    const c = await criarCliente()
    const r = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: H,
      payload: { ...eventoBase(c.id), bobinasDevolvidas: 51 },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().erro).toMatch(/devolvidas/)
    const semCliente = await app.inject({ method: 'POST', url: '/api/eventos', headers: H, payload: eventoBase('nao-existe') })
    expect(semCliente.statusCode).toBe(400)
  })

  it('aplica alterações rápidas (pagamento) e completa a data', async () => {
    const c = await criarCliente()
    const e = await criarEvento(c.id)
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/eventos/${e.id}`,
      headers: H,
      payload: { formaPagamento: 'PIX', status: 'FINALIZADO' },
    })
    expect(r.json()).toMatchObject({ formaPagamento: 'PIX', status: 'FINALIZADO', versao: 2 })
    expect(r.json().dataPagamento).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('duplica como novo evento em aberto', async () => {
    const c = await criarCliente()
    const e = await criarEvento(c.id, { formaPagamento: 'PIX', status: 'FINALIZADO', bobinasDevolvidas: 10 })
    const r = await app.inject({ method: 'POST', url: `/api/eventos/${e.id}/duplicar`, headers: H })
    expect(r.json()).toMatchObject({ codigo: 2, status: 'EM_ABERTO', formaPagamento: 'NAO_PAGO', bobinasDevolvidas: null })
  })

  it('exporta e restaura o backup, criando cópia do banco antes', async () => {
    const c = await criarCliente()
    await criarEvento(c.id)
    const backup = (await app.inject({ url: '/api/backup' })).json()
    await app.inject({ method: 'POST', url: '/api/limpar', headers: H, payload: { confirmacao: 'APAGAR' } })
    expect((await app.inject({ url: '/api/dados' })).json().eventos).toHaveLength(0)

    const r = await app.inject({ method: 'POST', url: '/api/backup/restaurar', headers: H, payload: backup })
    expect(r.json()).toEqual({ clientes: 1, eventos: 1, maquinas: 0 })
    const novo = await criarEvento(c.id)
    expect(novo.codigo).toBe(2)
    const copias = (await app.inject({ url: '/api/backups' })).json().backups
    expect(copias.length).toBeGreaterThanOrEqual(1)
  })

  it('importa o backup da versão anterior (somente navegador)', async () => {
    const antigo = {
      app: 'bc-fichas-control',
      versao: 1,
      clientes: [
        { id: 'c1', nome: 'Cliente Antigo', tipo: 'PF', documento: '', endereco: 'Rua 1, 10', criadoEm: '2026-01-01T00:00:00Z' },
      ],
      eventos: [{ ...eventoBase('c1'), id: 'e1', codigo: 7 }],
      config: { valorDiariaPadrao: 90, valorBobinaPadrao: 5, frotaMaquinas: 12, rodapePadrao: 'OBRIGADO', empresa: {} },
      proximoCodigo: 8,
    }
    const r = await app.inject({ method: 'POST', url: '/api/backup/restaurar', headers: H, payload: antigo })
    expect(r.statusCode, r.body).toBe(200)
    const dados = (await app.inject({ url: '/api/dados' })).json()
    expect(dados.clientes[0]).toMatchObject({ logradouro: 'Rua 1, 10', versao: 1 })
    expect(dados.config).toMatchObject({
      valorDiariaPadrao: 90,
      valorBobinaPadrao: 5,
      frotaMaquinas: 12,
      rodapePadrao: 'OBRIGADO',
    })
    expect((await criarEvento('c1')).codigo).toBe(8)
  })

  it('mescla dados de vários computadores sem apagar o que já existe', async () => {
    const existente = await criarCliente()
    await criarEvento(existente.id)
    const doNavegador = (id: string, documento: string, codigo: number) => ({
      app: 'bc-fichas-control',
      versao: 1,
      clientes: [
        { id: `c-${id}`, nome: `Cliente ${id}`, tipo: 'PF', documento: '' },
        { id: `dup-${id}`, nome: 'Padaria (mesmo CNPJ)', tipo: 'PJ', documento },
      ],
      eventos: [
        { ...eventoBase(`c-${id}`), id: `e-${id}`, codigo },
        { ...eventoBase(`dup-${id}`), id: `e2-${id}`, codigo: codigo + 1 },
      ],
      config: { valorDiariaPadrao: 1, valorBobinaPadrao: 1, frotaMaquinas: 1, rodapePadrao: 'X' },
      proximoCodigo: 3,
    })
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/backup/mesclar',
      headers: H,
      payload: doNavegador('A', '12403843000118', 1),
    })

    expect(r1.json()).toEqual({ clientes: 1, eventos: 2, maquinas: 0, ordens: 0, reclamacoes: 0, contratos: 0, ignorados: 1 })
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/backup/mesclar',
      headers: H,
      payload: doNavegador('B', '12403843000118', 1),
    })
    expect(r2.json()).toEqual({ clientes: 1, eventos: 2, maquinas: 0, ordens: 0, reclamacoes: 0, contratos: 0, ignorados: 1 })
    // repetir o envio do mesmo computador não duplica
    const r3 = await app.inject({
      method: 'POST',
      url: '/api/backup/mesclar',
      headers: H,
      payload: doNavegador('A', '12403843000118', 1),
    })
    expect(r3.json()).toEqual({ clientes: 0, eventos: 0, maquinas: 0, ordens: 0, reclamacoes: 0, contratos: 0, ignorados: 4 })

    const dados = (await app.inject({ url: '/api/dados' })).json()
    expect(dados.clientes).toHaveLength(3)
    expect(dados.eventos).toHaveLength(5)
    expect(new Set(dados.eventos.map((e: Evento) => e.codigo)).size).toBe(5)
    expect(dados.eventos.filter((e: Evento) => e.clienteId === existente.id)).toHaveLength(3)
    expect(dados.config.frotaMaquinas).toBe(10)
    expect((await criarEvento(existente.id)).codigo).toBe(6)
  })

  it('só carrega o exemplo com o sistema vazio e exige confirmação para apagar', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/exemplo', headers: H })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/exemplo', headers: H })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/api/limpar', headers: H, payload: {} })).statusCode).toBe(400)
  })

  it('incrementa a revisão a cada gravação', async () => {
    const c = await criarCliente()
    await criarEvento(c.id)
    expect((await app.inject({ url: '/api/saude' })).json().revisao).toBe(2)
  })
})

describe('encerramento', () => {
  it('fecha rápido mesmo com navegadores conectados em tempo real', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as { port: number }
    const resp = await fetch(`http://127.0.0.1:${port}/api/stream`)
    const leitor = resp.body!.getReader()
    await leitor.read()
    const inicio = Date.now()
    await app.close()
    expect(Date.now() - inicio).toBeLessThan(2000)
    // reabre para o afterEach poder fechar novamente sem erro
    ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null }))
  })
})

describe('tempo real: conexões encerradas', () => {
  it('não derruba o servidor ao publicar para uma aba que acabou de fechar', async () => {
    const { TempoReal } = await import('./tempoReal.ts')
    const http = await import('node:http')
    const tr = new TempoReal(1_000_000)
    const erros: unknown[] = []
    const capturar = (e: unknown) => erros.push(e)
    process.on('uncaughtException', capturar)
    const srv = http.createServer((_req, res) => {
      tr.assinar(res, 0)
      res.end() // o navegador fechou: a resposta termina antes do evento 'close'
      tr.publicar({ revisao: 1, tipo: 'tudo', acao: 'recarregar' })
    })
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
    const { port } = srv.address() as { port: number }
    await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())
    await new Promise((ok) => setTimeout(ok, 100))
    process.off('uncaughtException', capturar)
    srv.close()
    tr.fechar()
    expect(erros).toEqual([])
    expect(tr.conectados).toBe(0)
  })
})

describe('tempo real', () => {
  it('envia as alterações para os navegadores conectados', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as { port: number }
    const ctrl = new AbortController()
    const resp = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: ctrl.signal })
    const leitor = resp.body!.getReader()
    const dec = new TextDecoder()
    let texto = ''
    const ler = async (ate: RegExp) => {
      while (!ate.test(texto)) texto += dec.decode((await leitor.read()).value)
    }
    await ler(/event: ola/)
    await criarCliente()
    await ler(/"tipo":"cliente"/)
    expect(texto).toMatch(/"acao":"salvo"/)
    ctrl.abort()
  })
})
