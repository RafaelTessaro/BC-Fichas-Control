// Ponto de entrada do servidor: `npm start`.
//
// Variáveis de ambiente (opcionais, podem ficar no arquivo .env):
//   PORTA        porta HTTP (padrão 3000)
//   HOST         interface de rede (padrão 0.0.0.0 = acessível pela rede local)
//   PASTA_DADOS  onde ficam o banco e os backups (padrão ./dados)

import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { criarApp, VERSAO_APP } from './app.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const porta = Number(process.env.PORTA ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const pastaDados = process.env.PASTA_DADOS ?? 'dados'

const { app } = await criarApp({ pastaDados, logger: true, tarefasEmSegundoPlano: true })

try {
  await app.listen({ port: porta, host })
} catch (e) {
  const err = e as NodeJS.ErrnoException
  if (err.code === 'EADDRINUSE')
    console.error(`\nA porta ${porta} já está em uso. Feche o outro programa ou defina PORTA=3001.\n`)
  else console.error(e)
  process.exit(1)
}

const enderecos = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i!.address}:${porta}`)

console.log(`
  BC Fichas Control ${VERSAO_APP} — servidor iniciado

  Neste computador:   http://localhost:${porta}
${enderecos.map((e) => `  Na rede da empresa: ${e}`).join('\n')}

  Dados em: ${pastaDados}   (Ctrl+C para encerrar)
`)

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    console.log('\nEncerrando…')
    await app.close()
    process.exit(0)
  })
}
