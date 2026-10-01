import {
  CONFIG_PADRAO,
  normalizarCliente,
  normalizarConfig,
  normalizarEvento,
  normalizarPatch,
  validarBackup,
} from '#shared/dominio.ts'
import { novoId } from '#shared/id.ts'
import { gerarDadosExemplo } from '#shared/seed.ts'
import type { Backup, Cliente, Configuracoes, DadosCompletos, Evento, MensagemTempoReal } from '#shared/tipos.ts'
import { gravarMeta, lerMeta, transacao, type Banco } from './db.ts'
import { ErroApi, naoEncontrado } from './erros.ts'
import type { ExtensaoRepositorio } from './extensoes.ts'

type Linha = { id: string; dados: string; versao: number; criado_em: string; atualizado_em: string }
type LinhaEvento = Linha & { codigo: number; cliente_id: string }

const agora = () => new Date().toISOString()

function validar<T>(r: { valor: T; erros: string[] }): T {
  if (r.erros.length) throw new ErroApi(400, r.erros[0], { erros: r.erros })
  return r.valor
}

/**
 * Acesso aos dados. Toda gravação acontece dentro de uma transação, incrementa a
 * `revisao` global e é publicada para os navegadores conectados.
 */
export class Repositorio {
  private db: Banco
  private publicar: (msg: MensagemTempoReal) => void
  private extensoes: ExtensaoRepositorio[] = []

  constructor(db: Banco, publicar: (msg: MensagemTempoReal) => void) {
    this.db = db
    this.publicar = publicar
  }

  registrarExtensao(ext: ExtensaoRepositorio) {
    this.extensoes.push(ext)
  }

  // ---- Leitura ---------------------------------------------------------------

  revisao() {
    return Number(lerMeta(this.db, 'revisao') ?? 0)
  }

