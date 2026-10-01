import type { Banco } from '../db.ts'

/** Configuração da integração (guardada na tabela própria `google_estado`). */
export interface ConfigGoogle {
  ativo: boolean
  calendarId: string
  incluirValores: boolean
}

export interface InfoGoogle {
  /** ISO da última rodada com envio bem-sucedido. */
  ultimaSincronizacao: string
  ultimoErro: string
  ultimoErroEm: string
}

export type StatusSync = 'pendente' | 'ok' | 'erro'

/** Situação de um evento do sistema em relação ao Google Agenda. */
export interface LinhaSync {
  evento_id: string
  status: StatusSync
  /** Agenda onde estão os ids enviados. */
  calendar_id: string
  /** JSON com a lista de ids enviados ao Google. */
  ids: string
  /** Impressão digital do último conteúdo enviado com sucesso. */
  hash: string
  erro: string
  tentativas: number
  /** Epoch em ms; 0 = assim que possível. */
  proxima_tentativa: number
  sincronizado_em: string
  /** 1 = o evento foi excluído do sistema e precisa ser apagado do Google. */
  excluido: number
  /** Aumenta a cada nova alteração; evita marcar como enviado um conteúdo desatualizado. */
  geracao: number
}

export const CONFIG_GOOGLE_PADRAO: ConfigGoogle = { ativo: false, calendarId: '', incluirValores: false }
const INFO_PADRAO: InfoGoogle = { ultimaSincronizacao: '', ultimoErro: '', ultimoErroEm: '' }

