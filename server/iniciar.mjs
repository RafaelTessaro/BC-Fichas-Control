// Inicializador do servidor (`npm start` ou `node server/iniciar.mjs`).
// Confere a versão do Node antes de carregar o código TypeScript.

import { fileURLToPath } from 'node:url'

const [maior, menor] = process.versions.node.split('.').map(Number)
if (maior < 22 || (maior === 22 && menor < 18)) {
  console.error(
    `\nO BC Fichas Control precisa do Node.js 22.18 ou mais novo (instalado: ${process.version}).\n` +
      'Baixe a versão LTS em https://nodejs.org, instale e tente de novo.\n',
  )
  process.exit(1)
}

// Caminhos relativos (.env, pasta de dados, interface compilada) partem sempre da pasta do projeto,
// mesmo quando o servidor é iniciado de outro diretório (ex.: pelo Agendador de Tarefas do Windows).
process.chdir(fileURLToPath(new URL('..', import.meta.url)))

// O SQLite embutido no Node ainda é marcado como "experimental" e imprime um aviso a cada
// inicialização; ele é estável para este uso, então escondemos só esse aviso.
process.removeAllListeners('warning')
process.on('warning', (aviso) => {
  if (aviso.name !== 'ExperimentalWarning') console.warn(aviso)
})

await import('./index.ts')
