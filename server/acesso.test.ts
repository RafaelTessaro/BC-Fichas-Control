import { mkdtempSync, rmSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import nodemailer from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pode } from '#shared/permissoes.ts'
import type {
  Anexo,
  Cliente,
  Configuracoes,
  Contrato,
  DadosCompletos,
  Evento,
  Maquina,
  OrdemServico,
  Reclamacao,
} from '#shared/tipos.ts'
import { TABELA_ACESSO, instalarAcesso, lerCookie } from './acesso.ts'
import { criarApp, varrerSessoes } from './app.ts'
import { criarAppComLogin, H, SENHA_ADMIN, SENHA_COMUM, type AppComLogin } from './auxiliaresTeste.ts'
import { abrirBanco } from './db.ts'
import type { CriarTransporte } from './email.ts'
import type { Repositorio } from './repositorio.ts'
import { hashToken, PARAMETROS_LEVES, PARAMETROS_SENHA } from './senha.ts'
import { TempoReal } from './tempoReal.ts'
import { ServicoUsuarios } from './usuarios.ts'

/** Mensagens "enviadas" pelo transporte de teste. */
let enviados: unknown[] = []
const transporteTeste: CriarTransporte = () => {
  const t = nodemailer.createTransport({ jsonTransport: true })
  return {
    sendMail: async (msg: Record<string, unknown>) => {
      const info = await t.sendMail(msg)
      enviados.push(JSON.parse(String(info.message)))
      return info
    },
  } as unknown as ReturnType<CriarTransporte>
}

let t: AppComLogin

beforeEach(async () => {
  enviados = []
  t = await criarAppComLogin({ transporteEmail: transporteTeste })
})
afterEach(async () => {
  await t.fechar()
})

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Requisição de exemplo para uma entrada da tabela (ids falsos; corpo vazio nas gravações). */
function requisicaoDe(chave: string): { metodo: Metodo; url: string; payload?: object } {
  const [metodo, padrao] = chave.split(' ')
  if (metodo === 'ALL') return { metodo: 'GET', url: '/api/rota-que-nao-existe' }
  const url = padrao.replace(':id', 'id-falso').replace(':cnpj', 'abc').replace(':cep', 'abc')
  return { metodo: metodo as Metodo, url, ...(['POST', 'PUT', 'PATCH'].includes(metodo) ? { payload: {} } : {}) }
}

/** Ficam por último (nesta ordem): a troca de senha e o sair. */
const ENCERRAM_SESSAO = ['PUT /api/minha-senha', 'DELETE /api/sessao']

