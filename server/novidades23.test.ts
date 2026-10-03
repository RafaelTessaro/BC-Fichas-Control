import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Anexo, Backup, Cliente, DadosCompletos, Evento, Maquina, Reclamacao } from '#shared/tipos.ts'
import { criarApp, hostPermitido, lerHostsPermitidos } from './app.ts'
import { mensagemErroEmail, type CriarTransporte } from './email.ts'

const H = { 'x-bc-fichas': '1' }

let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']
/** Mensagens "enviadas" pelo transporte de teste. */
let enviados: Array<Record<string, unknown>>
let falharEnvio: Error | null

const transporteTeste: CriarTransporte = () => {
  const t = nodemailer.createTransport({ jsonTransport: true })
  return {
    sendMail: async (msg: Record<string, unknown>) => {
      if (falharEnvio) throw falharEnvio
      const info = await t.sendMail(msg)
      enviados.push(JSON.parse(String(info.message)))
      return info
    },
  } as unknown as ReturnType<CriarTransporte>
}

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-23-'))
  enviados = []
  falharEnvio = null
  ;({ app } = await criarApp({
    pastaDados: pasta,
    arquivoBanco: ':memory:',
    pastaEstatica: null,
    transporteEmail: transporteTeste,
  }))
})

afterEach(async () => {
  await app.close()
  rmSync(pasta, { recursive: true, force: true })
})

async function req<T = unknown>(method: string, url: string, payload?: unknown, esperado?: number) {
  const r = await app.inject({ method: method as 'GET', url, headers: H, payload: payload as object })
  if (esperado !== undefined) expect(r.statusCode, r.body).toBe(esperado)
  return { status: r.statusCode, json: (r.body ? r.json() : undefined) as T, headers: r.headers, body: r.body }
}

const dados = async () => (await req<DadosCompletos>('GET', '/api/dados')).json
const criarCliente = async () => (await req<Cliente>('POST', '/api/clientes', { tipo: 'AVULSO', nome: 'Barraca' }, 201)).json
const criarMaquina = async (identificacao: string, extra: object = {}) =>
  (await req<Maquina>('POST', '/api/maquinas', { tipo: identificacao[0], identificacao, ...extra }, 201)).json
const eventoCom = (clienteId: string, datas: string[], maquinasIds: string[] = [], extra: object = {}) => ({
  clienteId,
  nome: 'Festa',
  dias: datas.map((data, i) => ({ id: `d${i}`, data, maquinas: Math.max(1, maquinasIds.length) })),
  maquinasIds,
  status: 'EM_ABERTO',
  ...extra,
})

function enviarArquivo(eventoId: string, conteudo: Buffer, nome: string, tipo: string, cabecalhos: object = H) {
  return app.inject({
    method: 'POST',
    url: `/api/eventos/${eventoId}/anexos`,
    headers: { ...cabecalhos, 'content-type': 'application/octet-stream', 'x-nome': encodeURIComponent(nome), 'x-tipo': tipo },
    payload: conteudo,
  })
}

