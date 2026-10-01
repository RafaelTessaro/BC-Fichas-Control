// Copia o banco de forma consistente: node server/ferramentas/copiar-banco.mjs <origem.db> <destino.db>
//
// Abrir o banco com o SQLite aplica o arquivo -wal que tenha ficado para trás (ex.: servidor
// encerrado à força) e o VACUUM INTO grava um único arquivo .db completo. Usado pelos scripts
// de atualização e restauração — nunca copie só o .db com o Explorer enquanto houver um -wal.

import { existsSync } from 'node:fs'

process.removeAllListeners('warning')
process.on('warning', (aviso) => {
  if (aviso.name !== 'ExperimentalWarning') console.warn(aviso)
})

const [origem, destino] = process.argv.slice(2)
if (!origem || !destino) {
  console.error('Uso: node server/ferramentas/copiar-banco.mjs <origem.db> <destino.db>')
  process.exit(2)
}
if (!existsSync(origem)) {
  console.error(`Banco não encontrado: ${origem}`)
  process.exit(1)
}
if (existsSync(destino)) {
  console.error(`O destino já existe: ${destino}`)
  process.exit(1)
}

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(origem)
const verificacao = db.prepare('PRAGMA integrity_check').get()
if (Object.values(verificacao)[0] !== 'ok') {
  console.error('Atenção: o banco de origem tem problemas de integridade:', verificacao)
}
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
db.close()
console.log(`Cópia gravada em ${destino}`)