describe('tabela de acesso', () => {
  it('tem as 65 entradas, todas com rota registrada', async () => {
    expect(Object.keys(TABELA_ACESSO)).toHaveLength(65)
    await t.app.ready()
    for (const chave of Object.keys(TABELA_ACESSO)) {
      const { metodo, url } = requisicaoDe(chave)
      if (chave.startsWith('ALL')) continue
      expect(t.app.hasRoute({ method: metodo, url: chave.split(' ')[1] }), chave).toBe(true)
      expect(t.app.hasRoute({ method: 'HEAD', url: chave.split(' ')[1] }) || metodo !== 'GET', `HEAD ${url}`).toBe(true)
    }
  })

  it('rota /api sem classificação (ou com lista de métodos) não registra; entrada sem rota não sobe', async () => {
    const app = Fastify()
    const db = abrirBanco(':memory:')
    const tempoReal = new TempoReal()
    try {
      instalarAcesso(app, { usuarios: new ServicoUsuarios(db), tempoReal, repo: {} as Repositorio }, { nomeCookie: 'bcf_sessao' })
      expect(() => app.get('/api/x', async () => 'x')).toThrow('Rota sem classificação de acesso: GET /api/x')
      expect(() => app.route({ method: ['GET', 'POST'], url: '/api/y', handler: async () => 'y' })).toThrow(/lista de métodos/)
      expect(() => app.route({ method: ['GET', 'POST'], url: '/api/dados', handler: async () => 'y' })).toThrow(
        /lista de métodos/,
      )
      // Fora de /api: livre (interface compilada)
      expect(() => app.get('/pagina', async () => 'ok')).not.toThrow()
      app.get('/api/saude', async () => ({ ok: true }))
      await expect(app.ready()).rejects.toThrow(/Entradas da tabela de acesso sem rota registrada: .*GET \/api\/dados/)
    } finally {
      tempoReal.fechar()
      db.close()
    }
  })

  it('sem sessão: 401 em tudo que não é público; o tempo real responde semSessao', async () => {
    for (const [chave, regra] of Object.entries(TABELA_ACESSO)) {
      if (regra === 'publico') continue
      const { metodo, url, payload } = requisicaoDe(chave)
      const r = await t.chamar(metodo, url, { payload })
      if (chave === 'GET /api/stream') {
        expect(r.statusCode).toBe(200)
        expect(r.body).toContain('"semSessao":true')
      } else {
        expect(r.statusCode, chave).toBe(401)
        expect(r.json(), chave).toEqual({ erro: 'Sua sessão terminou. Entre de novo para continuar.', codigo: 'SEM_SESSAO' })
      }
    }
  })

  it('comum: 403 SEM_PERMISSAO no que é só do administrador; o resto passa do controle de acesso', async () => {
    const entradas = Object.entries(TABELA_ACESSO).filter(([c]) => c !== 'GET /api/stream' && !ENCERRAM_SESSAO.includes(c))
    for (const [chave, regra] of [...entradas, ...ENCERRAM_SESSAO.map((c) => [c, TABELA_ACESSO[c]] as const)]) {
      const { metodo, url, payload } = requisicaoDe(chave)
      const r = await t.chamar(metodo, url, { cookie: t.cookieComum, payload })
      if (regra !== 'publico' && regra !== 'logado' && !pode('COMUM', regra)) {
        expect(r.statusCode, chave).toBe(403)
        expect(r.json(), chave).toMatchObject({ codigo: 'SEM_PERMISSAO', permissao: regra })
      } else {
        expect([401, 403], `${chave}: ${r.body}`).not.toContain(r.statusCode)
        expect(r.statusCode, `${chave}: ${r.body}`).toBeLessThan(500)
      }
    }
  })

  it('administrador nunca recebe 401 nem 403 (um cookie novo por requisição)', async () => {
    const entradas = Object.keys(TABELA_ACESSO).filter((c) => c !== 'GET /api/stream' && !ENCERRAM_SESSAO.includes(c))
    for (const chave of [...entradas, ...ENCERRAM_SESSAO]) {
      const { metodo, url, payload } = requisicaoDe(chave)
      const cookie = await t.cookieDe('admin', SENHA_ADMIN)
      const r = await t.chamar(metodo, url, { cookie, payload })
      expect([401, 403], `${chave}: ${r.body}`).not.toContain(r.statusCode)
      expect(r.statusCode, `${chave}: ${r.body}`).toBeLessThan(500)
    }
  })
})

