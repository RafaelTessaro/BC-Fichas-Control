import { describe, expect, it } from 'vitest'
import { ClienteGoogle, ESCOPO_AGENDA, ErroGoogle, MSG_SEM_INTERNET, TOKEN_URI_PADRAO, validarCredenciais } from './cliente.ts'
import { criarSimuladorGoogle, EMAIL_TESTE, gerarContaServico } from './simuladorGoogle.ts'

const conta = gerarContaServico()

function preparar() {
  const sim = criarSimuladorGoogle(conta.chavePublica)
  let relogio = Date.parse('2026-10-01T12:00:00Z')
  const cliente = new ClienteGoogle(validarCredenciais(conta.json), { fetch: sim.fetch, agora: () => relogio })
  return { sim, cliente, avancar: (ms: number) => (relogio += ms) }
}

describe('validação da chave', () => {
  it('aceita a chave da conta de serviço como objeto ou texto', () => {
    expect(validarCredenciais(conta.json).client_email).toBe(EMAIL_TESTE)
    expect(validarCredenciais(JSON.stringify(conta.json)).project_id).toBe('bc-fichas-teste')
  })

  it('recusa arquivos que não são chave de conta de serviço', () => {
    expect(() => validarCredenciais('{ isso não é json')).toThrow(/JSON válido/)
    expect(() => validarCredenciais({ ...conta.json, type: 'authorized_user' })).toThrow(/service_account/)
    expect(() => validarCredenciais({ ...conta.json, client_email: '' })).toThrow(/client_email/)
    expect(() => validarCredenciais({ ...conta.json, private_key: 'abc' })).toThrow(/private_key/)
    expect(() =>
      validarCredenciais({ ...conta.json, private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' }),
    ).toThrow(/inválida/)
    expect(() => validarCredenciais({ ...conta.json, token_uri: 'https://site-malicioso.com/token' })).toThrow(/token_uri/)
  })
})

describe('autenticação', () => {
  it('assina o JWT (RS256) com a chave da conta e reaproveita o token até perto de expirar', async () => {
    const { sim, cliente, avancar } = preparar()
    sim.criarAgenda('agenda@group.calendar.google.com')
    await cliente.obterAgenda('agenda@group.calendar.google.com')
    await cliente.obterAgenda('agenda@group.calendar.google.com')
    expect(sim.tokensEmitidos).toBe(1)

    const { cabecalho, corpo } = sim.jwts[0]
    expect(cabecalho).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'chave123' })
    expect(corpo).toMatchObject({ iss: EMAIL_TESTE, scope: ESCOPO_AGENDA, aud: TOKEN_URI_PADRAO })
    expect(Number(corpo.exp) - Number(corpo.iat)).toBe(3600)

    avancar(59 * 60_000)
    await cliente.obterAgenda('agenda@group.calendar.google.com')
    expect(sim.tokensEmitidos).toBe(2)
  })

  it('explica quando o Google recusa a chave', async () => {
    const outra = gerarContaServico()
    const sim = criarSimuladorGoogle(outra.chavePublica) // assinatura não confere
    const cliente = new ClienteGoogle(validarCredenciais(conta.json), { fetch: sim.fetch })
    const erro = await cliente.obterAgenda('x').catch((e) => e)
    expect(erro).toBeInstanceOf(ErroGoogle)
    expect(erro).toMatchObject({ motivo: 'credenciais' })
    expect(erro.message).toMatch(/invalid_grant/)
  })
})

describe('chamadas à agenda', () => {
  it('insere com POST quando o PUT não encontra o evento, e atualiza com PUT depois', async () => {
    const { sim, cliente } = preparar()
    sim.criarAgenda('ag')
    await cliente.salvarEvento('ag', { id: 'bcfabc0', summary: 'Teste' })
    expect(sim.chamadas.filter((c) => c.caminho !== 'token').map((c) => c.metodo)).toEqual(['PUT', 'POST'])
    sim.limparChamadas()
    await cliente.salvarEvento('ag', { id: 'bcfabc0', summary: 'Teste 2' })
    expect(sim.chamadas.map((c) => c.metodo)).toEqual(['PUT'])
    expect(sim.eventos('ag')[0].summary).toBe('Teste 2')
  })

  it('ignora 404/410 ao apagar', async () => {
    const { sim, cliente } = preparar()
    sim.criarAgenda('ag')
    await cliente.salvarEvento('ag', { id: 'bcfabc0' })
    await cliente.apagarEvento('ag', 'bcfabc0')
    await cliente.apagarEvento('ag', 'bcfabc0') // 410
    await cliente.apagarEvento('ag', 'naoexiste') // 404
    expect(sim.eventos('ag')).toEqual([])
  })

  it('traduz as falhas em mensagens amigáveis', async () => {
    const { sim, cliente } = preparar()
    sim.criarAgenda('somente-leitura', false)

    const semPermissao = await cliente.salvarEvento('somente-leitura', { id: 'bcfabc0' }).catch((e) => e)
    expect(semPermissao).toMatchObject({ motivo: 'permissao', status: 403 })
    expect(semPermissao.message).toContain(EMAIL_TESTE)
    expect(semPermissao.message).toContain("'Fazer alterações nos eventos'")

    const inexistente = await cliente.obterAgenda('nao-existe').catch((e) => e)
    expect(inexistente).toMatchObject({
      motivo: 'agendaNaoEncontrada',
      message: 'Agenda não encontrada: confira o ID da agenda.',
    })

    sim.falharCom = 503
    expect(await cliente.obterAgenda('somente-leitura').catch((e) => e)).toMatchObject({ motivo: 'indisponivel', geral: true })
    sim.falharCom = 429
    expect(await cliente.obterAgenda('somente-leitura').catch((e) => e)).toMatchObject({ motivo: 'limite' })

    sim.offline = true
    expect(await cliente.obterAgenda('ag').catch((e) => e)).toMatchObject({
      motivo: 'rede',
      status: 0,
      message: MSG_SEM_INTERNET,
    })
  })
})
