import {
  atualizarEventoAntigo,
  CONFIG_PADRAO,
  hojeLocalIso,
  LIMITES,
  listaServicos,
  MAQUINA_VAZIA,
  normalizarCliente,
  normalizarConfig,
  normalizarEvento,
  normalizarMaquina,
  normalizarOS,
  normalizarPatch,
  normalizarReclamacao,
  validarBackup,
} from '#shared/dominio.ts'
import { novoId } from '#shared/id.ts'
import {
  chaveIdentificacao,
  conflitosMaquinas,
  datasOcupadas,
  listaDatas,
  ordenarMaquinas,
  planoAjuste,
  STATUS_MAQUINA_LISTA,
  TIPOS_MAQUINA,
} from '#shared/maquinas.ts'
import { gerarDadosExemplo, SERVICOS_EXEMPLO } from '#shared/seed.ts'
import type {
  Anexo,
  Backup,
  Cliente,
  Configuracoes,
  DadosCompletos,
  Evento,
  Maquina,
  MensagemTempoReal,
  OrdemServico,
  Reclamacao,
  StatusMaquina,
  TipoMaquina,
} from '#shared/tipos.ts'
import { gravarMeta, lerMeta, transacao, type Banco } from './db.ts'
import { ErroApi, naoEncontrado } from './erros.ts'
import type { ExtensaoRepositorio } from './extensoes.ts'

type Linha = { id: string; dados: string; versao: number; criado_em: string; atualizado_em: string }
type LinhaEvento = Linha & { codigo: number; cliente_id: string }
type LinhaOS = Linha & { numero: number; maquina_id: string }
type LinhaReclamacao = Linha & { maquina_id: string; evento_id: string }
type LinhaAnexo = { id: string; evento_id: string; nome: string; tipo: string; tamanho: number; criado_em: string }

/** Arquivos por evento (limite de segurança). */
export const LIMITE_ANEXOS_POR_EVENTO = 100