describe('contornos', () => {
  it('caminho codificado e HEAD não escapam do controle', async () => {
    expect((await t.chamar('GET', '/%61pi/dados')).statusCode).toBe(401)
    expect((await t.chamar('HEAD', '/api/dados')).statusCode).toBe(401)
    expect((await t.chamar('GET', '/%61pi/dados', { cookie: t.cookieComum })).statusCode).toBe(200)
    expect((await t.chamar('GET', '/%61pi/backup', { cookie: t.cookieComum })).statusCode).toBe(403)
    expect((await t.chamar('HEAD', '/api/backup', { cookie: t.cookieComum })).statusCode).toBe(403)
  })

  it('tempo real sem sessão: 200 em SSE com semSessao, e a resposta termina', async () => {
    for (const url of ['/api/stream', '/%61pi/stream']) {
      const r = await t.chamar('GET', url, { cookie: 'cookie-velho' })
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toBe('text/event-stream; charset=utf-8')
      expect(r.headers['cache-control']).toBe('no-store')
      expect(r.body).toBe('retry: 3000\nevent: ola\ndata: {"revisao":-1,"build":"","semSessao":true}\n\n')
    }
  })

  it('/api/saude: completa pelo próprio computador; pela rede, só ok e versão', async () => {
    const local = await t.chamar('GET', '/api/saude')
    expect(local.statusCode).toBe(200)
    expect(Object.keys(local.json()).sort()).toEqual(['build', 'conectados', 'horario', 'ok', 'revisao', 'versao'])
    const rede = await t.chamar('GET', '/api/saude', { remoteAddress: '192.168.0.20' })
    expect(rede.statusCode).toBe(200)
    expect(Object.keys(rede.json()).sort()).toEqual(['ok', 'versao'])
  })

  it('rota inexistente sem sessão: 404', async () => {
    expect((await t.chamar('GET', '/api/nao-existe')).statusCode).toBe(404)
    expect((await t.chamar('POST', '/api/nao-existe', { payload: {} })).statusCode).toBe(404)
    expect((await t.chamar('GET', '/%61pi/nao-existe')).statusCode).toBe(404)
  })

  it('aberto em aba nova (Accept: text/html) sem sessão: página curta em vez de JSON', async () => {
    const r = await t.chamar('GET', '/api/anexos/x', { headers: { accept: 'text/html,application/xhtml+xml' } })
    expect(r.statusCode).toBe(401)
    expect(r.headers['content-type']).toMatch(/^text\/html/)
    expect(r.body).toContain('Sua sessão terminou. Volte ao BC Fichas e entre de novo.')
  })

  it('upload sem permissão é recusado antes de ler o corpo', async () => {
    const r = await t.chamar('POST', '/api/backup/restaurar', {
      cookie: t.cookieComum,
      payload: '{"isto nem é": json válido',
      headers: { 'content-type': 'application/json' },
    })
    expect(r.statusCode).toBe(403)
  })

  it('lerCookie: pega o cookie certo entre vários', () => {
    expect(lerCookie('a=1; bcf_sessao=abc; bcf_sessao_3000=def', 'bcf_sessao')).toBe('abc')
    expect(lerCookie('bcf_sessao_3000=def', 'bcf_sessao')).toBeUndefined()
    expect(lerCookie('bcf_sessao=', 'bcf_sessao')).toBeUndefined()
    expect(lerCookie(undefined, 'bcf_sessao')).toBeUndefined()
  })
})

