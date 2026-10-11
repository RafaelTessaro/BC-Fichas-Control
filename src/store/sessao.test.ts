import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'
import type { UsuarioSessao } from '#shared/tipos.ts'
import { deveRecarregar, useEhAdmin, usePode, useSessao, useUsuarioAtual } from './sessao'

// Sem DOM, os ganchos são desenhados com renderToString, que lê o estado *inicial* do zustand
// (getServerSnapshot). Aqui o estado inicial passa a ser o atual, para testar cada nível.
vi.mock('zustand', async (original) => {
  const real = await original<typeof import('zustand')>()
  const criar = <T>(f: StateCreator<T>) =>
    real.create<T>()((set, get, api) => {
      api.getInitialState = api.getState
      return f(set, get, api)
    })
  return { ...real, create: <T>(f?: StateCreator<T>) => (f ? criar(f) : criar) }
})

const maria: UsuarioSessao = { id: 'u1', login: 'maria', nome: 'Maria Souza', nivel: 'COMUM', trocarSenha: false }
const joao: UsuarioSessao = { id: 'u2', login: 'joao', nome: 'João Lima', nivel: 'ADMIN', trocarSenha: false }

function Sonda() {
  const usuario = useUsuarioAtual()
  const admin = useEhAdmin()
  const faturamento = usePode('verFaturamento')
  const anexo = usePode('excluirAnexo')
  return `${usuario?.login ?? '-'}|admin:${admin}|faturamento:${faturamento}|anexo:${anexo}`
}
const desenhar = () => renderToString(createElement(Sonda))

describe('ganchos da sessão', () => {
  const inicial = useSessao.getState()
  afterEach(() => useSessao.setState(inicial, true))

  it('começa verificando, sem ninguém e sem nenhuma permissão', () => {
    expect(inicial.estado).toBe('verificando')
    expect(inicial.usuario).toBeNull()
    expect(inicial.build).toBe('')
    expect(desenhar()).toBe('-|admin:false|faturamento:false|anexo:false')
  })

  it('administrador pode tudo', () => {
    useSessao.setState({ estado: 'logado', usuario: joao })
    expect(desenhar()).toBe('joao|admin:true|faturamento:true|anexo:true')
  })

  it('comum não vê o faturamento, mas apaga anexos', () => {
    useSessao.setState({ estado: 'logado', usuario: maria })
    expect(desenhar()).toBe('maria|admin:false|faturamento:false|anexo:true')
  })
})

describe('deveRecarregar', () => {
  const agora = { usuario: maria, build: 'b1' }

  it('nada mudou', () => {
    expect(deveRecarregar(agora, { usuario: { ...maria }, build: 'b1' })).toBe(false)
  })

  it('mudou o usuário ou o nível', () => {
    expect(deveRecarregar(agora, { usuario: joao, build: 'b1' })).toBe(true)
    expect(deveRecarregar(agora, { usuario: { ...maria, nivel: 'ADMIN' }, build: 'b1' })).toBe(true)
  })

  it('mudou o build (só com os dois preenchidos)', () => {
    expect(deveRecarregar(agora, { usuario: maria, build: 'b2' })).toBe(true)
    expect(deveRecarregar(agora, { usuario: null, build: 'b2' })).toBe(true)
    expect(deveRecarregar(agora, { usuario: maria, build: '' })).toBe(false)
    expect(deveRecarregar({ usuario: maria, build: '' }, { usuario: maria, build: 'b2' })).toBe(false)
  })

  it('sessão terminada não recarrega; alguém entrou noutra aba, sim', () => {
    expect(deveRecarregar(agora, { usuario: null, build: 'b1' })).toBe(false)
    expect(deveRecarregar({ usuario: null, build: 'b1' }, { usuario: null, build: 'b1' })).toBe(false)
    expect(deveRecarregar({ usuario: null, build: 'b1' }, agora)).toBe(true)
  })

  it('nome, login e troca de senha não recarregam', () => {
    expect(
      deveRecarregar(agora, { usuario: { ...maria, nome: 'Maria S.', login: 'msouza', trocarSenha: true }, build: 'b1' }),
    ).toBe(false)
  })
})

// ---- Ações da sessão (com o servidor simulado) ------------------------------------------