describe('reclamações de clientes', () => {
  it('registra, edita e apaga; a máquina com reclamação vira histórico', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2026-09-01'], [p1.id]), 201)).json

    const r = (
      await req<Reclamacao>('POST', '/api/reclamacoes', { maquinaId: p1.id, eventoId: e.id, descricao: ' Travando ' }, 201)
    ).json
    expect(r).toMatchObject({ maquinaId: p1.id, eventoId: e.id, descricao: 'Travando', versao: 1 })
    expect(r.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await dados()).reclamacoes).toHaveLength(1)

    expect((await req<{ erro: string }>('POST', '/api/reclamacoes', { maquinaId: p1.id })).json.erro).toBe(
      'Descreva o que o cliente relatou.',
    )
    expect((await req('POST', '/api/reclamacoes', { maquinaId: 'x', descricao: 'a' })).status).toBe(400)
    expect((await req('POST', '/api/reclamacoes', { maquinaId: p1.id, eventoId: 'sumiu', descricao: 'a' })).status).toBe(400)

    const editada = (await req<Reclamacao>('PUT', `/api/reclamacoes/${r.id}`, { ...r, descricao: 'Travando e reiniciando' }, 200))
      .json
    expect(editada.versao).toBe(2)
    expect((await req('PUT', `/api/reclamacoes/${r.id}`, { ...r, descricao: 'velha' })).status).toBe(409)

    // A máquina tem histórico: não pode ser apagada (só desativada)
    await req('DELETE', `/api/eventos/${e.id}`, undefined, 204)
    const apagar = await req<{ erro: string }>('DELETE', `/api/maquinas/${p1.id}`)
    expect(apagar.status).toBe(409)
    expect(apagar.json.erro).toMatch(/1 reclamação/)
    // Evento excluído: a reclamação continua no histórico da máquina
    expect((await dados()).reclamacoes[0].eventoId).toBe(e.id)

    await req('DELETE', `/api/reclamacoes/${r.id}`, undefined, 204)
    expect((await dados()).reclamacoes).toHaveLength(0)
    await req('DELETE', `/api/maquinas/${p1.id}`, undefined, 204)
  })

  it('vão no backup (versão 4 em diante), voltam na restauração e na mesclagem', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2026-09-01'], [p1.id]), 201)).json
    await req('POST', '/api/reclamacoes', { maquinaId: p1.id, eventoId: e.id, descricao: 'Impressão fraca' }, 201)
    const backup = (await req<Backup>('GET', '/api/backup')).json
    expect(backup.versao).toBe(6)
    expect(backup.reclamacoes).toHaveLength(1)

    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    expect((await dados()).reclamacoes).toHaveLength(0)
    await req('POST', '/api/backup/restaurar', backup, 200)
    expect((await dados()).reclamacoes[0]).toMatchObject({ descricao: 'Impressão fraca', eventoId: e.id })

    // Mesclar o mesmo backup não duplica
    const m = await req<{ reclamacoes: number }>('POST', '/api/backup/mesclar', backup, 200)
    expect(m.json.reclamacoes).toBe(0)
  })
})

describe('serviços de manutenção cadastrados', () => {
  it('lista própria, sem repetição; salvar as configurações não mexe nela', async () => {
    expect((await dados()).config.servicosManutencao).toEqual([])
    const r = await req<{ servicosManutencao: string[] }>(
      'PUT',
      '/api/config/servicos',
      { servicos: [' troca de cabeçote ', 'Higienização', 'TROCA DE CABECOTE', '', 'Revisão'] },
      200,
    )
    expect(r.json.servicosManutencao).toEqual(['Troca de cabeçote', 'Higienização', 'Revisão'])
    const config = (await dados()).config
    await req('PUT', '/api/config', { ...config, servicosManutencao: [], valorDiariaPadrao: 90 }, 200)
    expect((await dados()).config).toMatchObject({ valorDiariaPadrao: 90, servicosManutencao: r.json.servicosManutencao })
    expect((await req('PUT', '/api/config/servicos', { servicos: 'x' })).status).toBe(400)
  })

  it('o exemplo traz os serviços que usa quando a lista está vazia', async () => {
    await req('POST', '/api/exemplo', undefined, 200)
    const d = await dados()
    expect(d.config.servicosManutencao.length).toBeGreaterThan(0)
    const usados = new Set(d.ordens.flatMap((o) => o.servicos))
    for (const s of usados) expect(d.config.servicosManutencao).toContain(s)
    // E mostra um evento com período corrido e reclamações
    expect(d.eventos.some((e) => e.periodoCorrido)).toBe(true)
    expect(d.reclamacoes.length).toBeGreaterThan(0)
  })
})

