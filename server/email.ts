// Envio de e-mails (recibo e resumo do evento para o cliente) por um servidor SMTP da empresa.
// A configuração fica só no servidor, no arquivo <pasta de dados>/email.json (fora do banco, para
// a senha não ir nas cópias de backup): a senha nunca vai para os navegadores.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import nodemailer, { type Transporter } from 'nodemailer'
import { emailValido } from '#shared/dominio.ts'
import type { Contexto } from './contexto.ts'
import { lerMeta } from './db.ts'
import { ErroApi } from './erros.ts'

export type SegurancaEmail = 'SSL' | 'STARTTLS' | 'NENHUMA'

export interface ConfigEmail {
  /** Servidor SMTP, ex.: smtp.gmail.com */
  servidor: string
  porta: number
  seguranca: SegurancaEmail
  usuario: string
  senha: string
  /** Nome que aparece como remetente, ex.: "Balanças.com". */
  remetenteNome: string
  /** E-mail do remetente (normalmente o mesmo do usuário). */
  remetenteEmail: string
}

/** O que a tela recebe: tudo menos a senha. */
export type ConfigEmailPublica = Omit<ConfigEmail, 'senha'> & { senhaDefinida: boolean; configurado: boolean }

export interface AnexoEmail {
  nome: string
  tipo: string
  /** Conteúdo em base64. */
  conteudo: string
}

export interface MensagemEmail {
  para: string[]
  assunto: string
  texto: string
  anexos: AnexoEmail[]
}

/** Cria o transporte SMTP (substituído nos testes). */
export type CriarTransporte = (config: ConfigEmail) => Transporter

const CHAVE = 'email'
const VAZIA: ConfigEmail = {
  servidor: '',
  porta: 587,
  seguranca: 'STARTTLS',
  usuario: '',
  senha: '',
  remetenteNome: '',
  remetenteEmail: '',
}

/**
 * Limites de segurança do envio: a tela só manda um PDF (recibo ou resumo); o limite por hora
 * impede que o SMTP da empresa seja usado para disparar e-mails em massa.
 */
