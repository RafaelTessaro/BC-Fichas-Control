// A ferramenta de usuários rodando de verdade (processo separado, como nos scripts do Windows)
// contra bancos temporários em arquivo.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco, type Banco } from '../db.ts'
import { conferirSenha, PARAMETROS_LEVES } from '../senha.ts'
import { ServicoUsuarios } from '../usuarios.ts'

const FERRAMENTA = fileURLToPath(new URL('./redefinir-senha.mjs', import.meta.url))
const SENHA_FORTE = 'cavalo-azul-pulando'
const ADMIN_TESTE = { id: 'teste', login: 'teste', nome: 'Teste', nivel: 'ADMIN' as const, trocarSenha: false }

interface Execucao {
  status: number | null
  stdout: string
  stderr: string
  /** Resposta já decodificada (o JSON, ou o base64 dele com `--base64`). */
  json: Record<string, unknown>
}

/** Roda a ferramenta; com `base64`, manda a entrada e lê a resposta em base64. */
function rodar(args: string[], entrada?: unknown, base64 = false): Execucao {
  const texto = entrada === undefined ? '' : typeof entrada === 'string' ? entrada : JSON.stringify(entrada)
  const r = spawnSync(process.execPath, [FERRAMENTA, ...args, ...(base64 ? ['--base64'] : [])], {
    input: base64 ? Buffer.from(texto, 'utf8').toString('base64') + '\r\n' : texto,
    encoding: 'utf8',
  })
  const linha = r.stdout.trim()
  const json = linha ? JSON.parse(base64 ? Buffer.from(linha, 'base64').toString('utf8') : linha) : {}
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

let pasta: string
let banco: string

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-redefinir-'))
  banco = join(pasta, 'bc-fichas.db')
  abrirBanco(banco).close()
})
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

/** Abre o banco, roda `fn` e fecha (a ferramenta usa o arquivo em outro processo). */
async function comBanco<T>(arquivo: string, fn: (db: Banco) => T | Promise<T>): Promise<T> {
  const db = abrirBanco(arquivo)
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

type Linha = Record<string, string | number>
const linhaUsuario = (arquivo: string, login: string) =>
  comBanco(arquivo, (db) => db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login) as Linha | undefined)
const contar = (arquivo: string, sql: string, ...params: string[]) =>
  comBanco(arquivo, (db) => Number((db.prepare(sql).get(...params) as { n: number }).n))

/** Sessões abertas direto no banco (como o servidor grava no login). */
function abrirSessoes(db: Banco, usuarioId: string, quantas: number) {
  const agora = Date.now()
  for (let i = 0; i < quantas; i++)
    db.prepare('INSERT INTO sessoes (id, usuario_id, criada_em, usada_em, expira_em) VALUES (?, ?, ?, ?, ?)').run(
      `${usuarioId}-${i}-${Math.random()}`,
      usuarioId,
      agora,
      agora,
      agora + 3_600_000,
    )
}

/** Cadastra um usuário comum pelo serviço (como o administrador faria pela tela). */
const cadastrarComum = (arquivo: string, login: string, nome: string) =>
  comBanco(arquivo, async (db) => {
    const r = await new ServicoUsuarios(db, { parametrosSenha: PARAMETROS_LEVES }).criar(
      { nome, login, nivel: 'COMUM', senha: '' },
      ADMIN_TESTE,
      '127.0.0.1',
    )
    return r.usuario.id
  })