describe('programação e período corrido', () => {
  it('programação muda pela alteração rápida; evento novo começa "não iniciada"', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-01']), 201)).json
    expect(e.programacao).toBe('NAO_INICIADA')
    const p = (await req<Evento>('PATCH', `/api/eventos/${e.id}`, { programacao: 'ENVIADA' }, 200)).json
    expect(p.programacao).toBe('ENVIADA')
    const invalido = (await req<Evento>('PATCH', `/api/eventos/${e.id}`, { programacao: 'XYZ' }, 200)).json
    expect(invalido.programacao).toBe('ENVIADA')
    const copia = (await req<Evento>('POST', `/api/eventos/${e.id}/duplicar`, undefined, 201)).json
    expect(copia.programacao).toBe('NAO_INICIADA')
  })

  it('com período corrido, a máquina fica presa também nos dias do meio', async () => {
    const cli = await criarCliente()
    const p1 = await criarMaquina('P-01')
    // Fins de semana de 05/09 e 12/09: sem período corrido, a P-01 fica livre no meio da semana
    const feira = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-05', '2099-09-12'], [p1.id]), 201)).json
    const meio = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-08'], [p1.id]), 201)).json
    // Passar a feira para período corrido: o dia 08/09 (acrescentado) já está em outro evento
    const r = await req<{ erro: string }>('PUT', `/api/eventos/${feira.id}`, { ...feira, periodoCorrido: true })
    expect(r.status).toBe(409)
    expect(r.json.erro).toBe(
      `A máquina P-01 já está no evento #${String(meio.codigo).padStart(4, '0')} Festa (Barraca) em 08/09. Escolha outra máquina.`,
    )
    // Sem o outro evento, passa; e aí a P-01 não pode ir para um evento no meio
    await req('DELETE', `/api/eventos/${meio.id}`, undefined, 204)
    await req('PUT', `/api/eventos/${feira.id}`, { ...feira, periodoCorrido: true }, 200)
    const outro = await req<{ erro: string }>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-09'], [p1.id]))
    expect(outro.status).toBe(409)
    expect(outro.json.erro).toMatch(/P-01 já está no evento .* em 09\/09/)
    // Depois do último dia, livre
    await req('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-13'], [p1.id]), 201)
  })
})

