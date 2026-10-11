import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Banco = DatabaseSync

/**
 * Migrações do esquema. Cada item roda uma única vez, em ordem, controlado
 * pelo `PRAGMA user_version`. Nunca altere um item já publicado — acrescente outro.
 */
const MIGRACOES: string[] = [
  `
  CREATE TABLE clientes (
    id            TEXT PRIMARY KEY,
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE TABLE eventos (
    id            TEXT PRIMARY KEY,
    codigo        INTEGER NOT NULL UNIQUE,
    cliente_id    TEXT NOT NULL REFERENCES clientes(id),
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE INDEX eventos_cliente ON eventos(cliente_id);
  CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  INSERT INTO meta (chave, valor) VALUES ('revisao', '0'), ('proximo_codigo', '1');
  `,
  // Máquinas (P e G) e ordens de serviço de manutenção
  `
  CREATE TABLE maquinas (
    id            TEXT PRIMARY KEY,
    identificacao TEXT NOT NULL,
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE UNIQUE INDEX maquinas_identificacao ON maquinas(identificacao COLLATE NOCASE);
  CREATE TABLE ordens_servico (
    id            TEXT PRIMARY KEY,
    numero        INTEGER NOT NULL UNIQUE,
    maquina_id    TEXT NOT NULL REFERENCES maquinas(id),
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE INDEX ordens_maquina ON ordens_servico(maquina_id);
  INSERT INTO meta (chave, valor) VALUES ('proxima_os', '1');
  `,
  // Reclamações de clientes sobre as máquinas e arquivos anexados aos eventos
  `
  CREATE TABLE reclamacoes (
    id            TEXT PRIMARY KEY,
    maquina_id    TEXT NOT NULL REFERENCES maquinas(id),
    evento_id     TEXT NOT NULL DEFAULT '',
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE INDEX reclamacoes_maquina ON reclamacoes(maquina_id);
  CREATE TABLE anexos (
    id        TEXT PRIMARY KEY,
    evento_id TEXT NOT NULL,
    nome      TEXT NOT NULL,
    tipo      TEXT NOT NULL,
    tamanho   INTEGER NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX anexos_evento ON anexos(evento_id);
  `,
  // 4: contratos de locação (os dados do contrato ficam congelados no JSON; sem chave estrangeira
  // para o evento: o contrato é um documento emitido e continua no histórico)
  `
  CREATE TABLE contratos (
    id            TEXT PRIMARY KEY,
    numero        INTEGER NOT NULL UNIQUE,
    evento_id     TEXT NOT NULL DEFAULT '',
    cliente_id    TEXT NOT NULL DEFAULT '',
    dados         TEXT NOT NULL,
    versao        INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE INDEX contratos_evento ON contratos(evento_id);
  `,
  // 5: usuários, sessões e registro de atividades (fora do backup JSON e do Repositorio)
  `
  CREATE TABLE usuarios (
    id                TEXT PRIMARY KEY,
    login             TEXT NOT NULL,              -- já normalizado (minúsculo)
    nome              TEXT NOT NULL,
    nivel             TEXT NOT NULL CHECK (nivel IN ('ADMIN','COMUM')),
    senha_hash        TEXT NOT NULL,              -- '$scrypt$ln=15,r=8,p=3$<sal>$<hash>'
    ativo             INTEGER NOT NULL DEFAULT 1,
    trocar_senha      INTEGER NOT NULL DEFAULT 0,
    versao            INTEGER NOT NULL,
    criado_em         TEXT NOT NULL,
    atualizado_em     TEXT NOT NULL,
    senha_alterada_em TEXT NOT NULL,
    ultimo_acesso_em  TEXT NOT NULL DEFAULT '',
    ultimo_acesso_ip  TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX usuarios_login ON usuarios(login);
  CREATE TABLE sessoes (
    id          TEXT PRIMARY KEY,                 -- SHA-256 (hex) do token; o token só existe no cookie
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criada_em   INTEGER NOT NULL,                 -- epoch ms
    usada_em    INTEGER NOT NULL,                 -- última atividade (gravada no máx. a cada 5 min)
    expira_em   INTEGER NOT NULL,                 -- limite absoluto
    persistente INTEGER NOT NULL DEFAULT 0,       -- "manter conectado"
    ip          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX sessoes_usuario ON sessoes(usuario_id);
  CREATE TABLE auditoria (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    em         TEXT NOT NULL,
    usuario_id TEXT NOT NULL DEFAULT '',
    login      TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    acao       TEXT NOT NULL,
    alvo       TEXT NOT NULL DEFAULT '',
    detalhe    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX auditoria_em ON auditoria(em);
  `,
]

export function abrirBanco(arquivo: string): Banco {
  if (arquivo !== ':memory:') mkdirSync(dirname(arquivo), { recursive: true })
  const db = new DatabaseSync(arquivo)
  // busy_timeout primeiro: o servidor e a ferramenta de senha podem abrir ao mesmo tempo um banco ainda
  // sem -wal (o serviço subindo), e passar para WAL também precisa da trava
  db.exec('PRAGMA busy_timeout = 5000')
  ativarWal(db)
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `)
  migrar(db)
  return db
}

/**
 * Passa o banco para WAL. Num banco novo (ou numa cópia feita com VACUUM INTO), dois processos convertendo
 * ao mesmo tempo travariam um ao outro: o SQLite recusa um deles na hora, sem esperar, e ele tenta de novo
 * (até 10 s); quando conseguir, o outro já converteu.
 */
function ativarWal(db: Banco) {
  const limite = Date.now() + 10_000
  for (;;) {
    try {
      db.exec('PRAGMA journal_mode = WAL')
      return
    } catch (e) {
      if (Date.now() >= limite || !/database is locked/.test(String((e as Error)?.message))) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
}

function migrar(db: Banco) {
  const versao = () => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (let i = versao(); i < MIGRACOES.length; i++) {
    transacao(db, () => {
      // Relida já com a trava de escrita (BEGIN IMMEDIATE): o servidor e a ferramenta de senha podem abrir
      // o mesmo banco ao mesmo tempo, e só um deles aplica cada migração
      if (versao() > i) return
      db.exec(MIGRACOES[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
    })
  }
}

const emTransacao = new WeakSet<Banco>()

/** Executa `fn` dentro de uma transação; chamadas aninhadas reaproveitam a transação externa. */
export function transacao<T>(db: Banco, fn: () => T): T {
  if (emTransacao.has(db)) return fn()
  db.exec('BEGIN IMMEDIATE')
  emTransacao.add(db)
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally {
    emTransacao.delete(db)
  }
}

export function lerMeta(db: Banco, chave: string): string | undefined {
  const linha = db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave) as { valor: string } | undefined
  return linha?.valor
}

export function gravarMeta(db: Banco, chave: string, valor: string | number) {
  db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(
    chave,
    String(valor),
  )
}