/** Respostas do servidor simulado, na ordem dos pedidos. */
function servidor(...respostas: Array<{ status?: number; corpo?: unknown } | Error>) {
  const fila = [...respostas]
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = fila.shift()
    if (!r) throw new Error('pedido inesperado')
    if (r instanceof Error) throw r
    return new Response(r.status === 204 ? null : JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('ações da sessão', () => {
  const inicial = useSessao.getState()
  const reload = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('location', { reload })
    // Sem o canal entre abas nos testes (o do Node manteria o processo vivo)
    vi.stubGlobal('BroadcastChannel', undefined)
  })
  afterEach(() => {
    useSessao.setState(inicial, true)
    reload.mockReset()
    vi.unstubAllGlobals()
  })

  it('verificar: preenche quem está logado e o build, contando como uso', async () => {
    const fetch = servidor({ corpo: { usuario: maria, semUsuarios: false, build: 'b1' } })
    await useSessao.getState().verificar()
    expect(fetch.mock.calls[0][0]).toBe('/api/sessao?uso=1')
    expect(useSessao.getState()).toMatchObject({ estado: 'logado', usuario: maria, build: 'b1', semUsuarios: false })
  })

  it('verificar: sem usuários cadastrados fica anônimo com semUsuarios; sem rede, erro', async () => {
    servidor({ corpo: { usuario: null, semUsuarios: true, build: 'b1' } }, new TypeError('rede'))
    await useSessao.getState().verificar()
    expect(useSessao.getState()).toMatchObject({ estado: 'anonimo', semUsuarios: true })
    await useSessao.getState().verificar()
    expect(useSessao.getState().estado).toBe('erro')
    expect(useSessao.getState().erro).toMatch(/Sem conexão/)
  })

  it('entrar com senha temporária guarda a senha para a troca obrigatória', async () => {
    useSessao.setState({ estado: 'anonimo', build: 'b1' })
    servidor({ corpo: { usuario: { ...maria, trocarSenha: true }, build: 'b1' } })
    await useSessao.getState().entrar({ login: 'maria', senha: 'k7pw-9xqm-3tfa' })
    expect(useSessao.getState()).toMatchObject({ estado: 'logado', senhaTemporaria: 'k7pw-9xqm-3tfa', expirou: false })
    expect(reload).not.toHaveBeenCalled()
  })

  it('entrar com a interface nova no servidor recarrega a página', async () => {
    useSessao.setState({ estado: 'anonimo', build: 'b1' })
    servidor({ corpo: { usuario: maria, build: 'b2' } })
    await useSessao.getState().entrar({ login: 'maria', senha: 's' })
    expect(reload).toHaveBeenCalledOnce()
    expect(useSessao.getState().estado).toBe('anonimo')
  })

  it('"sessão terminou": entrar de novo como a mesma pessoa fecha o aviso; como outra, recarrega', async () => {
    useSessao.setState({ estado: 'logado', usuario: maria, build: 'b1', expirou: true })
    servidor({ corpo: { usuario: maria, build: 'b1' } }, { corpo: { usuario: joao, build: 'b1' } })
    await useSessao.getState().entrar({ login: 'maria', senha: 's' })
    expect(useSessao.getState().expirou).toBe(false)
    expect(reload).not.toHaveBeenCalled()

    useSessao.setState({ expirou: true })
    await useSessao.getState().entrar({ login: 'joao', senha: 's' })
    expect(reload).toHaveBeenCalledOnce()
    expect(useSessao.getState()).toMatchObject({ usuario: maria, expirou: true })
  })

  it('conferir: sessão terminada liga o aviso; mesma pessoa segue; outra pessoa recarrega', async () => {
    useSessao.setState({ estado: 'logado', usuario: maria, build: 'b1' })
    servidor(
      { corpo: { usuario: null, semUsuarios: false, build: 'b1' } },
      { corpo: { usuario: { ...maria, nome: 'Maria S.' }, semUsuarios: false, build: 'b1' } },
      { corpo: { usuario: joao, semUsuarios: false, build: 'b1' } },
    )
    expect(await useSessao.getState().conferir()).toBe(false)
    expect(useSessao.getState().expirou).toBe(true)

    // Entrou de novo noutra aba: o aviso some e o nome novo aparece
    expect(await useSessao.getState().conferir()).toBe(true)
    expect(useSessao.getState()).toMatchObject({ expirou: false, usuario: { nome: 'Maria S.' } })

    expect(await useSessao.getState().conferir()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('conferir: senha redefinida pede a troca; sem rede, segue', async () => {
    useSessao.setState({ estado: 'logado', usuario: maria, build: 'b1' })
    const fetch = servidor(
      { corpo: { usuario: { ...maria, trocarSenha: true }, semUsuarios: false, build: 'b1' } },
      new TypeError(),
    )
    expect(await useSessao.getState().conferir()).toBe(false)
    expect(fetch.mock.calls[0][0]).toBe('/api/sessao')
    expect(useSessao.getState().usuario?.trocarSenha).toBe(true)
    expect(await useSessao.getState().conferir()).toBe(true)
  })

  it('trocar a senha limpa a temporária e libera o sistema', async () => {
    useSessao.setState({ estado: 'logado', usuario: { ...maria, trocarSenha: true }, senhaTemporaria: 'k7pw-9xqm-3tfa' })
    servidor({ corpo: { usuario: { ...maria, trocarSenha: false } } })
    await useSessao.getState().trocarSenha({ senhaAtual: 'k7pw-9xqm-3tfa', senhaNova: 'tres gatos na janela' })
    expect(useSessao.getState()).toMatchObject({ senhaTemporaria: '', usuario: { trocarSenha: false } })
  })

  it('sair recarrega mesmo sem conexão', async () => {
    useSessao.setState({ estado: 'logado', usuario: maria })
    servidor(new TypeError('rede'))
    await useSessao.getState().sair()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('"manter conectado" vem do servidor, fica quando a sessão termina e muda ao entrar de novo', async () => {
    servidor(
      { corpo: { usuario: maria, semUsuarios: false, build: 'b1', persistente: true } },
      { corpo: { usuario: null, semUsuarios: false, build: 'b1' } },
      { corpo: { usuario: maria, build: 'b1' } },
      { corpo: { usuario: maria, semUsuarios: false, build: 'b1', persistente: true } },
    )
    await useSessao.getState().verificar()
    expect(useSessao.getState().manterConectado).toBe(true)
    // A sessão terminou: a janela "Sua sessão terminou" usa a escolha de antes
    expect(await useSessao.getState().conferir()).toBe(false)
    expect(useSessao.getState()).toMatchObject({ expirou: true, manterConectado: true })
    await useSessao.getState().entrar({ login: 'maria', senha: 's', manterConectado: false })
    expect(useSessao.getState()).toMatchObject({ expirou: false, manterConectado: false })
    expect(await useSessao.getState().conferir()).toBe(true)
    expect(useSessao.getState().manterConectado).toBe(true)
  })

  it('sessaoEncerrada só com alguém logado; exigirTrocaSenha marca a troca', () => {
    useSessao.getState().sessaoEncerrada()
    expect(useSessao.getState().expirou).toBe(false)
    useSessao.setState({ estado: 'logado', usuario: maria })
    useSessao.getState().sessaoEncerrada()
    useSessao.getState().exigirTrocaSenha()
    expect(useSessao.getState()).toMatchObject({ expirou: true, usuario: { trocarSenha: true } })
  })
})

// ---- Aviso entre abas ---------------------------------------------------------------------

describe('aviso entre abas', () => {
  /** Canal falso: guarda os ouvintes para o teste mandar a mensagem de "outra aba". */
  class CanalFalso {
    static ouvintes: Array<(e: MessageEvent) => void> = []
    addEventListener(_tipo: string, f: (e: MessageEvent) => void) {
      CanalFalso.ouvintes.push(f)
    }
    removeEventListener(_tipo: string, f: (e: MessageEvent) => void) {
      CanalFalso.ouvintes = CanalFalso.ouvintes.filter((o) => o !== f)
    }
    postMessage() {}
  }
  const reload = vi.fn()

  beforeEach(() => {
    // O canal é criado uma vez por módulo: um módulo novo, já com o canal falso
    vi.resetModules()
    CanalFalso.ouvintes = []
    vi.stubGlobal('BroadcastChannel', CanalFalso)
    vi.stubGlobal('location', { reload })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('document', { visibilityState: 'visible' })
  })
  afterEach(() => {
    reload.mockReset()
    vi.unstubAllGlobals()
  })

  it('"saiu" noutra aba recarrega esta (o cookie é o mesmo): o usuário e os dados saem da memória', async () => {
    const { useSessao: sessao } = await import('./sessao')
    sessao.setState({ estado: 'logado', usuario: joao, build: 'b1' })
    const parar = sessao.getState().iniciarBatimento()
    try {
      expect(CanalFalso.ouvintes).toHaveLength(1)
      CanalFalso.ouvintes[0](new MessageEvent('message', { data: 'saiu' }))
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      parar()
    }
    expect(CanalFalso.ouvintes).toHaveLength(0)
  })

  it('os outros avisos só conferem a sessão; na tela de entrada, "saiu" também só confere', async () => {
    const { useSessao: sessao } = await import('./sessao')
    const fetch = servidor(
      { corpo: { usuario: maria, semUsuarios: false, build: 'b1' } },
      { corpo: { usuario: null, semUsuarios: false, build: 'b1' } },
    )
    sessao.setState({ estado: 'logado', usuario: maria, build: 'b1' })
    const parar = sessao.getState().iniciarBatimento()
    try {
      CanalFalso.ouvintes[0](new MessageEvent('message', { data: 'senha' }))
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      sessao.setState({ estado: 'anonimo', usuario: null })
      CanalFalso.ouvintes[0](new MessageEvent('message', { data: 'saiu' }))
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      expect(reload).not.toHaveBeenCalled()
    } finally {
      parar()
    }
  })
})
