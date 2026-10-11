// Usuários pelo computador do servidor, sem passar pela tela: cria o administrador, redefine senhas,
// encerra sessões e cuida das contas ao voltar uma cópia .db. Usada pelos scripts do Windows
// (INSTALAR, ATUALIZAR, REDEFINIR-SENHA e restaurar-copia) e, no Linux, direto ou por `npm run usuarios`.
//
//   node server/ferramentas/redefinir-senha.mjs situacao <banco.db> [--base64]
//   node server/ferramentas/redefinir-senha.mjs definir <banco.db> [--base64]
//        entrada padrão: {"login":"admin","nome":"Fabio","senha":"","tornarAdmin":true,"trocarSenha":false}
//        (senha vazia: gera uma temporária, com troca obrigatória no primeiro acesso)
//   node server/ferramentas/redefinir-senha.mjs encerrar-sessoes <banco.db> [--base64]
//   node server/ferramentas/redefinir-senha.mjs transplantar <banco-atual.db> <banco-restaurado.db> [--contas-da-copia] [--base64]
//        mantém na cópia as contas atuais; com --contas-da-copia (ou se o banco atual não tiver nenhuma
//        conta, como num computador novo), as contas voltam como estavam na cópia
//
// A resposta é um JSON numa linha no stdout. Com --base64, a entrada e a resposta (inclusive a de erro)
// vão em base64 do UTF-8: o PowerShell estragaria os acentos na página de código do console.
// Saída: 0 ok; 1 erro ({"erro":"…"}); 2 uso incorreto. Usa o mesmo banco (abrirBanco, com as migrações)
// e o mesmo hash de senha do servidor; pode rodar com o servidor ligado. Nunca mostra hash nem token.

import { existsSync } from 'node:fs'

// O SQLite embutido e a leitura do TypeScript ainda são marcados como "experimentais" e imprimiriam um
// aviso no stderr: esconde só esse aviso, antes de carregar o código do servidor
process.removeAllListeners('warning')
process.on('warning', (aviso) => {
  if (aviso.name !== 'ExperimentalWarning') console.warn(aviso)
})

const USO = [
  'Uso: node server/ferramentas/redefinir-senha.mjs <comando> <banco.db> [--base64]',
  '  situacao <banco.db>                       usuários e administradores ativos',
  '  definir <banco.db>                        cria o administrador ou redefine a senha (JSON na entrada padrão)',
  '  encerrar-sessoes <banco.db>               encerra todas as sessões abertas',
  '  transplantar <atual.db> <restaurado.db>   mantém os usuários atuais na cópia que vai voltar',
  '      [--contas-da-copia]                   (ou deixa os da cópia: trocar o servidor de computador)',
].join('\n')

/** Quantos bancos cada comando recebe. */
const COMANDOS = { situacao: 1, definir: 1, 'encerrar-sessoes': 1, transplantar: 2 }

const argumentos = process.argv.slice(2)
const base64 = argumentos.includes('--base64')
const contasDaCopia = argumentos.includes('--contas-da-copia')
const [comando, ...bancos] = argumentos.filter((a) => a !== '--base64' && a !== '--contas-da-copia')

/** Escreve a resposta (JSON numa linha, ou o base64 dele) e define o código de saída. */
function responder(resposta, codigo = 0) {
  const json = JSON.stringify(resposta)
  process.stdout.write(`${base64 ? Buffer.from(json, 'utf8').toString('base64') : json}\n`)
  process.exitCode = codigo
}

const mensagem = (e) => (e instanceof Error ? e.message : String(e))

/** Lê a entrada padrão inteira (assíncrono: a leitura síncrona falha com pipe no Windows). */
async function lerEntrada() {
  const partes = []
  for await (const parte of process.stdin) partes.push(parte)
  return Buffer.concat(partes).toString('utf8')
}

/** Fecha o banco com tudo gravado no próprio arquivo .db: o script move só ele, sem o -wal ao lado. */
function fecharGravado(db) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

/** Fecha o banco atual (só lido) do mesmo jeito, sem deixar um erro dele derrubar a resposta. */
function fecharSemErro(db) {
  if (!db) return
  try {
    fecharGravado(db)
  } catch {
    // banco ilegível: nada a fazer
  }
}