  listarClientes(): Cliente[] {
    const linhas = this.db.prepare('SELECT * FROM clientes').all() as Linha[]
    return linhas.map((l) => this.paraCliente(l)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }

  obterCliente(id: string): Cliente | undefined {
    const l = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as Linha | undefined
    return l && this.paraCliente(l)
  }

  listarEventos(): Evento[] {
    const linhas = this.db.prepare('SELECT * FROM eventos ORDER BY codigo').all() as LinhaEvento[]
    return linhas.map((l) => this.decorar(this.paraEvento(l)))
  }

  obterEvento(id: string): Evento | undefined {
    const l = this.db.prepare('SELECT * FROM eventos WHERE id = ?').get(id) as LinhaEvento | undefined
    return l && this.decorar(this.paraEvento(l))
  }

  /** Evento sem decoração (uso interno e de extensões). */
  obterEventoBruto(id: string): Evento | undefined {
    const l = this.db.prepare('SELECT * FROM eventos WHERE id = ?').get(id) as LinhaEvento | undefined
    return l && this.paraEvento(l)
  }

  listarEventosBrutos(): Evento[] {
    return (this.db.prepare('SELECT * FROM eventos ORDER BY codigo').all() as LinhaEvento[]).map((l) => this.paraEvento(l))
  }

  obterConfig(): Configuracoes {
    const l = this.db.prepare("SELECT valor FROM config WHERE chave = 'geral'").get() as { valor: string } | undefined
    return l ? normalizarConfig(JSON.parse(l.valor)).valor : { ...CONFIG_PADRAO }
  }

  dadosCompletos(): DadosCompletos {
    return {
      clientes: this.listarClientes(),
      eventos: this.listarEventos(),
      config: this.obterConfig(),
      revisao: this.revisao(),
    }
  }

  /**
   * Reenvia um evento aos navegadores quando só um dado derivado mudou (ex.: status da
   * sincronização com o Google), sem criar nova revisão.
   */
  republicarEvento(id: string) {
    const evento = this.obterEvento(id)
    if (evento) this.publicar({ revisao: this.revisao(), tipo: 'evento', acao: 'salvo', dado: evento })
  }

  // ---- Clientes --------------------------------------------------------------

  criarCliente(entrada: unknown): Cliente {
    const dados = validar(normalizarCliente(entrada))
    const ts = agora()
    const cliente: Cliente = { ...dados, id: novoId(), versao: 1, criadoEm: ts, atualizadoEm: ts }
    const rev = transacao(this.db, () => {
      this.gravarCliente(cliente, true)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'cliente', acao: 'salvo', dado: cliente })
    return cliente
  }

  /** Atualiza o cliente. Com `versaoEsperada`, recusa (409) se outra pessoa já alterou. */
  atualizarCliente(id: string, entrada: unknown, versaoEsperada?: number): Cliente {
    const dados = validar(normalizarCliente(entrada))
    const { cliente, rev } = transacao(this.db, () => {
      const atual = this.obterCliente(id)
      if (!atual) throw naoEncontrado('Cliente')
      this.verificarVersao(atual, versaoEsperada, 'cliente')
      const cliente: Cliente = { ...atual, ...dados, versao: atual.versao + 1, atualizadoEm: agora() }
      this.gravarCliente(cliente, false)
      return { cliente, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'cliente', acao: 'salvo', dado: cliente })
    return cliente
  }

  excluirCliente(id: string) {
    const rev = transacao(this.db, () => {
      if (!this.obterCliente(id)) throw naoEncontrado('Cliente')
      const { qtd } = this.db.prepare('SELECT COUNT(*) AS qtd FROM eventos WHERE cliente_id = ?').get(id) as { qtd: number }
      if (qtd > 0) {
        throw new ErroApi(409, `Este cliente possui ${qtd} evento${qtd > 1 ? 's' : ''}. Exclua ou transfira os eventos antes.`)
      }
      this.db.prepare('DELETE FROM clientes WHERE id = ?').run(id)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'cliente', acao: 'excluido', id })
  }

  // ---- Eventos ---------------------------------------------------------------

  criarEvento(entrada: unknown): Evento {
    const dados = validar(normalizarEvento(entrada))
    const { evento, rev } = transacao(this.db, () => {
      this.exigirCliente(dados.clienteId)
      const codigo = this.proximoCodigo()
      const ts = agora()
      const evento: Evento = { ...dados, id: novoId(), versao: 1, codigo, criadoEm: ts, atualizadoEm: ts }
      this.gravarEvento(evento, true)
      return { evento, rev: this.incrementarRevisao() }
    })
    return this.aposSalvarEvento(evento, undefined, rev)
  }

  atualizarEvento(id: string, entrada: unknown, versaoEsperada?: number): Evento {
    const dados = validar(normalizarEvento(entrada))
    const { evento, anterior, rev } = transacao(this.db, () => {
      const anterior = this.obterEventoBruto(id)
      if (!anterior) throw naoEncontrado('Evento')
      this.verificarVersao(anterior, versaoEsperada, 'evento')
      this.exigirCliente(dados.clienteId)
      const evento: Evento = { ...anterior, ...dados, versao: anterior.versao + 1, atualizadoEm: agora() }
      this.gravarEvento(evento, false)
      return { evento, anterior, rev: this.incrementarRevisao() }
    })
    return this.aposSalvarEvento(evento, anterior, rev)
  }

  /** Alteração rápida (status, pagamento, devolução) sem controle de versão. */
  alterarEvento(id: string, entrada: unknown): Evento {
    const { evento, anterior, rev } = transacao(this.db, () => {
      const anterior = this.obterEventoBruto(id)
      if (!anterior) throw naoEncontrado('Evento')
      const patch = validar(normalizarPatch(entrada, anterior))
      const evento: Evento = { ...anterior, ...patch, versao: anterior.versao + 1, atualizadoEm: agora() }
      this.gravarEvento(evento, false)
      return { evento, anterior, rev: this.incrementarRevisao() }
    })
    return this.aposSalvarEvento(evento, anterior, rev)
  }

  duplicarEvento(id: string): Evento {
    const origem = this.obterEventoBruto(id)
    if (!origem) throw naoEncontrado('Evento')
    return this.criarEvento({
      ...origem,
      nome: `${origem.nome} (cópia)`,
      dias: origem.dias.map((d) => ({ ...d, id: novoId() })),
      bobinasDevolvidas: null,
      formaPagamento: 'NAO_PAGO',
      dataPagamento: '',
      status: 'EM_ABERTO',
    })
  }

  excluirEvento(id: string) {
    const { evento, rev } = transacao(this.db, () => {
      const evento = this.obterEventoBruto(id)
      if (!evento) throw naoEncontrado('Evento')
      this.db.prepare('DELETE FROM eventos WHERE id = ?').run(id)
      return { evento, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'evento', acao: 'excluido', id })
    this.chamarExtensoes((x) => x.eventoExcluido?.(evento))
  }

  // ---- Configurações ---------------------------------------------------------

  salvarConfig(entrada: unknown): Configuracoes {
    const config = validar(normalizarConfig(entrada))
    const rev = transacao(this.db, () => {
      this.db
        .prepare("INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
        .run(JSON.stringify(config))
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'config', acao: 'salvo', dado: config })
    return config
  }

  // ---- Backup, exemplo e limpeza ---------------------------------------------

  exportar(): Backup {
    return {
      app: 'bc-fichas-control',
      versao: 2,
      exportadoEm: agora(),
      clientes: this.listarClientes(),
      eventos: this.listarEventosBrutos(),
      config: this.obterConfig(),
      proximoCodigo: Number(lerMeta(this.db, 'proximo_codigo') ?? 1),
    }
  }

  /** Substitui todos os dados pelos do backup (já validado e migrado). */
  restaurar(entrada: unknown) {
    let backup: Backup
    try {
      backup = validarBackup(entrada)
    } catch (e) {
      throw new ErroApi(400, (e as Error).message)
    }
    this.substituirTudo(backup.clientes, backup.eventos, backup.config, backup.proximoCodigo)
    return { clientes: backup.clientes.length, eventos: backup.eventos.length }
  }

  carregarExemplo() {
    const { qtd } = this.db.prepare('SELECT (SELECT COUNT(*) FROM clientes) + (SELECT COUNT(*) FROM eventos) AS qtd').get() as {
      qtd: number
    }
    if (qtd > 0) throw new ErroApi(409, 'Os dados de exemplo só podem ser carregados com o sistema vazio.')
    const ex = gerarDadosExemplo(new Date())
    this.substituirTudo(ex.clientes, ex.eventos, this.obterConfig(), ex.proximoCodigo)
  }

  limparTudo() {
    this.substituirTudo([], [], this.obterConfig(), 1)
  }

  // ---- Internos --------------------------------------------------------------

  private substituirTudo(clientes: Cliente[], eventos: Evento[], config: Configuracoes, proximoCodigo: number) {
    const anteriores = this.listarEventosBrutos()
    const rev = transacao(this.db, () => {
      this.db.exec('DELETE FROM eventos; DELETE FROM clientes;')
      for (const c of clientes) this.gravarCliente(c, true)
      for (const e of eventos) this.gravarEvento(e, true)
      this.db
        .prepare("INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
        .run(JSON.stringify(config))
      const maior = eventos.reduce((m, e) => Math.max(m, e.codigo), 0)
      gravarMeta(this.db, 'proximo_codigo', Math.max(proximoCodigo, maior + 1))
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'tudo', acao: 'recarregar' })
    this.chamarExtensoes((x) => x.dadosSubstituidos?.(eventos, anteriores))
  }

  private aposSalvarEvento(evento: Evento, anterior: Evento | undefined, rev: number) {
    this.chamarExtensoes((x) => x.eventoSalvo?.(evento, anterior))
    const decorado = this.decorar(evento)
    this.publicar({ revisao: rev, tipo: 'evento', acao: 'salvo', dado: decorado })
    return decorado
  }

  private chamarExtensoes(fn: (x: ExtensaoRepositorio) => void) {
    for (const x of this.extensoes) {
      try {
        fn(x)
      } catch (e) {
        // Uma extensão com problema nunca pode impedir a gravação principal
        console.error('[extensão]', e)
      }
    }
  }

  private decorar(evento: Evento): Evento {
    return this.extensoes.reduce((e, x) => {
      try {
        return x.decorarEvento ? x.decorarEvento(e) : e
      } catch {
        return e
      }
    }, evento)
  }

  private verificarVersao(atual: { versao: number }, esperada: number | undefined, tipo: 'cliente' | 'evento') {
    if (esperada !== undefined && esperada !== atual.versao) {
      throw new ErroApi(
        409,
        tipo === 'cliente'
          ? 'Este cliente foi alterado por outra pessoa enquanto você editava.'
          : 'Este evento foi alterado por outra pessoa enquanto você editava.',
        { atual: tipo === 'evento' ? this.decorar(atual as Evento) : atual },
      )
    }
  }

  private exigirCliente(id: string) {
    if (!this.obterCliente(id)) throw new ErroApi(400, 'O cliente selecionado não existe mais. Escolha outro cliente.')
  }

  private proximoCodigo() {
    const codigo = Number(lerMeta(this.db, 'proximo_codigo') ?? 1)
    gravarMeta(this.db, 'proximo_codigo', codigo + 1)
    return codigo
  }

  private incrementarRevisao() {
    const rev = this.revisao() + 1
    gravarMeta(this.db, 'revisao', rev)
    return rev
  }

  private gravarCliente(c: Cliente, novo: boolean) {
    const { id, versao, criadoEm, atualizadoEm, ...dados } = c
    if (novo) {
      this.db
        .prepare('INSERT INTO clientes (id, dados, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
        .run(id, JSON.stringify(dados), versao, criadoEm, atualizadoEm)
    } else {
      this.db
        .prepare('UPDATE clientes SET dados = ?, versao = ?, atualizado_em = ? WHERE id = ?')
        .run(JSON.stringify(dados), versao, atualizadoEm, id)
    }
  }

  private gravarEvento(e: Evento, novo: boolean) {
    const { id, versao, codigo, criadoEm, atualizadoEm, google: _g, ...dados } = e
    if (novo) {
      this.db
        .prepare(
          'INSERT INTO eventos (id, codigo, cliente_id, dados, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, codigo, e.clienteId, JSON.stringify(dados), versao, criadoEm, atualizadoEm)
    } else {
      this.db
        .prepare('UPDATE eventos SET cliente_id = ?, dados = ?, versao = ?, atualizado_em = ? WHERE id = ?')
        .run(e.clienteId, JSON.stringify(dados), versao, atualizadoEm, id)
    }
  }

  private paraCliente(l: Linha): Cliente {
    return { ...JSON.parse(l.dados), id: l.id, versao: l.versao, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em }
  }

  private paraEvento(l: LinhaEvento): Evento {
    return {
      ...JSON.parse(l.dados),
      id: l.id,
      versao: l.versao,
      codigo: l.codigo,
      clienteId: l.cliente_id,
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    }
  }
}