describe('redefinir-senha.mjs', { timeout: 60_000 }, () => {
  it('situacao num banco sem usuários', () => {
    const r = rodar(['situacao', banco])
    expect(r.status).toBe(0)
    expect(r.json).toEqual({ usuarios: 0, administradoresAtivos: 0, lista: [] })
    expect(r.stderr).toBe('')
  })

  it('definir cria o administrador com senha temporária quando não há nenhum', async () => {
    const r = rodar(['definir', banco], { login: 'Admin', nome: 'Fabio', senha: '', tornarAdmin: true })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.json).toMatchObject({ login: 'admin', nome: 'Fabio', nivel: 'ADMIN', criado: true, trocarSenha: true })
    const temporaria = r.json.senhaTemporaria as string
    expect(temporaria).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)

    const linha = (await linhaUsuario(banco, 'admin'))!
    expect(linha).toMatchObject({ nivel: 'ADMIN', ativo: 1, trocar_senha: 1 })
    expect(await conferirSenha(temporaria, String(linha.senha_hash))).toBe(true)
    // A saída nunca leva o hash
    expect(r.stdout).not.toContain('$scrypt$')
    expect(r.stdout).not.toContain(String(linha.senha_hash).split('$').pop())

    const s = rodar(['situacao', banco])
    expect(s.json).toEqual({
      usuarios: 1,
      administradoresAtivos: 1,
      lista: [{ login: 'admin', nome: 'Fabio', nivel: 'ADMIN', ativo: true }],
    })
    expect(await contar(banco, "SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'FERRAMENTA_LOCAL'")).toBe(1)
  })

  it('conta nova nasce administrador mesmo sem tornarAdmin', () => {
    const r = rodar(['definir', banco], { login: 'chefe', nome: 'Chefe', senha: SENHA_FORTE })
    expect(r.status).toBe(0)
    expect(r.json).toMatchObject({ login: 'chefe', nivel: 'ADMIN', criado: true, trocarSenha: false })
    expect(r.json.senhaTemporaria).toBeUndefined()
  })

  it('redefine com senha gerada (troca obrigatória) e digitada (com e sem troca)', async () => {
    rodar(['definir', banco], { login: 'admin', nome: 'Fabio', senha: SENHA_FORTE })
    const antes = (await linhaUsuario(banco, 'admin'))!

    const gerada = rodar(['definir', banco], { login: 'admin' })
    expect(gerada.status).toBe(0)
    expect(gerada.json).toMatchObject({ login: 'admin', nome: 'Fabio', criado: false, trocarSenha: true })
    expect(gerada.json.senhaTemporaria).toBeTruthy()
    let linha = (await linhaUsuario(banco, 'admin'))!
    expect(linha.trocar_senha).toBe(1)
    expect(linha.id).toBe(antes.id)
    expect(await conferirSenha(gerada.json.senhaTemporaria as string, String(linha.senha_hash))).toBe(true)

    const digitada = rodar(['definir', banco], { login: 'admin', senha: 'girafa-roxa-dormindo' })
    expect(digitada.json).toMatchObject({ criado: false, trocarSenha: false })
    expect(digitada.json.senhaTemporaria).toBeUndefined()
    linha = (await linhaUsuario(banco, 'admin'))!
    expect(linha.trocar_senha).toBe(0)
    expect(await conferirSenha('girafa-roxa-dormindo', String(linha.senha_hash))).toBe(true)

    const temporaria = rodar(['definir', banco], { login: 'admin', senha: 'girafa-roxa-dormindo', trocarSenha: true })
    expect(temporaria.json).toMatchObject({ trocarSenha: true })
    expect((await linhaUsuario(banco, 'admin'))!.trocar_senha).toBe(1)
  })

  it('promove o usuário comum, reativa a conta e apaga só as sessões dela', async () => {
    rodar(['definir', banco], { login: 'admin', nome: 'Fabio', senha: SENHA_FORTE })
    const idMaria = await cadastrarComum(banco, 'maria', 'Maria Souza')
    const idAdmin = String((await linhaUsuario(banco, 'admin'))!.id)
    await comBanco(banco, (db) => {
      db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(idMaria)
      abrirSessoes(db, idMaria, 2)
      abrirSessoes(db, idAdmin, 1)
    })

    const r = rodar(['definir', banco], { login: 'maria', senha: 'girafa-roxa-dormindo', tornarAdmin: true })
    expect(r.status).toBe(0)
    expect(r.json).toMatchObject({ login: 'maria', nome: 'Maria Souza', nivel: 'ADMIN', criado: false })
    expect(await linhaUsuario(banco, 'maria')).toMatchObject({ nivel: 'ADMIN', ativo: 1 })
    expect(await contar(banco, 'SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?', idMaria)).toBe(0)
    expect(await contar(banco, 'SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?', idAdmin)).toBe(1)
    const detalhe = await comBanco(
      banco,
      (db) =>
        (db.prepare("SELECT detalhe FROM auditoria WHERE acao = 'FERRAMENTA_LOCAL' ORDER BY id DESC LIMIT 1").get() as Linha)
          .detalhe,
    )
    expect(detalhe).toContain('COMUM → ADMIN')

    // Sem tornarAdmin, o nível fica como está
    await cadastrarComum(banco, 'joao', 'João Lima')
    expect(rodar(['definir', banco], { login: 'joao' }).json).toMatchObject({ nivel: 'COMUM' })
  })

  it('encerrar-sessoes apaga todas as sessões', async () => {
    rodar(['definir', banco], { login: 'admin', senha: SENHA_FORTE })
    const id = String((await linhaUsuario(banco, 'admin'))!.id)
    await comBanco(banco, (db) => abrirSessoes(db, id, 3))
    const r = rodar(['encerrar-sessoes', banco])
    expect(r.status).toBe(0)
    expect(r.json).toEqual({ encerradas: 3 })
    expect(await contar(banco, 'SELECT COUNT(*) AS n FROM sessoes')).toBe(0)
  })

  it('recusa senha fraca e login inválido sem mexer no banco', async () => {
    rodar(['definir', banco], { login: 'admin', nome: 'Fabio', senha: SENHA_FORTE })
    const antes = (await linhaUsuario(banco, 'admin'))!

    const fraca = rodar(['definir', banco], { login: 'admin', senha: '12345678' })
    expect(fraca.status).toBe(1)
    expect(fraca.json.erro).toEqual(expect.any(String))
    expect(fraca.stderr).toBe('')
    const curta = rodar(['definir', banco], { login: 'admin', senha: 'abc' })
    expect(curta.status).toBe(1)
    expect(curta.json.erro).toBe('A senha precisa ter de 8 a 128 caracteres.')
    expect(rodar(['definir', banco], { login: 'admin', senha: 'fabio-123-aqui' }).json.erro).toBe(
      'A senha não pode conter o seu nome.',
    )
    expect(rodar(['definir', banco], { login: 'a b', senha: SENHA_FORTE }).status).toBe(1)

    expect((await linhaUsuario(banco, 'admin'))!.senha_hash).toBe(antes.senha_hash)
    expect(await contar(banco, 'SELECT COUNT(*) AS n FROM usuarios')).toBe(1)
  })

  it('recusa banco inexistente sem criar nada', () => {
    const inexistente = join(pasta, 'nao-existe', 'bc-fichas.db')
    for (const args of [
      ['situacao', inexistente],
      ['encerrar-sessoes', inexistente],
      ['transplantar', banco, inexistente],
    ]) {
      const r = rodar(args)
      expect(r.status).toBe(1)
      expect(r.json.erro).toBe(`Banco não encontrado: ${inexistente}`)
    }
    const definir = rodar(['definir', inexistente], { login: 'admin' })
    expect(definir.status).toBe(1)
    expect(existsSync(join(pasta, 'nao-existe'))).toBe(false)
  })

  it('uso incorreto e entrada inválida saem com código 2', () => {
    expect(rodar([]).status).toBe(2)
    expect(rodar(['apagar', banco]).status).toBe(2)
    expect(rodar(['situacao']).status).toBe(2)
    expect(rodar(['transplantar', banco]).status).toBe(2)
    const r = rodar(['definir', banco], 'isto não é JSON')
    expect(r.status).toBe(2)
    expect(r.json.erro).toMatch(/Entrada inválida/)
    expect(rodar(['definir', banco], '[1,2]').status).toBe(2)
  })

  it('--base64 nos dois sentidos, com acentos no nome e "ç" na senha', async () => {
    const senha = 'cachaça-de-maçã-verde'
    const r = rodar(['definir', banco], { login: 'joao', nome: 'João — Recepção', senha, tornarAdmin: true }, true)
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(r.json).toMatchObject({ login: 'joao', nome: 'João — Recepção', nivel: 'ADMIN', criado: true })
    const linha = (await linhaUsuario(banco, 'joao'))!
    expect(linha.nome).toBe('João — Recepção')
    expect(await conferirSenha(senha, String(linha.senha_hash))).toBe(true)
    // NFC: a mesma senha com o "ç" decomposto também confere
    expect(await conferirSenha(senha.normalize('NFD'), String(linha.senha_hash))).toBe(true)

    const s = rodar(['situacao', banco], undefined, true)
    expect((s.json.lista as Array<{ nome: string }>)[0].nome).toBe('João — Recepção')

    // O erro também sai em base64
    const erro = rodar(['definir', banco], { login: 'joao', senha: '123' }, true)
    expect(erro.status).toBe(1)
    expect(erro.stdout.trim()).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(erro.json.erro).toBe('A senha precisa ter de 8 a 128 caracteres.')
    expect(rodar(['situacao', join(pasta, 'x.db')], undefined, true).json.erro).toMatch(/^Banco não encontrado: /)
  })

  describe('transplantar', () => {
    let restaurado: string

    beforeEach(async () => {
      // A cópia que vai voltar: um usuário antigo, uma sessão e um cliente
      restaurado = join(pasta, 'bc-fichas.db.restaurando')
      await comBanco(restaurado, async (db) => {
        const r = await new ServicoUsuarios(db, { parametrosSenha: PARAMETROS_LEVES }).definirSenhaLocal({
          login: 'antigo',
          nome: 'Conta Antiga',
          senha: SENHA_FORTE,
        })
        abrirSessoes(db, r.usuario.id, 2)
        db.prepare("INSERT INTO clientes (id, dados, versao, criado_em, atualizado_em) VALUES ('c1', '{}', 1, 'x', 'x')").run()
      })
      // O banco atual: as contas de hoje
      rodar(['definir', banco], { login: 'admin', nome: 'Fabio', senha: SENHA_FORTE })
      await cadastrarComum(banco, 'maria', 'Maria Souza')
    })

    it('mantém as contas e o registro de atividades atuais na cópia, sem sessões', async () => {
      const auditoriaAtual = await contar(banco, 'SELECT COUNT(*) AS n FROM auditoria')
      const r = rodar(['transplantar', banco, restaurado])
      expect(r.status).toBe(0)
      expect(r.stderr).toBe('')
      expect(r.json).toEqual({ transplantado: true, usuarios: 2, auditoria: auditoriaAtual })
      // Tudo gravado no próprio .db: o script move só ele
      expect(existsSync(`${restaurado}-wal`)).toBe(false)
      expect(existsSync(`${banco}-wal`)).toBe(false)

      await comBanco(restaurado, (db) => {
        const logins = (db.prepare('SELECT login FROM usuarios ORDER BY login').all() as Linha[]).map((l) => l.login)
        expect(logins).toEqual(['admin', 'maria'])
        expect((db.prepare('SELECT COUNT(*) AS n FROM sessoes').get() as Linha).n).toBe(0)
        expect((db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as Linha).n).toBe(1)
        const ultima = db.prepare('SELECT acao FROM auditoria ORDER BY id DESC LIMIT 1').get() as Linha
        expect(ultima.acao).toBe('COPIA_RESTAURADA')
      })
    })

    it('cópia de antes da 2.6 (sem as tabelas de usuários) recebe as contas atuais', async () => {
      await comBanco(restaurado, (db) =>
        db.exec('DROP TABLE sessoes; DROP TABLE auditoria; DROP TABLE usuarios; PRAGMA user_version = 4'),
      )
      const r = rodar(['transplantar', banco, restaurado])
      expect(r.json).toMatchObject({ transplantado: true, usuarios: 2 })
      expect(await contar(restaurado, 'SELECT COUNT(*) AS n FROM usuarios')).toBe(2)
      expect(await contar(restaurado, 'SELECT COUNT(*) AS n FROM clientes')).toBe(1)
    })

    it('banco atual ausente ou estragado: as contas da cópia voltam, sem sessões, com aviso', async () => {
      const ausente = rodar(['transplantar', join(pasta, 'sumiu.db'), restaurado])
      expect(ausente.status).toBe(0)
      expect(ausente.json.transplantado).toBe(false)
      expect(ausente.json.aviso).toMatch(/^O banco atual não pôde ser lido: .*; as contas voltaram como estavam na cópia\.$/)
      expect(existsSync(join(pasta, 'sumiu.db'))).toBe(false)
      expect(await contar(restaurado, 'SELECT COUNT(*) AS n FROM sessoes')).toBe(0)
      expect(await contar(restaurado, "SELECT COUNT(*) AS n FROM usuarios WHERE login = 'antigo'")).toBe(1)
      expect(await contar(restaurado, "SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'COPIA_RESTAURADA'")).toBe(1)

      const estragado = join(pasta, 'estragado.db')
      writeFileSync(estragado, 'isto não é um banco SQLite '.repeat(200))
      const r = rodar(['transplantar', estragado, restaurado])
      expect(r.status).toBe(0)
      expect(r.json.transplantado).toBe(false)
      expect(await contar(restaurado, "SELECT COUNT(*) AS n FROM usuarios WHERE login = 'antigo'")).toBe(1)
    })
  })
})