describe('regras finas do comum', () => {
  const comum = (metodo: Metodo, url: string, payload?: unknown) => t.chamar(metodo, url, { cookie: t.cookieComum, payload })
  const admin = (metodo: Metodo, url: string, payload?: unknown) => t.chamar(metodo, url, { cookie: t.cookieAdmin, payload })
  const maquina = async (id: string) =>
    ((await admin('GET', '/api/dados')).json() as DadosCompletos).maquinas.find((m) => m.id === id)!

  it('F1: alterna Disponível/Manutenção; o resto do cadastro fica como está; desativar e reativar, não', async () => {
    const m = (await admin('POST', '/api/maquinas', { tipo: 'P', identificacao: 'P-01', modelo: 'Compacta' })).json() as Maquina
    expect((await comum('POST', '/api/maquinas', { tipo: 'P', identificacao: 'P-02' })).json()).toMatchObject({
      codigo: 'SEM_PERMISSAO',
      permissao: 'gerenciarFrota',
    })
    const manut = await comum('PUT', `/api/maquinas/${m.id}`, { ...m, status: 'MANUTENCAO' })
    expect(manut.statusCode, manut.body).toBe(200)
    expect(manut.json()).toMatchObject({ status: 'MANUTENCAO', versao: 2 })
    const outra = await comum('PUT', `/api/maquinas/${m.id}`, {
      ...m,
      identificacao: 'X-99',
      modelo: 'Outro',
      observacoes: 'trocado pelo comum',
      status: 'DISPONIVEL',
      versao: 2,
    })
    expect(outra.statusCode).toBe(200)
    expect(await maquina(m.id)).toMatchObject({
      identificacao: 'P-01',
      modelo: 'Compacta',
      observacoes: '',
      status: 'DISPONIVEL',
      versao: 3,
    })
    const desativar = await comum('PUT', `/api/maquinas/${m.id}`, { ...m, status: 'DESATIVADA', versao: 3 })
    expect(desativar.statusCode).toBe(403)
    expect(desativar.json().erro).toBe('Só o administrador desativa ou reativa máquinas.')
    expect((await admin('PUT', `/api/maquinas/${m.id}`, { ...m, status: 'DESATIVADA', versao: 3 })).statusCode).toBe(200)
    expect((await comum('PUT', `/api/maquinas/${m.id}`, { ...m, status: 'DISPONIVEL', versao: 4 })).statusCode).toBe(403)
    // Tela desatualizada: o 409 de conflito, não um 403 enganoso
    const velha = await comum('PUT', `/api/maquinas/${m.id}`, { ...m, status: 'MANUTENCAO', versao: 2 })
    expect(velha.statusCode).toBe(409)
    expect((await maquina(m.id)).status).toBe('DESATIVADA')
    expect((await comum('PUT', '/api/maquinas/nao-existe', { ...m, status: 'MANUTENCAO' })).statusCode).toBe(404)
  })

  it('F2: a O.S. do comum não desativa nem reativa a máquina; registrar O.S. numa desativada pode', async () => {
    const ativa = (await admin('POST', '/api/maquinas', { tipo: 'P', identificacao: 'P-01' })).json() as Maquina
    const parada = (
      await admin('POST', '/api/maquinas', { tipo: 'P', identificacao: 'P-02', status: 'DESATIVADA' })
    ).json() as Maquina
    expect(parada.status).toBe('DESATIVADA')
    const os = (maquinaId: string, extra: object = {}) => ({
      maquinaId,
      abertura: '2026-09-01',
      problema: 'Papel enroscando',
      ...extra,
    })
    expect((await comum('POST', '/api/ordens', os(ativa.id, { statusMaquina: 'DESATIVADA' }))).statusCode).toBe(403)
    expect((await comum('POST', '/api/ordens', os(parada.id, { statusMaquina: 'MANUTENCAO' }))).statusCode).toBe(403)
    const historico = await comum('POST', '/api/ordens', os(parada.id))
    expect(historico.statusCode).toBe(201)
    const aberta = await comum('POST', '/api/ordens', os(ativa.id, { statusMaquina: 'MANUTENCAO' }))
    expect(aberta.statusCode).toBe(201)
    expect((await maquina(ativa.id)).status).toBe('MANUTENCAO')
    const o = aberta.json() as OrdemServico
    expect((await comum('PUT', `/api/ordens/${o.id}`, { ...o, statusMaquina: 'DESATIVADA' })).statusCode).toBe(403)
    const concluida = await comum('PUT', `/api/ordens/${o.id}`, {
      ...o,
      status: 'CONCLUIDA',
      conclusao: '2026-09-02',
      statusMaquina: 'DISPONIVEL',
    })
    expect(concluida.statusCode, concluida.body).toBe(200)
    expect((await maquina(ativa.id)).status).toBe('DISPONIVEL')
    // O administrador pode
    expect((await admin('POST', '/api/ordens', os(ativa.id, { statusMaquina: 'DESATIVADA' }))).statusCode).toBe(201)
  })

  it('F3: o comum só acrescenta serviços (remoções e renomeações são ignoradas)', async () => {
    await admin('PUT', '/api/config/servicos', { servicos: ['Limpeza', 'Troca de bobina'] })
    const r = await comum('PUT', '/api/config/servicos', { servicos: ['limpeza', 'Calibração'] })
    expect(r.statusCode).toBe(200)
    expect((r.json() as Configuracoes).servicosManutencao).toEqual(['Limpeza', 'Troca de bobina', 'Calibração'])
    expect((await comum('PUT', '/api/config/servicos', { servicos: 'x' })).statusCode).toBe(400)
    const doAdmin = await admin('PUT', '/api/config/servicos', { servicos: ['Calibração'] })
    expect((doAdmin.json() as Configuracoes).servicosManutencao).toEqual(['Calibração'])
  })
})

