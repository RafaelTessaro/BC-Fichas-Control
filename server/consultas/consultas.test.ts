import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { criarApp } from '../app.ts'
import { ErroApi } from '../erros.ts'
import { rotasConsultas } from '../rotas/consultas.ts'
import { PROVEDORES_CEP } from './cep.ts'
import { PROVEDORES_CNPJ } from './cnpj.ts'
import { CacheTemporario, consultarEmOrdem, type Fetch } from './motor.ts'
import { criarServicoConsultas, MENSAGENS } from './servico.ts'
import { formatarTelefone, formatoTitulo, juntarLogradouro } from './texto.ts'

const fixture = (nome: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', nome), 'utf8'))

const CNPJ = '12403843000118'
const CEP = '13504000'

type Resposta = { status: number; corpo?: unknown } | 'rede' | 'tempo'

/** `fetch` falso: responde conforme o início da URL e registra as chamadas. */
function fetchFalso(rotas: Record<string, Resposta | Resposta[]>) {
  const chamadas: string[] = []
  const contagem = new Map<string, number>()
  const f = (async (entrada: string | URL | Request) => {
    const url = String(entrada)
    chamadas.push(url)
    const chave = Object.keys(rotas).find((k) => url.startsWith(k))
    if (!chave) throw new TypeError('fetch failed')
    const n = contagem.get(chave) ?? 0
    contagem.set(chave, n + 1)
    const regra = rotas[chave]
    const r = Array.isArray(regra) ? regra[Math.min(n, regra.length - 1)] : regra
    if (r === 'rede') throw new TypeError('fetch failed')
    if (r === 'tempo') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as Fetch
  return { fetch: f, chamadas }
}

const BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1/'
const CNPJWS = 'https://publica.cnpj.ws/cnpj/'
const MINHA_RECEITA = 'https://minhareceita.org/'
const BRASILAPI_CEP = 'https://brasilapi.com.br/api/cep/v2/'
const VIACEP = 'https://viacep.com.br/ws/'
const OPENCEP = 'https://opencep.com/v1/'

const ESPERADO_EMPRESA = {
  cnpj: '12.403.843/0001-18',
  razaoSocial: 'FABIO DE GODOY LIMA LTDA',
  nomeFantasia: 'Balancas.com',
  nomeSugerido: 'Balancas.com',
  situacaoCadastral: 'ATIVA',
  dataAbertura: '2010-08-05',
  atividadePrincipal: 'Comércio varejista especializado de equipamentos e suprimentos de informática',
  telefone: '(19) 8118-2225',
  cep: '13500-120',
  logradouro: 'Rua 13',
  numero: '650',
  complemento: '',
  bairro: 'Bairro da Boa Morte',
  cidade: 'Rio Claro',
  uf: 'SP',
}

describe('formato de título', () => {
  it('converte maiúsculas da Receita mantendo preposições, siglas e números', () => {
    expect(formatoTitulo('BAIRRO DA BOA MORTE')).toBe('Bairro da Boa Morte')
    expect(formatoTitulo('FABIO DE GODOY LIMA LTDA')).toBe('Fabio de Godoy Lima LTDA')
    expect(formatoTitulo('PADARIA E CONFEITARIA DOS AMIGOS ME')).toBe('Padaria e Confeitaria dos Amigos ME')
    expect(formatoTitulo('COMERCIO DAS FLORES EIRELI EPP')).toBe('Comercio das Flores EIRELI EPP')
    expect(formatoTitulo('BANCO XYZ S/A')).toBe('Banco Xyz S/A')
    expect(formatoTitulo('CIA. PAULISTA DE FORCA')).toBe('CIA. Paulista de Forca')
    expect(formatoTitulo('JOAO DA SILVA MEI')).toBe('Joao da Silva MEI')
    expect(formatoTitulo('AVENIDA XV DE NOVEMBRO')).toBe('Avenida XV de Novembro')
    expect(formatoTitulo('RUA 13 BLOCO 2A')).toBe('Rua 13 Bloco 2A')
    expect(formatoTitulo('SANTA BARBARA D’OESTE')).toBe('Santa Barbara D’Oeste')
    expect(formatoTitulo('SÃO JOSÉ DO RIO PRETO')).toBe('São José do Rio Preto')
    expect(formatoTitulo('  DE   OLHO NO PREÇO ')).toBe('De Olho No Preço')
    expect(formatoTitulo('')).toBe('')
    expect(formatoTitulo(null)).toBe('')
  })

  it('monta o logradouro com o tipo sem repetir', () => {
    expect(juntarLogradouro('RUA', '13')).toBe('Rua 13')
    expect(juntarLogradouro('AVENIDA', 'AVENIDA BRASIL')).toBe('Avenida Brasil')
    expect(juntarLogradouro('', 'ESTRADA VELHA')).toBe('Estrada Velha')
    expect(juntarLogradouro('RUA', '')).toBe('')
  })

  it('formata telefones com DDD', () => {
    expect(formatarTelefone('1981182225')).toBe('(19) 8118-2225')
    expect(formatarTelefone('19', '981182225')).toBe('(19) 98118-2225')
    expect(formatarTelefone('81182225')).toBe('')
    expect(formatarTelefone(null)).toBe('')
  })
})

describe('normalização de cada provedor de CNPJ', () => {
  const [brasilApi, cnpjWs, minhaReceita] = PROVEDORES_CNPJ

  it('BrasilAPI', () => {
    const r = brasilApi.interpretar(200, fixture('cnpj-brasilapi.json'))
    expect(r).toEqual({ tipo: 'ok', dados: { ...ESPERADO_EMPRESA, email: '', fonte: 'BrasilAPI' } })
  })

  it('CNPJ.ws', () => {
    const r = cnpjWs.interpretar(200, fixture('cnpj-cnpjws.json'))
    expect(r).toEqual({ tipo: 'ok', dados: { ...ESPERADO_EMPRESA, email: 'balancas.com@gmail.com', fonte: 'CNPJ.ws' } })
  })

  it('Minha Receita', () => {
    const r = minhaReceita.interpretar(200, fixture('cnpj-minhareceita.json'))
    expect(r).toEqual({ tipo: 'ok', dados: { ...ESPERADO_EMPRESA, email: '', fonte: 'Minha Receita' } })
  })

  it('sem nome fantasia: fica vazio e o nome sugerido vem da razão social', () => {
    const bruto = { ...(fixture('cnpj-brasilapi.json') as object), nome_fantasia: '' }
    const r = brasilApi.interpretar(200, bruto)
    expect(r.tipo === 'ok' && r.dados.nomeFantasia).toBe('')
    expect(r.tipo === 'ok' && r.dados.nomeSugerido).toBe('Fabio de Godoy Lima LTDA')
    const ws = fixture('cnpj-cnpjws.json') as { estabelecimento: Record<string, unknown> }
    ws.estabelecimento.nome_fantasia = null
    const r2 = cnpjWs.interpretar(200, ws)
    expect(r2.tipo === 'ok' && r2.dados.nomeFantasia).toBe('')
  })

  it('situação diferente de ATIVA vem em maiúsculas', () => {
    const ws = fixture('cnpj-cnpjws.json') as { estabelecimento: Record<string, unknown> }
    ws.estabelecimento.situacao_cadastral = 'Baixada'
    const r = cnpjWs.interpretar(200, ws)
    expect(r.tipo === 'ok' && r.dados.situacaoCadastral).toBe('BAIXADA')
  })

  it('404 é "não encontrado" definitivo; resposta sem razão social é falha', () => {
    expect(brasilApi.interpretar(404, fixture('cnpj-brasilapi-nao-encontrado.json'))).toEqual({
      tipo: 'naoEncontrado',
      definitivo: true,
    })
    expect(cnpjWs.interpretar(404, fixture('cnpj-cnpjws-nao-encontrado.json')).tipo).toBe('naoEncontrado')
    expect(minhaReceita.interpretar(404, fixture('cnpj-minhareceita-nao-encontrado.json')).tipo).toBe('naoEncontrado')
    expect(brasilApi.interpretar(400, fixture('cnpj-brasilapi-404.json')).tipo).toBe('falha')
    expect(brasilApi.interpretar(200, {}).tipo).toBe('falha')
    expect(cnpjWs.interpretar(200, 'texto').tipo).toBe('falha')
  })
})

describe('normalização de cada provedor de CEP', () => {
  const [brasilApi, viaCep, openCep] = PROVEDORES_CEP
  const esperado = { cep: '13504-000', logradouro: 'Rua Saibreiro 1', bairro: 'Vila Saibreiro', cidade: 'Rio Claro', uf: 'SP' }

  it('BrasilAPI, ViaCEP e OpenCEP', () => {
    expect(brasilApi.interpretar(200, fixture('cep-brasilapi.json'))).toEqual({
      tipo: 'ok',
      dados: { ...esperado, fonte: 'BrasilAPI' },
    })
    expect(viaCep.interpretar(200, fixture('cep-viacep.json'))).toEqual({ tipo: 'ok', dados: { ...esperado, fonte: 'ViaCEP' } })
    expect(openCep.interpretar(200, fixture('cep-opencep.json'))).toEqual({
      tipo: 'ok',
      dados: { ...esperado, fonte: 'OpenCEP' },
    })
  })

  it('CEP inexistente', () => {
    // A BrasilAPI devolve 404 também quando os serviços dela falham: não é definitivo
    expect(brasilApi.interpretar(404, fixture('cep-brasilapi-nao-encontrado.json'))).toEqual({
      tipo: 'naoEncontrado',
      definitivo: false,
    })
    expect(viaCep.interpretar(200, fixture('cep-viacep-nao-encontrado.json'))).toEqual({
      tipo: 'naoEncontrado',
      definitivo: true,
    })
    expect(openCep.interpretar(404, fixture('cep-opencep-nao-encontrado.json'))).toEqual({
      tipo: 'naoEncontrado',
      definitivo: true,
    })
  })
})

describe('consulta de CNPJ com fallback', () => {
  it('usa o primeiro provedor quando ele responde', async () => {
    const { fetch, chamadas } = fetchFalso({ [BRASILAPI_CNPJ]: { status: 200, corpo: fixture('cnpj-brasilapi.json') } })
    const s = criarServicoConsultas({ fetch })
    const r = await s.cnpj('12.403.843/0001-18')
    expect(r).toMatchObject({ ...ESPERADO_EMPRESA, fonte: 'BrasilAPI' })
    expect(chamadas).toEqual([`${BRASILAPI_CNPJ}${CNPJ}`])
  })

  it('429 e 5xx passam para o próximo provedor, na ordem', async () => {
    const { fetch, chamadas } = fetchFalso({
      [BRASILAPI_CNPJ]: { status: 429, corpo: { message: 'Too many requests' } },
      [CNPJWS]: { status: 502 },
      [MINHA_RECEITA]: { status: 200, corpo: fixture('cnpj-minhareceita.json') },
    })
    const r = await criarServicoConsultas({ fetch }).cnpj(CNPJ)
    expect(r.fonte).toBe('Minha Receita')
    expect(chamadas).toEqual([`${BRASILAPI_CNPJ}${CNPJ}`, `${CNPJWS}${CNPJ}`, `${MINHA_RECEITA}${CNPJ}`])
  })

  it('erro de rede ou tempo esgotado em um provedor tenta o seguinte', async () => {
    const { fetch } = fetchFalso({
      [BRASILAPI_CNPJ]: 'tempo',
      [CNPJWS]: { status: 200, corpo: fixture('cnpj-cnpjws.json') },
    })
    const r = await criarServicoConsultas({ fetch }).cnpj(CNPJ)
    expect(r.fonte).toBe('CNPJ.ws')
    expect(r.email).toBe('balancas.com@gmail.com')
  })

  it('404 definitivo encerra a busca com "não encontrado"', async () => {
    const { fetch, chamadas } = fetchFalso({
      [BRASILAPI_CNPJ]: { status: 404, corpo: fixture('cnpj-brasilapi-nao-encontrado.json') },
      [CNPJWS]: { status: 200, corpo: fixture('cnpj-cnpjws.json') },
    })
    const p = criarServicoConsultas({ fetch }).cnpj(CNPJ)
    await expect(p).rejects.toMatchObject({ status: 404, message: MENSAGENS.cnpjNaoEncontrado })
    expect(chamadas).toHaveLength(1)
  })

  it('sem internet: 503 com mensagem para preencher à mão', async () => {
    const { fetch, chamadas } = fetchFalso({})
    const p = criarServicoConsultas({ fetch }).cnpj(CNPJ)
    await expect(p).rejects.toBeInstanceOf(ErroApi)
    await expect(p).rejects.toMatchObject({ status: 503, message: MENSAGENS.semInternet, dados: { motivo: 'sem_internet' } })
    expect(chamadas).toHaveLength(3)
  })

  it('todos os serviços fora do ar (sem ser rede): 503 de serviço indisponível', async () => {
    const { fetch } = fetchFalso({ [BRASILAPI_CNPJ]: { status: 500 }, [CNPJWS]: 'rede', [MINHA_RECEITA]: { status: 503 } })
    await expect(criarServicoConsultas({ fetch }).cnpj(CNPJ)).rejects.toMatchObject({
      status: 503,
      dados: { motivo: 'servicos_indisponiveis' },
    })
  })

  it('CNPJ inválido nem chega a consultar', async () => {
    const { fetch, chamadas } = fetchFalso({})
    const s = criarServicoConsultas({ fetch })
    for (const ruim of ['12403843000119', '11111111111111', '123', '']) {
      await expect(s.cnpj(ruim)).rejects.toMatchObject({ status: 400, message: MENSAGENS.cnpjInvalido })
    }
    expect(chamadas).toHaveLength(0)
  })

  it('guarda o resultado em cache por 24 h', async () => {
    let agora = 1_000_000
    const { fetch, chamadas } = fetchFalso({ [BRASILAPI_CNPJ]: { status: 200, corpo: fixture('cnpj-brasilapi.json') } })
    const s = criarServicoConsultas({ fetch, agora: () => agora })
    await s.cnpj(CNPJ)
    agora += 23 * 60 * 60 * 1000
    await s.cnpj('12.403.843/0001-18')
    expect(chamadas).toHaveLength(1)
    agora += 2 * 60 * 60 * 1000
    await s.cnpj(CNPJ)
    expect(chamadas).toHaveLength(2)
  })

  it('não guarda falhas de rede em cache e junta pedidos simultâneos', async () => {
    const { fetch, chamadas } = fetchFalso({
      [BRASILAPI_CNPJ]: ['rede', { status: 200, corpo: fixture('cnpj-brasilapi.json') }],
      [CNPJWS]: 'rede',
      [MINHA_RECEITA]: 'rede',
    })
    const s = criarServicoConsultas({ fetch })
    await expect(s.cnpj(CNPJ)).rejects.toMatchObject({ status: 503 })
    const [a, b] = await Promise.all([s.cnpj(CNPJ), s.cnpj(CNPJ)])
    expect(a).toEqual(b)
    expect(chamadas).toHaveLength(4)
  })
})

describe('consulta de CEP com fallback', () => {
  it('BrasilAPI → ViaCEP → OpenCEP', async () => {
    const { fetch, chamadas } = fetchFalso({
      [BRASILAPI_CEP]: { status: 500 },
      [VIACEP]: 'rede',
      [OPENCEP]: { status: 200, corpo: fixture('cep-opencep.json') },
    })
    const r = await criarServicoConsultas({ fetch }).cep('13504-000')
    expect(r).toEqual({
      cep: '13504-000',
      logradouro: 'Rua Saibreiro 1',
      bairro: 'Vila Saibreiro',
      cidade: 'Rio Claro',
      uf: 'SP',
      fonte: 'OpenCEP',
    })
    expect(chamadas).toEqual([`${BRASILAPI_CEP}${CEP}`, `${VIACEP}${CEP}/json/`, `${OPENCEP}${CEP}`])
  })

  it('não encontrado: 404 (mesmo com a BrasilAPI ambígua)', async () => {
    const { fetch } = fetchFalso({
      [BRASILAPI_CEP]: { status: 404, corpo: fixture('cep-brasilapi-nao-encontrado.json') },
      [VIACEP]: { status: 200, corpo: fixture('cep-viacep-nao-encontrado.json') },
    })
    await expect(criarServicoConsultas({ fetch }).cep(CEP)).rejects.toMatchObject({
      status: 404,
      message: MENSAGENS.cepNaoEncontrado,
    })
    const so404Ambiguo = fetchFalso({ [BRASILAPI_CEP]: { status: 404 } })
    await expect(criarServicoConsultas({ fetch: so404Ambiguo.fetch }).cep(CEP)).rejects.toMatchObject({ status: 404 })
  })

  it('sem internet: 503; CEP inválido: 400', async () => {
    const { fetch } = fetchFalso({})
    const s = criarServicoConsultas({ fetch })
    await expect(s.cep(CEP)).rejects.toMatchObject({ status: 503, message: MENSAGENS.semInternet })
    await expect(s.cep('1350')).rejects.toMatchObject({ status: 400 })
    await expect(s.cep('abc13504000')).rejects.toMatchObject({ status: 400 })
  })
})

describe('motor', () => {
  it('cache expira e respeita o limite de itens', () => {
    let agora = 0
    const c = new CacheTemporario<number>(2, () => agora)
    c.guardar('a', 1, 100)
    c.guardar('b', 2, 100)
    c.guardar('c', 3, 100)
    expect(c.obter('a')).toBeUndefined()
    expect(c.obter('b')).toBe(2)
    agora = 100
    expect(c.obter('c')).toBeUndefined()
  })

  it('resposta que não é JSON conta como falha e segue para o próximo', async () => {
    const f = (async (url: string) =>
      String(url).includes('brasilapi')
        ? new Response('<html>manutenção</html>', { status: 200 })
        : new Response(JSON.stringify(fixture('cnpj-cnpjws.json')), { status: 200 })) as unknown as Fetch
    const r = await consultarEmOrdem(CNPJ, PROVEDORES_CNPJ, { fetch: f, timeoutMs: 1000 })
    expect(r.tipo === 'ok' && r.dados.fonte).toBe('CNPJ.ws')
  })
})

describe('rotas de consulta', () => {
  async function appComFetch(f: Fetch) {
    const app = Fastify()
    app.setErrorHandler((erro, _req, reply) => {
      if (erro instanceof ErroApi) {
        return reply.code(erro.status).send({ erro: erro.message, ...(erro.dados as object) })
      }
      return reply.code(500).send({ erro: 'interno' })
    })
    await rotasConsultas(app, {} as never, { fetch: f })
    return app
  }

  it('GET /api/consultas/cnpj/:cnpj devolve os dados normalizados', async () => {
    const { fetch } = fetchFalso({ [BRASILAPI_CNPJ]: { status: 200, corpo: fixture('cnpj-brasilapi.json') } })
    const app = await appComFetch(fetch)
    const r = await app.inject({ url: `/api/consultas/cnpj/${CNPJ}` })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ...ESPERADO_EMPRESA, fonte: 'BrasilAPI' })
    await app.close()
  })

  it('códigos de erro: 400, 404 e 503', async () => {
    const { fetch } = fetchFalso({
      [`${BRASILAPI_CNPJ}98765432000198`]: { status: 404, corpo: fixture('cnpj-brasilapi-nao-encontrado.json') },
      [`${BRASILAPI_CEP}`]: 'rede',
    })
    const app = await appComFetch(fetch)
    const invalido = await app.inject({ url: '/api/consultas/cnpj/12403843000100' })
    expect(invalido.statusCode).toBe(400)
    expect(invalido.json().erro).toBe(MENSAGENS.cnpjInvalido)
    const inexistente = await app.inject({ url: '/api/consultas/cnpj/98765432000198' })
    expect(inexistente.statusCode).toBe(404)
    expect(inexistente.json().erro).toBe('CNPJ não encontrado na Receita Federal.')
    const semRede = await app.inject({ url: `/api/consultas/cep/${CEP}` })
    expect(semRede.statusCode).toBe(503)
    expect(semRede.json()).toEqual({ erro: MENSAGENS.semInternet, motivo: 'sem_internet' })
    await app.close()
  })

  it('estão registradas no app principal (validação sem rede)', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'bcf-consultas-'))
    const { app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null })
    try {
      const r = await app.inject({ url: '/api/consultas/cnpj/00000000000000' })
      expect(r.statusCode).toBe(400)
      expect(r.json().erro).toBe(MENSAGENS.cnpjInvalido)
      const cep = await app.inject({ url: '/api/consultas/cep/123' })
      expect(cep.statusCode).toBe(400)
    } finally {
      await app.close()
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