describe('arquivos anexados ao evento', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  it('envia, mostra na tela, baixa e apaga', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-01']), 201)).json
    const r = await enviarArquivo(e.id, png, 'Print da conversa ção.png', 'image/png')
    expect(r.statusCode, r.body).toBe(201)
    const anexo = r.json() as Anexo
    expect(anexo).toMatchObject({ eventoId: e.id, nome: 'Print da conversa ção.png', tipo: 'image/png', tamanho: png.length })
    expect((await dados()).anexos).toHaveLength(1)

    const ver = await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}` })
    expect(ver.statusCode).toBe(200)
    expect(ver.headers['content-type']).toBe('image/png')
    expect(String(ver.headers['content-disposition'])).toMatch(
      /^inline; filename="Print da conversa cao.png"; filename\*=UTF-8''Print%20da%20conversa%20/,
    )
    expect(ver.rawPayload.equals(png)).toBe(true)
    const baixar = await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}?baixar=1` })
    expect(String(baixar.headers['content-disposition'])).toMatch(/^attachment;/)
    expect(baixar.headers['content-type']).toBe('application/octet-stream')

    // HTML/SVG nunca são mostrados na tela (poderiam rodar código)
    const html = (await enviarArquivo(e.id, Buffer.from('<script>alert(1)</script>'), 'a.html', 'text/html')).json() as Anexo
    const verHtml = await app.inject({ method: 'GET', url: `/api/anexos/${html.id}` })
    expect(verHtml.headers['content-type']).toBe('application/octet-stream')
    expect(String(verHtml.headers['content-disposition'])).toMatch(/^attachment;/)

    await req('DELETE', `/api/anexos/${anexo.id}`, undefined, 204)
    expect((await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}` })).statusCode).toBe(404)
  })

  it('recusa sem o cabeçalho de segurança, vazio, grande demais ou de evento inexistente; nome com caminho é limpo', async () => {
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-01']), 201)).json
    expect((await enviarArquivo(e.id, png, 'a.png', 'image/png', {})).statusCode).toBe(403)
    expect((await enviarArquivo(e.id, Buffer.alloc(0), 'a.png', 'image/png')).statusCode).toBe(400)
    expect((await enviarArquivo('nao-existe', png, 'a.png', 'image/png')).statusCode).toBe(404)
    const grande = await enviarArquivo(e.id, Buffer.alloc(25 * 1024 * 1024 + 1), 'g.bin', 'application/octet-stream')
    expect(grande.statusCode).toBe(413)
    const limpo = (await enviarArquivo(e.id, png, '..\\..\\C:\\Windows\\x:y.png', 'image/png')).json() as Anexo
    expect(limpo.nome).toBe('x-y.png')
    expect((await dados()).anexos).toHaveLength(1)
  })

  it('excluir o evento ou restaurar um backup sem ele guarda os arquivos em anexos-removidos (nada é apagado)', async () => {
    const cli = await criarCliente()
    const a = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-01']), 201)).json
    const b = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-02']), 201)).json
    await enviarArquivo(a.id, png, 'a.png', 'image/png')
    const backup = (await req<Backup>('GET', '/api/backup')).json
    await enviarArquivo(b.id, png, 'b.png', 'image/png')
    expect(readdirSync(join(pasta, 'anexos')).sort()).toEqual([a.id, b.id].sort())

    await req('DELETE', `/api/eventos/${b.id}`, undefined, 204)
    expect(existsSync(join(pasta, 'anexos', b.id))).toBe(false)
    expect((await dados()).anexos.map((x) => x.eventoId)).toEqual([a.id])
    const guardados = () =>
      readdirSync(join(pasta, 'anexos-removidos')).flatMap((d) => readdirSync(join(pasta, 'anexos-removidos', d)))
    expect(guardados()).toEqual([b.id])

    // Backup sem o evento a: o registro sai e o arquivo vai para anexos-removidos
    await req('POST', '/api/backup/restaurar', { ...backup, eventos: backup.eventos.filter((e) => e.id !== a.id) }, 200)
    expect((await dados()).anexos).toEqual([])
    expect(existsSync(join(pasta, 'anexos', a.id))).toBe(false)
    expect(guardados().sort()).toEqual([a.id, b.id].sort())
  })

  it('restaurar a cópia do banco feita antes de apagar tudo traz os arquivos de volta', async () => {
    await app.close()
    const banco = join(pasta, 'bc-fichas.db')
    ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: banco, pastaEstatica: null, transporteEmail: transporteTeste }))
    const cli = await criarCliente()
    const e = (await req<Evento>('POST', '/api/eventos', eventoCom(cli.id, ['2099-09-01']), 201)).json
    const anexo = (await enviarArquivo(e.id, png, 'logo.png', 'image/png')).json() as Anexo
    // A cópia automática que o servidor faz antes de apagar tudo
    const { backups } = (await req<{ backups: Array<{ arquivo: string }> }>('POST', '/api/backups', undefined, 200)).json
    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    expect((await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}` })).statusCode).toBe(404)
    await app.close()

    // Volta a cópia (como o restaurar-copia.ps1): o registro volta e o arquivo vem de anexos-removidos
    for (const extra of ['-wal', '-shm']) rmSync(banco + extra, { force: true })
    copyFileSync(join(pasta, 'backups', backups[0].arquivo), banco)
    ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: banco, pastaEstatica: null, transporteEmail: transporteTeste }))
    const ver = await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}` })
    expect(ver.statusCode).toBe(200)
    expect(ver.rawPayload.equals(png)).toBe(true)
    expect(existsSync(join(pasta, 'anexos', e.id, anexo.id))).toBe(true)
  })
})

describe('envio de e-mail', () => {
  const config = {
    servidor: 'smtp.exemplo.com',
    porta: 587,
    seguranca: 'STARTTLS',
    usuario: 'recibos@exemplo.com',
    senha: 'segredo',
    remetenteNome: 'Balanças.com',
    remetenteEmail: 'recibos@exemplo.com',
  }

  it('a senha nunca volta para a tela; em branco mantém a gravada', async () => {
    expect((await req<{ configurado: boolean }>('GET', '/api/email/config')).json.configurado).toBe(false)
    const salvo = await req<Record<string, unknown>>('PUT', '/api/email/config', config, 200)
    expect(salvo.json).toMatchObject({ servidor: 'smtp.exemplo.com', senhaDefinida: true, configurado: true })
    expect('senha' in salvo.json).toBe(false)
    const semSenha = await req<Record<string, unknown>>(
      'PUT',
      '/api/email/config',
      { ...config, senha: '', remetenteNome: 'Recibos' },
      200,
    )
    expect(semSenha.json).toMatchObject({ remetenteNome: 'Recibos', senhaDefinida: true })
    // Trocar servidor, porta, usuário ou tirar a segurança exige a senha de novo (senão alguém da
    // rede apontaria o envio para um servidor dele e receberia a senha gravada)
    for (const troca of [
      { servidor: 'smtp.atacante.com' },
      { porta: 2525 },
      { usuario: 'outro@x.com' },
      { seguranca: 'NENHUMA' },
    ]) {
      const r = await req<{ erro: string }>('PUT', '/api/email/config', { ...config, ...troca, senha: '' })
      expect(r.status, JSON.stringify(troca)).toBe(400)
      expect(r.json.erro).toMatch(/digite a senha de novo/)
    }
    // A senha fica num arquivo próprio, fora do banco (e das cópias de backup)
    expect(readFileSync(join(pasta, 'email.json'), 'utf8')).toContain('segredo')
    const copia = (await req<{ backups: Array<{ arquivo: string }> }>('POST', '/api/backups', undefined, 200)).json.backups[0]
    expect(readFileSync(join(pasta, 'backups', copia.arquivo)).includes('segredo')).toBe(false)
    expect((await req<{ erro: string }>('PUT', '/api/email/config', { ...config, servidor: '' })).json.erro).toMatch(/servidor/)
    expect(JSON.stringify((await dados()).config)).not.toContain('segredo')
    expect(JSON.stringify((await req('GET', '/api/backup')).json)).not.toContain('segredo')
  })

  it('envia com o PDF anexado; sem configuração explica onde configurar', async () => {
    const sem = await req<{ erro: string }>('POST', '/api/email/enviar', {
      para: 'cliente@x.com',
      assunto: 'Recibo',
      texto: 'Oi',
    })
    expect(sem.status).toBe(409)
    expect(sem.json.erro).toMatch(/Configurações → E-mail/)

    await req('PUT', '/api/email/config', config, 200)
    const pdf = Buffer.from('%PDF-1.4 teste').toString('base64')
    const r = await req<{ ok: boolean; para: string[] }>(
      'POST',
      '/api/email/enviar',
      {
        para: 'cliente@x.com; financeiro@x.com',
        assunto: 'Recibo nº 0031',
        texto: 'Segue o recibo.',
        anexos: [{ nome: 'Recibo_0031.pdf', tipo: 'application/pdf', conteudo: pdf }],
      },
      200,
    )
    expect(r.json).toMatchObject({ ok: true, para: ['cliente@x.com', 'financeiro@x.com'] })
    expect(enviados).toHaveLength(1)
    expect(enviados[0]).toMatchObject({ subject: 'Recibo nº 0031', text: 'Segue o recibo.' })
    expect(JSON.stringify(enviados[0].from)).toContain('recibos@exemplo.com')
    const anexos = enviados[0].attachments as Array<{ filename: string; content: string }>
    expect(anexos[0].filename).toBe('Recibo_0031.pdf')
    expect(Buffer.from(anexos[0].content, 'base64').toString()).toBe('%PDF-1.4 teste')

    expect((await req('POST', '/api/email/enviar', { para: 'nao-e-email', assunto: 'x' })).status).toBe(400)
    // Só o PDF gerado pelo sistema: nada de executável, HTML ou vários anexos
    const exe = { nome: 'boleto.pdf.exe', tipo: 'application/x-msdownload', conteudo: Buffer.from('MZ').toString('base64') }
    expect((await req('POST', '/api/email/enviar', { para: 'a@b.com', assunto: 'x', anexos: [exe] })).status).toBe(400)
    const falso = { nome: 'boleto.pdf', tipo: 'application/pdf', conteudo: Buffer.from('<html>').toString('base64') }
    expect((await req('POST', '/api/email/enviar', { para: 'a@b.com', assunto: 'x', anexos: [falso] })).status).toBe(400)
    const doisPdf = Array(2).fill({ nome: 'a.pdf', tipo: 'application/pdf', conteudo: pdf })
    expect((await req('POST', '/api/email/enviar', { para: 'a@b.com', assunto: 'x', anexos: doisPdf })).status).toBe(400)
    expect((await req('POST', '/api/email/enviar', { para: 'a@b.com', assunto: '' })).status).toBe(400)

    falharEnvio = Object.assign(new Error('Invalid login'), { code: 'EAUTH' })
    const recusado = await req<{ erro: string }>('POST', '/api/email/teste', { para: 'a@b.com' })
    expect(recusado.status).toBe(502)
    expect(recusado.json.erro).toMatch(/senha de app/)
  })

  it('mensagens de erro em português, sem repassar a resposta de outro serviço', () => {
    expect(mensagemErroEmail({ code: 'ETIMEDOUT' })).toMatch(/Não foi possível conectar/)
    expect(mensagemErroEmail({ responseCode: 550 })).toMatch(/recusou o endereço/)
    expect(mensagemErroEmail({ code: 'EPROTOCOL', message: 'Invalid greeting. response=SSH-2.0-OpenSSH' })).not.toMatch(/SSH/)
    expect(mensagemErroEmail({ code: 'EXYZ', message: 'segredo interno' })).not.toMatch(/segredo/)
  })

  it('no máximo 30 e-mails por hora', async () => {
    await req('PUT', '/api/email/config', config, 200)
    for (let i = 0; i < 30; i++) await req('POST', '/api/email/enviar', { para: 'a@b.com', assunto: `n${i}` }, 200)
    const r = await req<{ erro: string }>('POST', '/api/email/enviar', { para: 'a@b.com', assunto: 'mais um' })
    expect(r.status).toBe(429)
    expect(r.json.erro).toMatch(/30 e-mails por hora/)
  })
})

describe('nome usado para abrir o servidor (DNS rebinding)', () => {
  it('IP, localhost e nome do computador valem; outro nome só se estiver em HOSTS_PERMITIDOS', () => {
    const extras = lerHostsPermitidos(' BCFichas , servidor.empresa.local. ,')
    expect([...extras]).toEqual(['bcfichas', 'servidor.empresa.local'])
    for (const host of [
      'localhost:3000',
      '127.0.0.1:3000',
      '192.168.0.10',
      '[::1]:3000',
      'app.localhost',
      'SERVIDOR:3000',
      'servidor.lan',
    ])
      expect(hostPermitido(host, extras, 'servidor'), host).toBe(true)
    expect(hostPermitido('bcfichas:3000', extras, 'servidor')).toBe(true)
    expect(hostPermitido('servidor.empresa.local.', extras, 'servidor')).toBe(true)
    for (const host of [undefined, '', 'ataque.com', 'ataque.com:3000', 'servidor-falso.com', 'localhost.ataque.com', 'a b'])
      expect(hostPermitido(host, extras, 'servidor'), String(host)).toBe(false)
  })

  it('bloqueia leitura e gravação por um nome de fora, com explicação', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/dados', headers: { host: 'ataque.com:3000' } })
    expect(api.statusCode).toBe(403)
    expect(api.json().erro).toContain('HOSTS_PERMITIDOS')
    const pagina = await app.inject({ method: 'GET', url: '/', headers: { host: 'ataque.com' } })
    expect(pagina.statusCode).toBe(403)
    expect(pagina.headers['content-type']).toContain('text/plain')
    const gravar = await app.inject({
      method: 'POST',
      url: '/api/clientes',
      headers: { ...H, host: 'ataque.com' },
      payload: { tipo: 'AVULSO', nome: 'X' },
    })
    expect(gravar.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/saude', headers: { host: '192.168.1.5:3000' } })).statusCode).toBe(200)
  })

  it('aceita o nome configurado', async () => {
    const outro = await criarApp({
      pastaDados: pasta,
      arquivoBanco: ':memory:',
      pastaEstatica: null,
      hostsPermitidos: 'bcfichas',
    })
    try {
      expect((await outro.app.inject({ method: 'GET', url: '/api/saude', headers: { host: 'bcfichas:3000' } })).statusCode).toBe(
        200,
      )
      expect((await outro.app.inject({ method: 'GET', url: '/api/saude', headers: { host: 'outro:3000' } })).statusCode).toBe(403)
    } finally {
      await outro.app.close()
    }
  })
})