describe('o comum faz o dia a dia', () => {
  const comum = (metodo: Metodo, url: string, payload?: unknown, headers?: Record<string, string>) =>
    t.chamar(metodo, url, { cookie: t.cookieComum, payload, headers })
  const esperar = async (p: ReturnType<typeof comum>, status: number) => {
    const r = await p
    expect(r.statusCode, r.body).toBe(status)
    return r
  }
  const arquivo = (nome: string, tipo: string) => ({
    'content-type': 'application/octet-stream',
    'x-nome': encodeURIComponent(nome),
    'x-tipo': tipo,
  })

  it('clientes, eventos, pagamento, O.S., reclamações, anexos, contratos e e-mail', async () => {
    await esperar(comum('GET', '/api/dados'), 200)
    const cli = (
      await esperar(comum('POST', '/api/clientes', { tipo: 'PF', nome: 'Juliana Martins', documento: '529.982.247-25' }), 201)
    ).json() as Cliente
    await esperar(comum('PUT', `/api/clientes/${cli.id}`, { ...cli, telefone: '(19) 99999-0000' }), 200)
    const ev = (
      await esperar(
        comum('POST', '/api/eventos', {
          clienteId: cli.id,
          nome: 'Aniversário',
          dias: [{ data: '2099-05-10', maquinas: 2, reservas: 1 }],
          valorDiaria: 50,
          status: 'EM_ABERTO',
        }),
        201,
      )
    ).json() as Evento
    const editado = (
      await esperar(comum('PUT', `/api/eventos/${ev.id}`, { ...ev, nome: 'Aniversário 15 anos' }), 200)
    ).json() as Evento
    await esperar(
      comum('PATCH', `/api/eventos/${ev.id}`, { formaPagamento: 'PIX', dataPagamento: '2026-08-02', versao: editado.versao }),
      200,
    )
    await esperar(comum('POST', `/api/eventos/${ev.id}/duplicar`), 201)
    await esperar(comum('POST', `/api/eventos/${ev.id}/repetir`, { datas: ['2099-06-10'] }), 201)
    await esperar(comum('DELETE', `/api/eventos/${ev.id}`), 403)
    await esperar(comum('DELETE', `/api/clientes/${cli.id}`), 403)

    const m = (
      await t.chamar('POST', '/api/maquinas', { cookie: t.cookieAdmin, payload: { tipo: 'P', identificacao: 'P-01' } })
    ).json() as Maquina
    const os = (
      await esperar(comum('POST', '/api/ordens', { maquinaId: m.id, abertura: '2026-09-01', problema: 'Travando' }), 201)
    ).json() as OrdemServico
    await esperar(comum('PUT', `/api/ordens/${os.id}`, { ...os, problema: 'Travando muito' }), 200)
    await esperar(comum('DELETE', `/api/ordens/${os.id}`), 403)
    const rec = (
      await esperar(comum('POST', '/api/reclamacoes', { maquinaId: m.id, eventoId: ev.id, descricao: 'Travando' }), 201)
    ).json() as Reclamacao
    await esperar(comum('PUT', `/api/reclamacoes/${rec.id}`, { ...rec, descricao: 'Travando e reiniciando' }), 200)
    await esperar(comum('DELETE', `/api/reclamacoes/${rec.id}`), 204)

    const anexo = (
      await esperar(
        comum('POST', `/api/eventos/${ev.id}/anexos`, Buffer.from('conversa'), arquivo('print.txt', 'text/plain')),
        201,
      )
    ).json() as Anexo
    expect((await esperar(comum('GET', `/api/anexos/${anexo.id}`), 200)).body).toBe('conversa')
    await esperar(comum('DELETE', `/api/anexos/${anexo.id}`), 204)

    const contrato = (
      await esperar(
        comum('POST', '/api/contratos', {
          eventoId: ev.id,
          local: 'Salão',
          retirada: { data: '2099-05-09', hora: '16:00' },
          devolucao: { data: '2099-05-11', hora: '' },
          assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
          condicoes: '',
        }),
        201,
      )
    ).json() as Contrato
    const pdf = arquivo('Contrato assinado.pdf', 'application/pdf')
    await esperar(comum('POST', `/api/contratos/${contrato.id}/arquivo`, Buffer.from('%PDF-1 a'), pdf), 200)
    await esperar(comum('POST', `/api/contratos/${contrato.id}/arquivo`, Buffer.from('%PDF-1 b'), pdf), 200) // trocar a cópia
    expect((await esperar(comum('GET', `/api/contratos/${contrato.id}/arquivo`), 200)).body).toBe('%PDF-1 b')
    await esperar(comum('DELETE', `/api/contratos/${contrato.id}/arquivo`), 403)
    await esperar(comum('DELETE', `/api/contratos/${contrato.id}`), 403)
    await esperar(comum('PATCH', `/api/contratos/${contrato.id}`, { acao: 'cancelar' }), 200)

    // E-mail: configurado pelo administrador; o comum envia e vê só o essencial da configuração
    const config = {
      servidor: 'smtp.exemplo.com',
      porta: 587,
      seguranca: 'STARTTLS',
      usuario: 'recibos@exemplo.com',
      senha: 'segredo',
      remetenteNome: 'Balanças.com',
      remetenteEmail: 'recibos@exemplo.com',
    }
    await esperar(comum('PUT', '/api/email/config', config), 403)
    expect((await t.chamar('PUT', '/api/email/config', { cookie: t.cookieAdmin, payload: config })).statusCode).toBe(200)
    expect((await esperar(comum('GET', '/api/email/config'), 200)).json()).toEqual({
      configurado: true,
      remetenteNome: 'Balanças.com',
      remetenteEmail: 'recibos@exemplo.com',
    })
    const doAdmin = (await t.chamar('GET', '/api/email/config', { cookie: t.cookieAdmin })).json()
    expect(doAdmin).toMatchObject({ servidor: 'smtp.exemplo.com', usuario: 'recibos@exemplo.com', senhaDefinida: true })
    await esperar(comum('POST', '/api/email/enviar', { para: 'cliente@x.com', assunto: 'Recibo', texto: 'Segue.' }), 200)
    expect(enviados).toHaveLength(1)
    await esperar(comum('POST', '/api/email/teste', { para: 'cliente@x.com' }), 403)
  })
})