export const idsDaLinha = (l: Pick<LinhaSync, 'ids'>): string[] => {
  try {
    const v = JSON.parse(l.ids)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Acesso às tabelas da integração no banco SQLite. */
export class EstadoGoogle {
  private db: Banco
  private config: ConfigGoogle | null = null

  constructor(db: Banco) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS google_estado (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS google_sync (
        evento_id         TEXT PRIMARY KEY,
        status            TEXT NOT NULL DEFAULT 'pendente',
        calendar_id       TEXT NOT NULL DEFAULT '',
        ids               TEXT NOT NULL DEFAULT '[]',
        hash              TEXT NOT NULL DEFAULT '',
        erro              TEXT NOT NULL DEFAULT '',
        tentativas        INTEGER NOT NULL DEFAULT 0,
        proxima_tentativa INTEGER NOT NULL DEFAULT 0,
        sincronizado_em   TEXT NOT NULL DEFAULT '',
        excluido          INTEGER NOT NULL DEFAULT 0,
        geracao           INTEGER NOT NULL DEFAULT 1
      );
    `)
  }

  // ---- Configuração e informações gerais ---------------------------------------

  private ler<T extends object>(chave: string, padrao: T): T {
    const l = this.db.prepare('SELECT valor FROM google_estado WHERE chave = ?').get(chave) as { valor: string } | undefined
    if (!l) return { ...padrao }
    try {
      return { ...padrao, ...JSON.parse(l.valor) }
    } catch {
      return { ...padrao }
    }
  }

  private gravar(chave: string, valor: object) {
    this.db
      .prepare('INSERT INTO google_estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
      .run(chave, JSON.stringify(valor))
  }

  lerConfig(): ConfigGoogle {
    this.config ??= this.ler('config', CONFIG_GOOGLE_PADRAO)
    return { ...this.config }
  }

  gravarConfig(config: ConfigGoogle) {
    this.gravar('config', config)
    this.config = { ...config }
  }

  lerInfo(): InfoGoogle {
    return this.ler('info', INFO_PADRAO)
  }

  gravarInfo(parcial: Partial<InfoGoogle>) {
    this.gravar('info', { ...this.lerInfo(), ...parcial })
  }

  // ---- Situação de cada evento -------------------------------------------------

  obter(eventoId: string): LinhaSync | undefined {
    return this.db.prepare('SELECT * FROM google_sync WHERE evento_id = ?').get(eventoId) as LinhaSync | undefined
  }

  todas(): LinhaSync[] {
    return this.db.prepare('SELECT * FROM google_sync').all() as unknown as LinhaSync[]
  }

  /**
   * Marca o evento para ser (re)enviado. `excluido` = apagar do Google;
   * `forcar` = reenviar mesmo que o conteúdo não tenha mudado.
   */
  marcarPendente(eventoId: string, opcoes: { excluido?: boolean; forcar?: boolean } = {}) {
    this.db
      .prepare(
        `INSERT INTO google_sync (evento_id, status, excluido) VALUES (?, 'pendente', ?)
         ON CONFLICT(evento_id) DO UPDATE SET
           status = 'pendente', excluido = excluded.excluido, geracao = geracao + 1,
           tentativas = 0, proxima_tentativa = 0, erro = '',
           hash = CASE WHEN ? THEN '' ELSE hash END`,
      )
      .run(eventoId, opcoes.excluido ? 1 : 0, opcoes.forcar ? 1 : 0)
  }

  /** Pendências (e erros cujo prazo de nova tentativa já chegou), das mais antigas para as mais novas. */
  vencidas(agora: number): LinhaSync[] {
    return this.db
      .prepare(
        `SELECT * FROM google_sync WHERE status IN ('pendente', 'erro') AND proxima_tentativa <= ?
         ORDER BY proxima_tentativa, rowid`,
      )
      .all(agora) as unknown as LinhaSync[]
  }

  /** Há algo para enviar (agora ou mais tarde)? */
  temPendencias(): boolean {
    return !!this.db.prepare("SELECT 1 FROM google_sync WHERE status IN ('pendente', 'erro') LIMIT 1").get()
  }

  /** Grava o progresso parcial (ids já enviados) sem mudar o status. */
  gravarIds(eventoId: string, calendarId: string, ids: string[]) {
    this.db
      .prepare('UPDATE google_sync SET calendar_id = ?, ids = ? WHERE evento_id = ?')
      .run(calendarId, JSON.stringify(ids), eventoId)
  }

  /** Envio concluído. Se o evento mudou durante o envio, continua pendente. */
  concluir(l: LinhaSync, dados: { calendarId: string; ids: string[]; hash: string; em: string }) {
    this.db
      .prepare(
        `UPDATE google_sync SET calendar_id = ?, ids = ?, hash = ?, sincronizado_em = ?,
           status = CASE WHEN geracao = ? THEN 'ok' ELSE 'pendente' END,
           erro = '', tentativas = 0, proxima_tentativa = 0
         WHERE evento_id = ?`,
      )
      .run(dados.calendarId, JSON.stringify(dados.ids), dados.hash, dados.em, l.geracao, l.evento_id)
  }

  /** Remove o registro de um evento já apagado do Google (se não voltou a existir no meio tempo). */
  remover(l: LinhaSync) {
    this.db.prepare('DELETE FROM google_sync WHERE evento_id = ? AND geracao = ?').run(l.evento_id, l.geracao)
    // Voltou a existir (ex.: backup restaurado) durante o envio: limpa os ids já apagados
    this.db.prepare("UPDATE google_sync SET ids = '[]', hash = '' WHERE evento_id = ?").run(l.evento_id)
  }

  /** Falha no envio: agenda nova tentativa. */
  falhar(l: LinhaSync, erro: string, proximaTentativa: number) {
    this.db
      .prepare(
        `UPDATE google_sync SET erro = ?, tentativas = tentativas + 1,
           status = CASE WHEN geracao = ? THEN 'erro' ELSE 'pendente' END,
           proxima_tentativa = CASE WHEN geracao = ? THEN ? ELSE 0 END
         WHERE evento_id = ?`,
      )
      .run(erro, l.geracao, l.geracao, proximaTentativa, l.evento_id)
  }

  resumo(): { ok: number; pendentes: number; erros: number } {
    const r = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(status = 'ok' AND excluido = 0 AND ids <> '[]'), 0) AS ok,
           COALESCE(SUM(status = 'pendente'), 0) AS pendentes,
           COALESCE(SUM(status = 'erro'), 0) AS erros
         FROM google_sync`,
      )
      .get() as { ok: number; pendentes: number; erros: number }
    return { ok: Number(r.ok), pendentes: Number(r.pendentes), erros: Number(r.erros) }
  }
}