/** Na O.S., pedido opcional para mudar a situação da máquina junto (ex.: "Em manutenção" ao abrir). */
function statusMaquinaPedido(corpo: unknown): StatusMaquina | undefined {
  const v = (corpo as { statusMaquina?: unknown } | null)?.statusMaquina
  return STATUS_MAQUINA_LISTA.includes(v as StatusMaquina) ? (v as StatusMaquina) : undefined
}

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

  listarMaquinas(): Maquina[] {
    const linhas = this.db.prepare('SELECT * FROM maquinas').all() as Linha[]
    return ordenarMaquinas(linhas.map((l) => this.paraMaquina(l)))
  }

  obterMaquina(id: string): Maquina | undefined {
    const l = this.db.prepare('SELECT * FROM maquinas WHERE id = ?').get(id) as Linha | undefined
    return l && this.paraMaquina(l)
  }

  listarOrdens(): OrdemServico[] {
    const linhas = this.db.prepare('SELECT * FROM ordens_servico ORDER BY numero DESC').all() as LinhaOS[]
    return linhas.map((l) => this.paraOS(l))
  }

  obterOrdem(id: string): OrdemServico | undefined {
    const l = this.db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(id) as LinhaOS | undefined
    return l && this.paraOS(l)
  }

  listarReclamacoes(): Reclamacao[] {
    const linhas = this.db.prepare('SELECT * FROM reclamacoes').all() as LinhaReclamacao[]
    return linhas
      .map((l) => this.paraReclamacao(l))
      .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm))
  }

  obterReclamacao(id: string): Reclamacao | undefined {
    const l = this.db.prepare('SELECT * FROM reclamacoes WHERE id = ?').get(id) as LinhaReclamacao | undefined
    return l && this.paraReclamacao(l)
  }

  listarAnexos(eventoId?: string): Anexo[] {
    const linhas = (
      eventoId
        ? this.db.prepare('SELECT * FROM anexos WHERE evento_id = ? ORDER BY criado_em').all(eventoId)
        : this.db.prepare('SELECT * FROM anexos ORDER BY criado_em').all()
    ) as LinhaAnexo[]
    return linhas.map((l) => this.paraAnexo(l))
  }

  obterAnexo(id: string): Anexo | undefined {
    const l = this.db.prepare('SELECT * FROM anexos WHERE id = ?').get(id) as LinhaAnexo | undefined
    return l && this.paraAnexo(l)
  }

  dadosCompletos(): DadosCompletos {
    return {
      clientes: this.listarClientes(),
      eventos: this.listarEventos(),
      maquinas: this.listarMaquinas(),
      ordens: this.listarOrdens(),
      reclamacoes: this.listarReclamacoes(),
      anexos: this.listarAnexos(),
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
      this.verificarDocumentoUnico(cliente.documento)
      this.gravarCliente(cliente, true)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'cliente', acao: 'salvo', dado: cliente })
    return cliente
  }

  /** Atualiza o cliente. Com `versaoEsperada`, recusa (409) se outra pessoa já alterou. */
  atualizarCliente(id: string, entrada: unknown, versaoEsperada?: number): Cliente {
    const dados = validar(normalizarCliente(entrada))
    const { cliente, anterior, rev } = transacao(this.db, () => {
      const atual = this.obterCliente(id)
      if (!atual) throw naoEncontrado('Cliente')
      this.verificarVersao(atual, versaoEsperada, 'cliente')
      // Só confere quando o documento muda: cadastros duplicados antigos (ex.: vindos de um
      // backup de antes da regra) continuam editáveis
      if (dados.documento !== atual.documento) this.verificarDocumentoUnico(dados.documento, id)
      const cliente: Cliente = { ...atual, ...dados, versao: atual.versao + 1, atualizadoEm: agora() }
      this.gravarCliente(cliente, false)
      return { cliente, anterior: atual, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'cliente', acao: 'salvo', dado: cliente })
    this.chamarExtensoes((x) => x.clienteSalvo?.(cliente, anterior))
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
      this.exigirMaquinas(dados.maquinasIds)
      this.verificarMaquinasLivres({ ...dados, id: undefined })
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
      this.exigirMaquinas(dados.maquinasIds)
      this.verificarMaquinasLivres({ ...dados, id }, anterior)
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
      // Reativar um evento cancelado confere as máquinas dele de novo (podem ter ido para outro evento)
      this.verificarMaquinasLivres({ ...evento, id }, anterior, 'Abra o evento e troque a máquina.')
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
      // As máquinas são escolhidas de novo (a cópia costuma ser para outra data)
      maquinasIds: [],
      bobinasDevolvidas: null,
      formaPagamento: 'NAO_PAGO',
      dataPagamento: '',
      status: 'EM_ABERTO',
      programacao: 'NAO_INICIADA',
      // A cópia é um evento novo: vale a cidade do cliente (o formulário não tem mais o campo)
      cidade: '',
    })
  }

  excluirEvento(id: string) {
    const { evento, rev } = transacao(this.db, () => {
      const evento = this.obterEventoBruto(id)
      if (!evento) throw naoEncontrado('Evento')
      // Os arquivos anexados saem junto (os do disco são apagados pela extensão de anexos);
      // as reclamações ficam no histórico das máquinas
      this.db.prepare('DELETE FROM anexos WHERE evento_id = ?').run(id)
      this.db.prepare('DELETE FROM eventos WHERE id = ?').run(id)
      return { evento, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'evento', acao: 'excluido', id })
    this.chamarExtensoes((x) => x.eventoExcluido?.(evento))
  }

  // ---- Configurações ---------------------------------------------------------

  salvarConfig(entrada: unknown): Configuracoes {
    // A lista de serviços de manutenção tem gravação própria (salvarServicos): aqui fica como está
    const config = { ...validar(normalizarConfig(entrada)), servicosManutencao: this.obterConfig().servicosManutencao }
    return this.gravarConfig(config)
  }

  /** Grava só a lista de serviços de manutenção (cadastrados na tela de manutenção). */
  salvarServicos(entrada: unknown): Configuracoes {
    const lista = (entrada as { servicos?: unknown } | null)?.servicos
    if (!Array.isArray(lista)) throw new ErroApi(400, 'Lista de serviços inválida.')
    if (lista.length > LIMITES.catalogoServicos) {
      throw new ErroApi(400, `Cadastre no máximo ${LIMITES.catalogoServicos} serviços.`)
    }
    return this.gravarConfig({ ...this.obterConfig(), servicosManutencao: listaServicos(lista, LIMITES.catalogoServicos) })
  }

  private gravarConfig(config: Configuracoes): Configuracoes {
    const rev = transacao(this.db, () => {
      this.db
        .prepare("INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
        .run(JSON.stringify(config))
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'config', acao: 'salvo', dado: config })
    return config
  }

  // ---- Máquinas --------------------------------------------------------------

  criarMaquina(entrada: unknown): Maquina {
    const dados = validar(normalizarMaquina(entrada))
    const ts = agora()
    const maquina: Maquina = { ...dados, id: novoId(), versao: 1, criadoEm: ts, atualizadoEm: ts }
    const rev = transacao(this.db, () => {
      this.verificarIdentificacaoUnica(maquina.identificacao)
      this.gravarMaquina(maquina, true)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'maquina', acao: 'salvo', dado: maquina })
    return maquina
  }

  /** Atualiza a máquina. Com `versaoEsperada`, recusa (409) se outra pessoa já alterou. */
  atualizarMaquina(id: string, entrada: unknown, versaoEsperada?: number): Maquina {
    const dados = validar(normalizarMaquina(entrada))
    const { maquina, anterior, rev } = transacao(this.db, () => {
      const atual = this.obterMaquina(id)
      if (!atual) throw naoEncontrado('Máquina', 'a')
      this.verificarVersao(atual, versaoEsperada, 'maquina')
      this.verificarIdentificacaoUnica(dados.identificacao, id)
      const maquina: Maquina = { ...atual, ...dados, versao: atual.versao + 1, atualizadoEm: agora() }
      this.gravarMaquina(maquina, false)
      return { maquina, anterior: atual, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'maquina', acao: 'salvo', dado: maquina })
    this.chamarExtensoes((x) => x.maquinaSalva?.(maquina, anterior))
    return maquina
  }

  /** Só apaga máquinas sem histórico; as outras devem ser desativadas (o histórico fica). */
  excluirMaquina(id: string) {
    const rev = transacao(this.db, () => {
      if (!this.obterMaquina(id)) throw naoEncontrado('Máquina', 'a')
      const historico = this.historicoMaquina(id)
      if (historico) throw new ErroApi(409, `Esta máquina tem histórico (${historico}). Desative-a em vez de excluir.`)
      this.db.prepare('DELETE FROM maquinas WHERE id = ?').run(id)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'maquina', acao: 'excluido', id })
  }

  /**
   * Faz o tipo passar a ter `quantidade` máquinas (não desativadas): cadastra as que faltam com a
   * numeração seguinte; ao diminuir, apaga as sem histórico e desativa as demais (ver `planoAjuste`).
   */
  ajustarQuantidade(entrada: unknown) {
    const r = (entrada ?? {}) as { tipo?: unknown; quantidade?: unknown }
    const tipo = r.tipo as TipoMaquina
    const quantidade = Number(r.quantidade)
    if (!TIPOS_MAQUINA.includes(tipo)) throw new ErroApi(400, 'Tipo de máquina inválido.')
    if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > LIMITES.maquinas) {
      throw new ErroApi(400, 'Quantidade de máquinas inválida.')
    }
    const mensagens: MensagemTempoReal[] = []
    const resultado = transacao(this.db, () => {
      const maquinas = this.listarMaquinas()
      const plano = planoAjuste(
        maquinas,
        this.listarEventosBrutos(),
        this.listarOrdens(),
        tipo,
        quantidade,
        hojeLocalIso(),
        this.listarReclamacoes(),
      )
      if (plano.criar.length > LIMITES.lote) {
        throw new ErroApi(400, `Cadastre no máximo ${LIMITES.lote} máquinas de uma vez.`)
      }
      if (plano.faltam) {
        throw new ErroApi(
          409,
          `Não é possível retirar ${plano.faltam} máquina${plano.faltam > 1 ? 's' : ''}: as outras estão em manutenção ou têm eventos de hoje em diante.`,
          { plano },
        )
      }
      const ts = agora()
      const criadas = plano.criar.map((identificacao) => {
        const m: Maquina = { ...MAQUINA_VAZIA, tipo, identificacao, id: novoId(), versao: 1, criadoEm: ts, atualizadoEm: ts }
        this.gravarMaquina(m, true)
        mensagens.push({ revisao: this.incrementarRevisao(), tipo: 'maquina', acao: 'salvo', dado: m })
        return m
      })
      for (const m of plano.excluir) {
        this.db.prepare('DELETE FROM maquinas WHERE id = ?').run(m.id)
        mensagens.push({ revisao: this.incrementarRevisao(), tipo: 'maquina', acao: 'excluido', id: m.id })
      }
      const desativadas = plano.desativar.map((atual) => {
        const m: Maquina = { ...atual, status: 'DESATIVADA', versao: atual.versao + 1, atualizadoEm: ts }
        this.gravarMaquina(m, false)
        mensagens.push({ revisao: this.incrementarRevisao(), tipo: 'maquina', acao: 'salvo', dado: m })
        return m
      })
      return { criadas, excluidas: plano.excluir.map((m) => m.id), desativadas }
    })
    for (const msg of mensagens) this.publicar(msg)
    return resultado
  }

  // ---- Ordens de serviço -----------------------------------------------------

  /** Cria a O.S.; `statusMaquina` no corpo muda a situação da máquina na mesma gravação. */
  criarOrdem(entrada: unknown): OrdemServico {
    const dados = validar(normalizarOS(entrada))
    const statusMaquina = statusMaquinaPedido(entrada)
    const { ordem, maquina, rev, revMaquina } = transacao(this.db, () => {
      const ts = agora()
      const ordem: OrdemServico = { ...dados, id: novoId(), versao: 1, numero: this.proximaOS(), criadoEm: ts, atualizadoEm: ts }
      const maquina = this.mudarStatusMaquina(this.exigirMaquina(dados.maquinaId), statusMaquina)
      this.gravarOS(ordem, true)
      const rev = this.incrementarRevisao()
      return { ordem, maquina, rev, revMaquina: maquina ? this.incrementarRevisao() : 0 }
    })
    this.publicar({ revisao: rev, tipo: 'os', acao: 'salvo', dado: ordem })
    if (maquina) this.publicar({ revisao: revMaquina, tipo: 'maquina', acao: 'salvo', dado: maquina })
    return ordem
  }

  atualizarOrdem(id: string, entrada: unknown, versaoEsperada?: number): OrdemServico {
    const dados = validar(normalizarOS(entrada))
    const statusMaquina = statusMaquinaPedido(entrada)
    const { ordem, maquina, rev, revMaquina } = transacao(this.db, () => {
      const atual = this.obterOrdem(id)
      if (!atual) throw naoEncontrado('Manutenção', 'a')
      this.verificarVersao(atual, versaoEsperada, 'os')
      const maquina = this.mudarStatusMaquina(this.exigirMaquina(dados.maquinaId), statusMaquina)
      const ordem: OrdemServico = { ...atual, ...dados, versao: atual.versao + 1, atualizadoEm: agora() }
      this.gravarOS(ordem, false)
      const rev = this.incrementarRevisao()
      return { ordem, maquina, rev, revMaquina: maquina ? this.incrementarRevisao() : 0 }
    })
    this.publicar({ revisao: rev, tipo: 'os', acao: 'salvo', dado: ordem })
    if (maquina) this.publicar({ revisao: revMaquina, tipo: 'maquina', acao: 'salvo', dado: maquina })
    return ordem
  }

  excluirOrdem(id: string) {
    const rev = transacao(this.db, () => {
      if (!this.obterOrdem(id)) throw naoEncontrado('Manutenção', 'a')
      this.db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(id)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'os', acao: 'excluido', id })
  }

  // ---- Reclamações de clientes -----------------------------------------------

  criarReclamacao(entrada: unknown): Reclamacao {
    const dados = validar(normalizarReclamacao(entrada))
    const { reclamacao, rev } = transacao(this.db, () => {
      this.exigirMaquina(dados.maquinaId)
      if (dados.eventoId && !this.obterEventoBruto(dados.eventoId))
        throw new ErroApi(400, 'O evento selecionado não existe mais.')
      const ts = agora()
      const reclamacao: Reclamacao = { ...dados, id: novoId(), versao: 1, criadoEm: ts, atualizadoEm: ts }
      this.gravarReclamacao(reclamacao, true)
      return { reclamacao, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'reclamacao', acao: 'salvo', dado: reclamacao })
    return reclamacao
  }

  atualizarReclamacao(id: string, entrada: unknown, versaoEsperada?: number): Reclamacao {
    const dados = validar(normalizarReclamacao(entrada))
    const { reclamacao, rev } = transacao(this.db, () => {
      const atual = this.obterReclamacao(id)
      if (!atual) throw naoEncontrado('Reclamação', 'a')
      this.verificarVersao(atual, versaoEsperada, 'reclamacao')
      this.exigirMaquina(dados.maquinaId)
      // Evento que foi excluído depois continua aceito na edição (é o que já estava gravado)
      if (dados.eventoId && dados.eventoId !== atual.eventoId && !this.obterEventoBruto(dados.eventoId)) {
        throw new ErroApi(400, 'O evento selecionado não existe mais.')
      }
      const reclamacao: Reclamacao = { ...atual, ...dados, versao: atual.versao + 1, atualizadoEm: agora() }
      this.gravarReclamacao(reclamacao, false)
      return { reclamacao, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'reclamacao', acao: 'salvo', dado: reclamacao })
    return reclamacao
  }

  excluirReclamacao(id: string) {
    const rev = transacao(this.db, () => {
      if (!this.obterReclamacao(id)) throw naoEncontrado('Reclamação', 'a')
      this.db.prepare('DELETE FROM reclamacoes WHERE id = ?').run(id)
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'reclamacao', acao: 'excluido', id })
  }

  // ---- Arquivos anexados aos eventos (o conteúdo fica no disco, ver rotas/anexos.ts) ----

  /** Registra um arquivo já gravado no disco. `gravarArquivo` roda dentro da transação. */
  registrarAnexo(dados: Omit<Anexo, 'id' | 'criadoEm'>, gravarArquivo: (id: string) => void): Anexo {
    const { anexo, rev } = transacao(this.db, () => {
      if (!this.obterEventoBruto(dados.eventoId)) throw naoEncontrado('Evento')
      const { qtd } = this.db.prepare('SELECT COUNT(*) AS qtd FROM anexos WHERE evento_id = ?').get(dados.eventoId) as {
        qtd: number
      }
      if (qtd >= LIMITE_ANEXOS_POR_EVENTO) {
        throw new ErroApi(409, `Este evento já tem ${LIMITE_ANEXOS_POR_EVENTO} arquivos. Apague algum antes de anexar outro.`)
      }
      const anexo: Anexo = { ...dados, id: novoId(), criadoEm: agora() }
      gravarArquivo(anexo.id)
      this.db
        .prepare('INSERT INTO anexos (id, evento_id, nome, tipo, tamanho, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(anexo.id, anexo.eventoId, anexo.nome, anexo.tipo, anexo.tamanho, anexo.criadoEm)
      return { anexo, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'anexo', acao: 'salvo', dado: anexo })
    return anexo
  }

  /** Apaga o registro do arquivo e devolve o que foi apagado (para a rota apagar o conteúdo). */
  excluirAnexo(id: string): Anexo {
    const { anexo, rev } = transacao(this.db, () => {
      const anexo = this.obterAnexo(id)
      if (!anexo) throw naoEncontrado('Arquivo')
      this.db.prepare('DELETE FROM anexos WHERE id = ?').run(id)
      return { anexo, rev: this.incrementarRevisao() }
    })
    this.publicar({ revisao: rev, tipo: 'anexo', acao: 'excluido', id })
    return anexo
  }

  // ---- Backup, exemplo e limpeza ---------------------------------------------

  exportar(): Backup {
    return {
      app: 'bc-fichas-control',
      versao: 4,
      exportadoEm: agora(),
      clientes: this.listarClientes(),
      eventos: this.listarEventosBrutos(),
      maquinas: this.listarMaquinas(),
      ordens: this.listarOrdens(),
      reclamacoes: this.listarReclamacoes(),
      config: this.obterConfig(),
      proximoCodigo: Number(lerMeta(this.db, 'proximo_codigo') ?? 1),
      proximaOS: Number(lerMeta(this.db, 'proxima_os') ?? 1),
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
    this.substituirTudo(backup)
    return { clientes: backup.clientes.length, eventos: backup.eventos.length, maquinas: backup.maquinas.length }
  }

  /**
   * Acrescenta os dados de um backup aos que já existem, sem apagar nada (usado para trazer
   * os dados que cada computador guardava no navegador na versão anterior).
   * - cliente com o mesmo id já existente é ignorado; com o mesmo CNPJ/CPF, reaproveita o existente;
   * - evento com o mesmo id é ignorado; código repetido ganha um novo número;
   * - máquina com o mesmo id ou a mesma identificação (ex.: "P-01") é a mesma máquina;
   * - O.S. com o mesmo id é ignorada; número repetido ganha um novo número;
   * - as configurações do servidor não mudam.
   */
  mesclar(entrada: unknown) {
    let backup: Backup
    try {
      backup = validarBackup(entrada)
    } catch (e) {
      throw new ErroApi(400, (e as Error).message)
    }
    const resultado = { clientes: 0, eventos: 0, maquinas: 0, ordens: 0, reclamacoes: 0, ignorados: 0 }
    const novosEventos: Evento[] = []
    const rev = transacao(this.db, () => {
      const existentes = this.listarClientes()
      const porId = new Set(existentes.map((c) => c.id))
      const porDocumento = new Map(existentes.filter((c) => c.documento).map((c) => [c.documento, c.id]))
      const mapaCliente = new Map<string, string>()
      for (const c of backup.clientes) {
        if (porId.has(c.id)) {
          mapaCliente.set(c.id, c.id)
          resultado.ignorados++
        } else if (c.documento && porDocumento.has(c.documento)) {
          mapaCliente.set(c.id, porDocumento.get(c.documento)!)
          resultado.ignorados++
        } else {
          this.gravarCliente(c, true)
          porId.add(c.id)
          if (c.documento) porDocumento.set(c.documento, c.id)
          mapaCliente.set(c.id, c.id)
          resultado.clientes++
        }
      }
      // Máquinas: mesma identificação = mesma máquina física
      const maquinasExistentes = this.listarMaquinas()
      const maquinaPorId = new Set(maquinasExistentes.map((m) => m.id))
      const maquinaPorIdent = new Map(maquinasExistentes.map((m) => [chaveIdentificacao(m.identificacao), m.id]))
      const mapaMaquina = new Map<string, string>()
      for (const m of backup.maquinas) {
        const mesma = maquinaPorId.has(m.id) ? m.id : maquinaPorIdent.get(chaveIdentificacao(m.identificacao))
        if (mesma) {
          mapaMaquina.set(m.id, mesma)
          resultado.ignorados++
          continue
        }
        this.gravarMaquina(m, true)
        maquinaPorId.add(m.id)
        maquinaPorIdent.set(chaveIdentificacao(m.identificacao), m.id)
        mapaMaquina.set(m.id, m.id)
        resultado.maquinas++
      }
      const idsOS = new Set(this.listarOrdens().map((o) => o.id))
      const numerosOS = new Set(this.listarOrdens().map((o) => o.numero))
      for (const o of [...backup.ordens].sort((a, b) => a.numero - b.numero)) {
        if (idsOS.has(o.id)) {
          resultado.ignorados++
          continue
        }
        const numero = numerosOS.has(o.numero) ? this.proximaOS() : o.numero
        this.gravarOS({ ...o, numero, maquinaId: mapaMaquina.get(o.maquinaId) ?? o.maquinaId }, true)
        numerosOS.add(numero)
        resultado.ordens++
      }
      const maiorOS = Math.max(0, ...numerosOS)
      if (Number(lerMeta(this.db, 'proxima_os') ?? 1) <= maiorOS) gravarMeta(this.db, 'proxima_os', maiorOS + 1)

      const idsEventos = new Set(this.listarEventosBrutos().map((e) => e.id))
      const codigos = new Set(
        (this.db.prepare('SELECT codigo FROM eventos').all() as Array<{ codigo: number }>).map((l) => l.codigo),
      )
      for (const e of [...backup.eventos].sort((a, b) => a.codigo - b.codigo)) {
        if (idsEventos.has(e.id)) {
          resultado.ignorados++
          continue
        }
        const codigo = codigos.has(e.codigo) ? this.proximoCodigo() : e.codigo
        const evento: Evento = {
          ...e,
          codigo,
          clienteId: mapaCliente.get(e.clienteId) ?? e.clienteId,
          maquinasIds: [...new Set(e.maquinasIds.map((id) => mapaMaquina.get(id) ?? id))],
        }
        this.gravarEvento(evento, true)
        codigos.add(codigo)
        novosEventos.push(evento)
        resultado.eventos++
      }
      const maior = Math.max(0, ...codigos)
      if (Number(lerMeta(this.db, 'proximo_codigo') ?? 1) <= maior) gravarMeta(this.db, 'proximo_codigo', maior + 1)

      const idsReclamacoes = new Set(this.listarReclamacoes().map((r) => r.id))
      const eventosAgora = new Set(this.listarEventosBrutos().map((e) => e.id))
      for (const r of backup.reclamacoes) {
        if (idsReclamacoes.has(r.id)) {
          resultado.ignorados++
          continue
        }
        const eventoId = r.eventoId && eventosAgora.has(r.eventoId) ? r.eventoId : ''
        this.gravarReclamacao({ ...r, maquinaId: mapaMaquina.get(r.maquinaId) ?? r.maquinaId, eventoId }, true)
        resultado.reclamacoes++
      }
      return this.incrementarRevisao()
    })
    this.publicar({ revisao: rev, tipo: 'tudo', acao: 'recarregar' })
    for (const e of novosEventos) this.chamarExtensoes((x) => x.eventoSalvo?.(e, undefined))
    return resultado
  }

  carregarExemplo() {
    const { qtd } = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM clientes) + (SELECT COUNT(*) FROM eventos) + (SELECT COUNT(*) FROM maquinas) AS qtd')
      .get() as { qtd: number }
    if (qtd > 0) throw new ErroApi(409, 'Os dados de exemplo só podem ser carregados com o sistema vazio.')
    const config = this.obterConfig()
    // A lista de serviços vazia ganha os serviços usados no exemplo
    if (!config.servicosManutencao.length) config.servicosManutencao = [...SERVICOS_EXEMPLO]
    this.substituirTudo({ ...gerarDadosExemplo(new Date()), config })
  }

  limparTudo() {
    this.substituirTudo({
      clientes: [],
      eventos: [],
      maquinas: [],
      ordens: [],
      reclamacoes: [],
      config: this.obterConfig(),
      proximoCodigo: 1,
      proximaOS: 1,
    })
  }

  // ---- Internos --------------------------------------------------------------

  private substituirTudo(dados: Omit<Backup, 'app' | 'versao' | 'exportadoEm'>) {
    const { clientes, eventos, maquinas, ordens, reclamacoes, config } = dados
    const anteriores = this.listarEventosBrutos()
    const rev = transacao(this.db, () => {
      this.db.exec(
        'DELETE FROM reclamacoes; DELETE FROM ordens_servico; DELETE FROM eventos; DELETE FROM maquinas; DELETE FROM clientes;',
      )
      for (const c of clientes) this.gravarCliente(c, true)
      for (const m of maquinas) this.gravarMaquina(m, true)
      for (const o of ordens) this.gravarOS(o, true)
      for (const e of eventos) this.gravarEvento(e, true)
      for (const r of reclamacoes) this.gravarReclamacao(r, true)
      // Arquivos de eventos que deixaram de existir saem (o conteúdo é apagado pela extensão de anexos)
      const ficam = new Set(eventos.map((e) => e.id))
      for (const a of this.listarAnexos()) {
        if (!ficam.has(a.eventoId)) this.db.prepare('DELETE FROM anexos WHERE id = ?').run(a.id)
      }
      this.db
        .prepare("INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
        .run(JSON.stringify(config))
      const maior = eventos.reduce((m, e) => Math.max(m, e.codigo), 0)
      gravarMeta(this.db, 'proximo_codigo', Math.max(dados.proximoCodigo, maior + 1))
      const maiorOS = ordens.reduce((m, o) => Math.max(m, o.numero), 0)
      gravarMeta(this.db, 'proxima_os', Math.max(dados.proximaOS, maiorOS + 1))
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

  private verificarVersao(
    atual: { versao: number },
    esperada: number | undefined,
    tipo: 'cliente' | 'evento' | 'maquina' | 'os' | 'reclamacao',
  ) {
    if (esperada !== undefined && esperada !== atual.versao) {
      const qual = {
        cliente: 'Este cliente',
        evento: 'Este evento',
        maquina: 'Esta máquina',
        os: 'Esta manutenção',
        reclamacao: 'Esta reclamação',
      }[tipo]
      const genero = tipo === 'cliente' || tipo === 'evento' ? 'alterado' : 'alterada'
      throw new ErroApi(409, `${qual} foi ${genero} por outra pessoa enquanto você editava.`, {
        atual: tipo === 'evento' ? this.decorar(atual as Evento) : atual,
      })
    }
  }

  /** Impede duas máquinas com a mesma identificação (sem diferenciar maiúsculas). */
  private verificarIdentificacaoUnica(identificacao: string, idIgnorado?: string) {
    const chave = chaveIdentificacao(identificacao)
    const outra = this.listarMaquinas().find((m) => m.id !== idIgnorado && chaveIdentificacao(m.identificacao) === chave)
    if (outra) {
      throw new ErroApi(409, `Já existe uma máquina com a identificação ${outra.identificacao}.`, {
        duplicado: { id: outra.id, identificacao: outra.identificacao },
      })
    }
  }

  /** "2 manutenções e 3 eventos", ou vazio se a máquina nunca foi usada nem passou por manutenção. */
  private historicoMaquina(id: string) {
    const { os } = this.db.prepare('SELECT COUNT(*) AS os FROM ordens_servico WHERE maquina_id = ?').get(id) as { os: number }
    const { rec } = this.db.prepare('SELECT COUNT(*) AS rec FROM reclamacoes WHERE maquina_id = ?').get(id) as { rec: number }
    const eventos = this.listarEventosBrutos().filter((e) => e.maquinasIds.includes(id)).length
    const partes = []
    if (os) partes.push(`${os} ${os > 1 ? 'manutenções' : 'manutenção'}`)
    if (rec) partes.push(`${rec} ${rec > 1 ? 'reclamações' : 'reclamação'}`)
    if (eventos) partes.push(`${eventos} evento${eventos > 1 ? 's' : ''}`)
    return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes.join('')
  }

  private exigirMaquina(id: string): Maquina {
    const m = this.obterMaquina(id)
    if (!m) throw new ErroApi(400, 'A máquina selecionada não existe mais.')
    return m
  }

  private exigirMaquinas(ids: string[]) {
    if (!ids.length) return
    const existentes = new Set(this.listarMaquinas().map((m) => m.id))
    if (ids.some((id) => !existentes.has(id))) {
      throw new ErroApi(400, 'Uma das máquinas selecionadas não existe mais. Confira a lista de máquinas enviadas.')
    }
  }

  /**
   * Recusa (409) mandar para o evento uma máquina que não pode ir: desativada; em manutenção
   * (se o evento tem dias de hoje em diante); ou em outro evento nas mesmas datas. Vale para
   * máquinas acrescentadas e para dias acrescentados — o que já estava gravado não é cobrado de
   * novo, para não travar a edição de eventos antigos.
   */
  private verificarMaquinasLivres(
    evento: Pick<Evento, 'dias' | 'maquinasIds' | 'status'> & { id: string | undefined; periodoCorrido?: boolean },
    anterior?: Evento,
    /** O que dizer para resolver (na troca rápida de status não há máquinas para escolher). */
    saida = 'Escolha outra máquina.',
  ) {
    // A mesma regra de trocasMaquinas (src/lib/bloqueioMaquinas.ts), que a tela usa antes de salvar.
    // Os dias são os ocupados (ver diasOcupados): com período corrido, também os do meio.
    if (evento.status === 'CANCELADO' || !evento.maquinasIds.length) return
    const hoje = hojeLocalIso()
    const valeAnterior = anterior && anterior.status !== 'CANCELADO'
    const antes = new Set(valeAnterior ? anterior.maquinasIds : [])
    const gravadas = new Set(anterior?.maquinasIds ?? [])
    const ocupados = datasOcupadas(evento)
    const diasAntes = new Set(valeAnterior ? datasOcupadas(anterior) : [])
    const diasNovos = ocupados.filter((d) => !diasAntes.has(d))
    const temFuturo = ocupados.some((d) => d >= hoje)
    const novoFuturo = diasNovos.some((d) => d >= hoje)
    const maquinas = new Map(this.listarMaquinas().map((m) => [m.id, m]))
    const novas = evento.maquinasIds.filter((id) => !antes.has(id))
    const jaEstavam = diasNovos.length ? evento.maquinasIds.filter((id) => antes.has(id)) : []
    for (const id of [...novas, ...jaEstavam]) {
      const m = maquinas.get(id)
      const futuro = antes.has(id) ? novoFuturo : temFuturo
      // Desativada que já estava num evento que já passou (ex.: reativar um cancelado antigo) é histórico
      if (m?.status === 'DESATIVADA' && (futuro || !gravadas.has(id))) {
        throw new ErroApi(409, `A máquina ${m.identificacao} está desativada. ${saida}`)
      }
      if (m?.status === 'MANUTENCAO' && futuro) {
        throw new ErroApi(
          409,
          `A máquina ${m.identificacao} está em manutenção. ${saida.replace(/\.$/, '')} ou conclua a manutenção antes.`,
        )
      }
    }
    // Máquinas novas em todos os dias ocupados; as que já estavam, só nos dias acrescentados
    const comoDias = (datas: string[]) => datas.map((data) => ({ id: data, data, maquinas: 1 }))
    const eventos = this.listarEventosBrutos()
    const conflitos = [
      ...conflitosMaquinas({ id: evento.id, dias: comoDias(ocupados), maquinasIds: novas }, eventos),
      ...conflitosMaquinas({ id: evento.id, dias: comoDias(diasNovos), maquinasIds: jaEstavam }, eventos),
    ]
    if (!conflitos.length) return
    const [maquinaId, outros] = conflitos[0]
    const outro = outros[0]
    // Só as datas que causam a recusa (para a que já estava, os dias acrescentados)
    const datas = new Set(novas.includes(maquinaId) ? ocupados : diasNovos)
    // Resumida como na tela ("07/11, 08/11, 09/11 e mais 20 dias"): com período corrido podem ser muitas
    const emComum = listaDatas(datasOcupadas(outro).filter((d) => datas.has(d)))
    const cliente = this.obterCliente(outro.clienteId)?.nome
    throw new ErroApi(
      409,
      `A máquina ${maquinas.get(maquinaId)?.identificacao ?? ''} já está no evento #${String(outro.codigo).padStart(4, '0')} ${outro.nome}${cliente ? ` (${cliente})` : ''} em ${emComum}. ${saida}`,
      { conflitos: conflitos.map(([id, evs]) => ({ maquinaId: id, eventos: evs.map((e) => e.id) })) },
    )
  }

  /** Grava a nova situação da máquina (dentro da transação de quem chama); `undefined` se nada mudou. */
  private mudarStatusMaquina(maquina: Maquina, status: StatusMaquina | undefined): Maquina | undefined {
    if (!status || status === maquina.status) return undefined
    const nova: Maquina = { ...maquina, status, versao: maquina.versao + 1, atualizadoEm: agora() }
    this.gravarMaquina(nova, false)
    return nova
  }

  /** Impede dois clientes com o mesmo CNPJ/CPF (avulsos, sem documento, ficam de fora). */
  private verificarDocumentoUnico(documento: string, idIgnorado?: string) {
    if (!documento) return
    const outro = this.listarClientes().find((c) => c.id !== idIgnorado && c.documento === documento)
    if (outro) {
      throw new ErroApi(409, `Já existe um cliente com este ${documento.length > 14 ? 'CNPJ' : 'CPF'}: ${outro.nome}.`, {
        duplicado: { id: outro.id, nome: outro.nome },
      })
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

  private proximaOS() {
    const numero = Number(lerMeta(this.db, 'proxima_os') ?? 1)
    gravarMeta(this.db, 'proxima_os', numero + 1)
    return numero
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

  private gravarMaquina(m: Maquina, novo: boolean) {
    const { id, versao, criadoEm, atualizadoEm, ...dados } = m
    if (novo) {
      this.db
        .prepare('INSERT INTO maquinas (id, identificacao, dados, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, m.identificacao, JSON.stringify(dados), versao, criadoEm, atualizadoEm)
    } else {
      this.db
        .prepare('UPDATE maquinas SET identificacao = ?, dados = ?, versao = ?, atualizado_em = ? WHERE id = ?')
        .run(m.identificacao, JSON.stringify(dados), versao, atualizadoEm, id)
    }
  }

  private gravarOS(o: OrdemServico, novo: boolean) {
    const { id, versao, numero, criadoEm, atualizadoEm, ...dados } = o
    if (novo) {
      this.db
        .prepare(
          'INSERT INTO ordens_servico (id, numero, maquina_id, dados, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, numero, o.maquinaId, JSON.stringify(dados), versao, criadoEm, atualizadoEm)
    } else {
      this.db
        .prepare('UPDATE ordens_servico SET maquina_id = ?, dados = ?, versao = ?, atualizado_em = ? WHERE id = ?')
        .run(o.maquinaId, JSON.stringify(dados), versao, atualizadoEm, id)
    }
  }

  private gravarReclamacao(r: Reclamacao, novo: boolean) {
    const { id, versao, criadoEm, atualizadoEm, ...dados } = r
    if (novo) {
      this.db
        .prepare(
          'INSERT INTO reclamacoes (id, maquina_id, evento_id, dados, versao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, r.maquinaId, r.eventoId, JSON.stringify(dados), versao, criadoEm, atualizadoEm)
    } else {
      this.db
        .prepare('UPDATE reclamacoes SET maquina_id = ?, evento_id = ?, dados = ?, versao = ?, atualizado_em = ? WHERE id = ?')
        .run(r.maquinaId, r.eventoId, JSON.stringify(dados), versao, atualizadoEm, id)
    }
  }

  private paraReclamacao(l: LinhaReclamacao): Reclamacao {
    return {
      ...JSON.parse(l.dados),
      id: l.id,
      versao: l.versao,
      maquinaId: l.maquina_id,
      eventoId: l.evento_id,
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    }
  }

  private paraAnexo(l: LinhaAnexo): Anexo {
    return { id: l.id, eventoId: l.evento_id, nome: l.nome, tipo: l.tipo, tamanho: l.tamanho, criadoEm: l.criado_em }
  }

  private paraMaquina(l: Linha): Maquina {
    return { ...JSON.parse(l.dados), id: l.id, versao: l.versao, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em }
  }

  private paraOS(l: LinhaOS): OrdemServico {
    return {
      ...JSON.parse(l.dados),
      id: l.id,
      versao: l.versao,
      numero: l.numero,
      maquinaId: l.maquina_id,
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    }
  }

  private paraCliente(l: Linha): Cliente {
    return { ...JSON.parse(l.dados), id: l.id, versao: l.versao, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em }
  }

  private paraEvento(l: LinhaEvento): Evento {
    // Eventos gravados por versões anteriores: valores padrão; o antigo "local" e o cabeçalho
    // das fichas vão para as observações (e ficam gravados assim na próxima alteração do evento)
    const bruto = JSON.parse(l.dados)
    const { local: _l, ...dados } = bruto
    const evento: Evento = {
      cabecalho: '',
      maquinasIds: [],
      ...dados,
      observacoes: String(dados.observacoes ?? ''),
      id: l.id,
      versao: l.versao,
      codigo: l.codigo,
      clienteId: l.cliente_id,
      criadoEm: l.criado_em,
      atualizadoEm: l.atualizado_em,
    }
    return atualizarEventoAntigo(evento, bruto)
  }
}