/** Faz o comando e devolve a resposta; a resposta só sai depois de os bancos estarem fechados. */
async function principal() {
  if (
    !Object.hasOwn(COMANDOS, comando) ||
    bancos.length !== COMANDOS[comando] ||
    bancos.some((b) => !b) ||
    (contasDaCopia && comando !== 'transplantar')
  ) {
    return [{ erro: USO }, 2]
  }

  let entrada
  if (comando === 'definir') {
    if (process.stdin.isTTY) {
      const exemplo = `echo '{"login":"admin","tornarAdmin":true}' | node server/ferramentas/redefinir-senha.mjs definir <banco.db>`
      return [{ erro: `Mande o JSON pela entrada padrão, ex.: ${exemplo}` }, 2]
    }
    let texto = (await lerEntrada()).trim()
    try {
      if (base64) texto = Buffer.from(texto, 'base64').toString('utf8')
      entrada = JSON.parse(texto)
    } catch {
      entrada = undefined
    }
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      return [{ erro: 'Entrada inválida: mande um JSON como {"login":"admin","senha":"","tornarAdmin":true}.' }, 2]
    }
  }

  // Nunca cria um banco vazio (no transplantar, só a cópia restaurada precisa existir)
  const banco = comando === 'transplantar' ? bancos[1] : bancos[0]
  if (!existsSync(banco)) return [{ erro: `Banco não encontrado: ${banco}` }, 1]

  const { abrirBanco } = await import('../db.ts')
  const { ServicoUsuarios, transplantarUsuarios } = await import('../usuarios.ts')

  if (comando === 'transplantar')
    return [transplantar(abrirBanco, ServicoUsuarios, transplantarUsuarios, bancos[0], banco, contasDaCopia), 0]

  const db = abrirBanco(banco)
  try {
    const usuarios = new ServicoUsuarios(db)
    if (comando === 'situacao') return [usuarios.situacao(), 0]
    if (comando === 'encerrar-sessoes') return [{ encerradas: usuarios.encerrarTodasAsSessoes() }, 0]
    const { usuario, criado, senhaTemporaria } = await usuarios.definirSenhaLocal(entrada)
    const resposta = { login: usuario.login, nome: usuario.nome, nivel: usuario.nivel, criado, trocarSenha: usuario.trocarSenha }
    return [senhaTemporaria ? { ...resposta, senhaTemporaria } : resposta, 0]
  } finally {
    db.close()
  }
}

/** Logins de um banco aberto, em ordem alfabética (sem hash nem nada da conta além do login). */
const loginsDe = (db) =>
  db
    .prepare('SELECT login FROM usuarios ORDER BY login')
    .all()
    .map((l) => l.login)

/**
 * Restauração de uma cópia .db: a cópia (`arquivoRestaurado`, que ainda não foi posta no lugar) recebe
 * os usuários e o registro de atividades do banco atual, e perde todas as sessões. As contas voltam como
 * estavam na cópia (só as sessões são apagadas) quando o banco atual não pode ser lido, quando ele não
 * tem nenhuma conta (computador novo) ou com `contasDaCopia` (trocar o servidor de computador).
 * A resposta traz os logins dos dois bancos, para o script dizer o que ficou de fora.
 */
function transplantar(abrirBanco, ServicoUsuarios, transplantarUsuarios, arquivoAtual, arquivoRestaurado, contasDaCopia) {
  const restaurado = abrirBanco(arquivoRestaurado)
  let atual = null
  try {
    const loginsCopia = loginsDe(restaurado)
    let problema = ''
    let loginsAtuais = []
    try {
      if (!existsSync(arquivoAtual)) throw new Error('o arquivo não existe')
      atual = abrirBanco(arquivoAtual)
      // Lê antes tudo o que vai ser copiado: um banco estragado (um dos motivos para voltar uma cópia)
      // falha aqui, sem impedir a restauração
      atual.prepare('SELECT * FROM usuarios').all()
      atual.prepare('SELECT * FROM auditoria').all()
      loginsAtuais = loginsDe(atual)
    } catch (e) {
      problema = mensagem(e)
      fecharSemErro(atual)
      atual = null
    }
    const motivo = !atual
      ? `O banco atual não pôde ser lido: ${problema}; as contas voltaram como estavam na cópia.`
      : contasDaCopia
        ? 'As contas voltaram como estavam na cópia, como pedido.'
        : loginsAtuais.length === 0
          ? 'O banco atual não tinha contas; as contas voltaram como estavam na cópia.'
          : ''
    if (motivo) {
      restaurado.exec('DELETE FROM sessoes')
      const detalhe = !atual
        ? 'o banco atual não pôde ser lido; as contas voltaram como estavam na cópia'
        : contasDaCopia
          ? 'as contas voltaram como estavam na cópia (pedido ao restaurar)'
          : 'o banco atual não tinha contas; as contas voltaram como estavam na cópia'
      new ServicoUsuarios(restaurado).registrar('COPIA_RESTAURADA', { ip: 'local', detalhe })
      return { transplantado: false, aviso: motivo, loginsCopia, loginsAtuais }
    }
    const r = transplantarUsuarios(atual, restaurado)
    return { transplantado: true, usuarios: r.usuarios, auditoria: r.auditoria, loginsCopia, loginsAtuais }
  } finally {
    fecharSemErro(atual)
    fecharGravado(restaurado)
  }
}

try {
  responder(...(await principal()))
} catch (e) {
  responder({ erro: mensagem(e) }, 1)
}