export const LIMITES_EMAIL = {
  destinatarios: 10,
  anexos: 1,
  bytesAnexos: 15 * 1024 * 1024,
  texto: 20_000,
  enviosPorHora: 30,
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const arquivoConfig = (ctx: Pick<Contexto, 'pastaDados'>) => join(ctx.pastaDados, 'email.json')

export function lerConfigEmail(ctx: Pick<Contexto, 'pastaDados'>): ConfigEmail {
  try {
    const salvo = JSON.parse(readFileSync(arquivoConfig(ctx), 'utf8'))
    return { ...VAZIA, ...(salvo && typeof salvo === 'object' ? salvo : {}) }
  } catch {
    return { ...VAZIA }
  }
}

/** Grava o arquivo inteiro de uma vez (temporário + troca), só com leitura do dono. */
export function gravarConfigEmail(ctx: Pick<Contexto, 'pastaDados'>, c: ConfigEmail) {
  mkdirSync(ctx.pastaDados, { recursive: true })
  const destino = arquivoConfig(ctx)
  const temporario = `${destino}.tmp`
  writeFileSync(temporario, JSON.stringify(c), { mode: 0o600 })
  renameSync(temporario, destino)
  try {
    chmodSync(destino, 0o600)
  } catch {
    /* no Windows a permissão vem da pasta */
  }
}

export function apagarConfigEmail(ctx: Pick<Contexto, 'pastaDados'>) {
  rmSync(arquivoConfig(ctx), { force: true })
}

/** Versões de teste da 2.3 guardavam a configuração no banco: passa para o arquivo e some do banco. */
function migrarDoBanco(ctx: Pick<Contexto, 'pastaDados' | 'db'>) {
  const antiga = lerMeta(ctx.db, CHAVE)
  if (antiga === undefined) return
  try {
    if (!existsSync(arquivoConfig(ctx))) gravarConfigEmail(ctx, { ...VAZIA, ...JSON.parse(antiga) })
  } catch {
    /* configuração ilegível: só descarta */
  }
  ctx.db.prepare('DELETE FROM meta WHERE chave = ?').run(CHAVE)
}

export function configPublica(c: ConfigEmail): ConfigEmailPublica {
  const { senha, ...resto } = c
  return { ...resto, senhaDefinida: !!senha, configurado: !!(c.servidor && c.usuario && senha && c.remetenteEmail) }
}

/**
 * Valida a configuração digitada. Senha em branco mantém a gravada — mas só para o MESMO servidor,
 * porta e usuário, sem tirar a segurança: senão alguém da rede poderia apontar o envio para um
 * servidor dele e receber a senha gravada.
 */
export function normalizarConfigEmail(entrada: unknown, atual: ConfigEmail): ConfigEmail {
  const r = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>
  const seguranca: SegurancaEmail = r.seguranca === 'SSL' || r.seguranca === 'NENHUMA' ? r.seguranca : 'STARTTLS'
  const porta = Number(r.porta)
  const servidor = texto(r.servidor, 200).toLowerCase()
  const portaFinal = Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : seguranca === 'SSL' ? 465 : 587
  const usuario = texto(r.usuario, 200)
  const senhaDigitada = typeof r.senha === 'string' && r.senha ? r.senha.slice(0, 500) : ''
  const mesmoDestino =
    servidor === atual.servidor &&
    portaFinal === atual.porta &&
    usuario === atual.usuario &&
    (seguranca !== 'NENHUMA' || atual.seguranca === 'NENHUMA')
  if (!senhaDigitada && atual.senha && !mesmoDestino && servidor && usuario) {
    throw new ErroApi(400, 'Ao trocar o servidor, a porta, o usuário ou a segurança, digite a senha de novo.')
  }
  const c: ConfigEmail = {
    servidor,
    porta: portaFinal,
    seguranca,
    usuario,
    senha: senhaDigitada || atual.senha,
    remetenteNome: texto(r.remetenteNome, 120).replace(/["<>]/g, ''),
    remetenteEmail: texto(r.remetenteEmail, 200),
  }
  if (!c.servidor) throw new ErroApi(400, 'Informe o servidor de e-mail (SMTP), ex.: smtp.gmail.com.')
  if (!/^[a-z0-9.-]+$/.test(c.servidor)) throw new ErroApi(400, 'Servidor de e-mail inválido.')
  if (!c.usuario) throw new ErroApi(400, 'Informe o usuário (normalmente o próprio e-mail).')
  if (!c.remetenteEmail) c.remetenteEmail = emailValido(c.usuario) ? c.usuario : ''
  if (!emailValido(c.remetenteEmail)) throw new ErroApi(400, 'Informe um e-mail de remetente válido.')
  return c
}

/** Lista de destinatários a partir de "a@x.com, b@y.com" (ou de uma lista). */
export function destinatarios(v: unknown): string[] {
  const bruto = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : ''
  const lista = [
    ...new Set(
      bruto
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ]
  if (!lista.length) throw new ErroApi(400, 'Informe o e-mail de quem vai receber.')
  if (lista.length > LIMITES_EMAIL.destinatarios) {
    throw new ErroApi(400, `Envie para no máximo ${LIMITES_EMAIL.destinatarios} endereços de uma vez.`)
  }
  const invalido = lista.find((x) => !emailValido(x))
  if (invalido) throw new ErroApi(400, `E-mail inválido: ${invalido}`)
  return lista
}

export function normalizarMensagem(entrada: unknown): MensagemEmail {
  const r = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>
  const assunto = texto(r.assunto, 200)
  if (!assunto) throw new ErroApi(400, 'Informe o assunto do e-mail.')
  const anexosBrutos = Array.isArray(r.anexos) ? r.anexos : []
  if (anexosBrutos.length > LIMITES_EMAIL.anexos) throw new ErroApi(400, 'Envie no máximo um PDF por e-mail.')
  let total = 0
  // Só o PDF gerado pelo sistema (recibo ou resumo do evento)
  const anexos = anexosBrutos.map((a) => {
    const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
    const conteudo = typeof x.conteudo === 'string' ? x.conteudo.replace(/\s/g, '') : ''
    if (!conteudo || !/^[A-Za-z0-9+/=]+$/.test(conteudo)) throw new ErroApi(400, 'Anexo inválido.')
    total += Math.floor((conteudo.length * 3) / 4)
    const nome = texto(x.nome, 150).replace(/[\\/:*?"<>|\r\n]+/g, '-') || 'documento.pdf'
    const ehPdf = Buffer.from(conteudo.slice(0, 12), 'base64').toString('latin1').startsWith('%PDF-')
    if (!ehPdf || !/\.pdf$/i.test(nome)) throw new ErroApi(400, 'O anexo precisa ser o PDF gerado pelo sistema.')
    return { nome, tipo: 'application/pdf', conteudo }
  })
  if (total > LIMITES_EMAIL.bytesAnexos) throw new ErroApi(413, 'Os anexos passam de 15 MB.')
  return { para: destinatarios(r.para), assunto, texto: texto(r.texto, LIMITES_EMAIL.texto), anexos }
}

export const criarTransporteSmtp: CriarTransporte = (c) =>
  nodemailer.createTransport({
    host: c.servidor,
    port: c.porta,
    secure: c.seguranca === 'SSL',
    requireTLS: c.seguranca === 'STARTTLS',
    ignoreTLS: c.seguranca === 'NENHUMA',
    auth: { user: c.usuario, pass: c.senha },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })

/** Erro do SMTP em português, com a dica mais comum para cada caso. */
export function mensagemErroEmail(e: unknown): string {
  const erro = e as { code?: string; responseCode?: number; message?: string }
  if (erro.code === 'EAUTH' || erro.responseCode === 535 || erro.responseCode === 534) {
    return 'O servidor de e-mail recusou o usuário ou a senha. No Gmail e no Outlook, use uma "senha de app" (não a senha normal da conta).'
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND'].includes(erro.code ?? '')) {
    return 'Não foi possível conectar ao servidor de e-mail. Confira o servidor, a porta, o tipo de segurança e a internet do servidor.'
  }
  if (erro.code === 'EENVELOPE' || erro.responseCode === 550 || erro.responseCode === 553) {
    return 'O servidor de e-mail recusou o endereço de destino ou de remetente.'
  }
  if (erro.code === 'EPROTOCOL' || erro.code === 'ETLS') {
    return 'O servidor informado não respondeu como um servidor de e-mail (SMTP). Confira o servidor, a porta e o tipo de segurança.'
  }
  // O detalhe (que pode trazer a resposta de outro serviço) fica só no registro do servidor
  return `Não foi possível enviar o e-mail (${erro.code ?? 'erro desconhecido'}). Veja os detalhes no registro do servidor.`
}

export function criarModuloEmail(ctx: Contexto, criarTransporte: CriarTransporte = criarTransporteSmtp) {
  migrarDoBanco(ctx)
  /** Horários (ms) dos envios da última hora. */
  let envios: number[] = []

  async function enviar(msg: MensagemEmail) {
    const c = lerConfigEmail(ctx)
    if (!configPublica(c).configurado) {
      throw new ErroApi(409, 'O envio de e-mail ainda não foi configurado. Configure em Configurações → E-mail.')
    }
    const agora = Date.now()
    envios = envios.filter((t) => agora - t < 3_600_000)
    if (envios.length >= LIMITES_EMAIL.enviosPorHora) {
      throw new ErroApi(429, `Limite de ${LIMITES_EMAIL.enviosPorHora} e-mails por hora atingido. Tente de novo mais tarde.`)
    }
    envios.push(agora)
    ctx.log.info({ para: msg.para, assunto: msg.assunto }, 'envio de e-mail')
    try {
      const info = await criarTransporte(c).sendMail({
        from: c.remetenteNome ? { name: c.remetenteNome, address: c.remetenteEmail } : c.remetenteEmail,
        to: msg.para,
        subject: msg.assunto,
        text: msg.texto,
        attachments: msg.anexos.map((a) => ({
          filename: a.nome,
          contentType: a.tipo,
          content: Buffer.from(a.conteudo, 'base64'),
        })),
      })
      return { ok: true as const, para: msg.para, id: String(info.messageId ?? '') }
    } catch (e) {
      ctx.log.warn({ err: e }, 'falha ao enviar e-mail')
      throw new ErroApi(502, mensagemErroEmail(e))
    }
  }

  async function rotas(app: FastifyInstance) {
    app.get('/api/email/config', async () => configPublica(lerConfigEmail(ctx)))

    app.put('/api/email/config', async (req) => {
      const c = normalizarConfigEmail(req.body, lerConfigEmail(ctx))
      gravarConfigEmail(ctx, c)
      return configPublica(c)
    })

    // Esquecer a configuração (inclusive a senha)
    app.delete('/api/email/config', async (_req, reply) => {
      apagarConfigEmail(ctx)
      return reply.code(204).send()
    })

    app.post('/api/email/teste', async (req) => {
      const para = destinatarios((req.body as { para?: unknown } | null)?.para)
      return enviar({
        para,
        assunto: 'Teste de e-mail — BC Fichas Control',
        texto: 'Este é um e-mail de teste do BC Fichas Control. Se chegou, o envio de recibos por e-mail está funcionando.',
        anexos: [],
      })
    })

    app.post('/api/email/enviar', async (req) => enviar(normalizarMensagem(req.body)))
  }

  return { rotas, enviar }
}