describe('tempo real', () => {
  it('desativar a conta fecha o tempo real dela em menos de 1 s; a reconexão recebe semSessao', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = t.app.server.address() as { port: number }
    const abrir = () => fetch(`http://127.0.0.1:${port}/api/stream`, { headers: { cookie: `bcf_sessao=${t.cookieComum}` } })
    const resp = await abrir()
    const leitor = resp.body!.getReader()
    const dec = new TextDecoder()
    let texto = ''
    while (!/event: ola/.test(texto)) texto += dec.decode((await leitor.read()).value)
    expect(texto).not.toContain('semSessao')
    expect(t.ctx.tempoReal.sessoesConectadas()).toEqual([hashToken(t.cookieComum)])

    const inicio = Date.now()
    await t.chamar('PUT', `/api/usuarios/${t.comumId}`, { cookie: t.cookieAdmin, payload: { ativo: false } })
    let fim = false
    while (!fim) fim = (await leitor.read()).done
    expect(Date.now() - inicio).toBeLessThan(1000)

    const reconexao = await abrir()
    expect(reconexao.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(await reconexao.text()).toContain('"semSessao":true')
  })

  it('a varredura fecha o tempo real das sessões apagadas por fora (ferramenta local)', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = t.app.server.address() as { port: number }
    const resp = await fetch(`http://127.0.0.1:${port}/api/stream`, { headers: { cookie: `bcf_sessao=${t.cookieAdmin}` } })
    const leitor = resp.body!.getReader()
    await leitor.read()
    expect(varrerSessoes(t.usuarios, t.ctx.tempoReal)).toEqual([])
    t.usuarios.encerrarTodasAsSessoes() // o que a ferramenta faz, sem passar pelo servidor
    expect(varrerSessoes(t.usuarios, t.ctx.tempoReal)).toEqual([hashToken(t.cookieAdmin)])
    let fim = false
    while (!fim) fim = (await leitor.read()).done
    expect(t.ctx.tempoReal.sessoesConectadas()).toEqual([])
  })

  it('encerrarSessoes, encerrarUsuario e sessoesConectadas', () => {
    const tr = new TempoReal(1_000_000)
    const falsa = () => {
      const r = { encerrada: false, writeHead: () => r, write: () => true, on: () => r, end: () => void (r.encerrada = true) }
      return r
    }
    const [a, b, c, semDono] = [falsa(), falsa(), falsa(), falsa()]
    tr.assinar(a as unknown as ServerResponse, 1, { sessaoId: 's1', usuarioId: 'u1' })
    tr.assinar(b as unknown as ServerResponse, 1, { sessaoId: 's2', usuarioId: 'u2' })
    tr.assinar(c as unknown as ServerResponse, 1, { sessaoId: 's3', usuarioId: 'u2' })
    tr.assinar(semDono as unknown as ServerResponse, 1)
    expect(tr.sessoesConectadas().sort()).toEqual(['s1', 's2', 's3'])
    expect(tr.conectados).toBe(4)
    tr.encerrarSessoes(['s1', 'outra'])
    expect([a.encerrada, b.encerrada, c.encerrada]).toEqual([true, false, false])
    tr.encerrarUsuario('u2')
    expect([b.encerrada, c.encerrada, semDono.encerrada]).toEqual([true, true, false])
    expect(tr.sessoesConectadas()).toEqual([])
    expect(tr.conectados).toBe(1)
    tr.fechar()
    expect(semDono.encerrada).toBe(true)
  })
})

describe('opção dos testes antigos', () => {
  it('acesso livre: o usuário fictício; Host, CSRF e tabela continuam valendo', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'bcf-livre-'))
    const { app } = await criarApp({
      pastaDados: pasta,
      arquivoBanco: ':memory:',
      pastaEstatica: null,
      acessoLivreParaTestes: true,
    })
    try {
      expect((await app.inject({ url: '/api/sessao' })).json().usuario).toEqual({
        id: 'teste',
        login: 'teste',
        nome: 'Teste',
        nivel: 'ADMIN',
        trocarSenha: false,
      })
      expect((await app.inject({ url: '/api/backup' })).statusCode).toBe(200)
      expect(
        (await app.inject({ method: 'POST', url: '/api/clientes', payload: { tipo: 'AVULSO', nome: 'X' } })).statusCode,
      ).toBe(403)
      expect((await app.inject({ url: '/api/dados', headers: { host: 'site-de-fora.com' } })).statusCode).toBe(403)
      expect(
        (await app.inject({ method: 'POST', url: '/api/clientes', headers: H, payload: { tipo: 'AVULSO', nome: 'X' } }))
          .statusCode,
      ).toBe(201)
    } finally {
      await app.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('fora do vitest, o acesso livre e o hash leve fazem o criarApp recusar', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'bcf-trava-'))
    const vitest = process.env.VITEST
    delete process.env.VITEST
    try {
      const base = { pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null }
      await expect(criarApp({ ...base, acessoLivreParaTestes: true })).rejects.toThrow('só valem nos testes')
      await expect(criarApp({ ...base, parametrosSenha: PARAMETROS_LEVES })).rejects.toThrow('só valem nos testes')
      const { app } = await criarApp({ ...base, parametrosSenha: PARAMETROS_SENHA })
      await app.close()
    } finally {
      process.env.VITEST = vitest
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('o login de verdade não aceita o acesso livre por engano', async () => {
    expect((await t.chamar('GET', '/api/dados')).statusCode).toBe(401)
    expect((await t.chamar('GET', '/api/sessao')).json().usuario).toBeNull()
    expect(SENHA_COMUM).not.toBe(SENHA_ADMIN)
  })
})
