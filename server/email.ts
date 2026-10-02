// Envio de e-mails (recibo e resumo do evento para o cliente) por um servidor SMTP da empresa.
// A configuração fica só no servidor: a senha nunca vai para os navegadores.

import type { FastifyInstance } from 'fastify'
import nodemailer, { type Transporter } from 'nodemailer'
import { emailValido } from '#shared/dominio.ts'
import type { Contexto } from './contexto.ts'
import { gravarMeta, lerMeta } from './db.ts'
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

/** Limites de segurança do envio. */
export const LIMITES_EMAIL = { destinatarios: 10, anexos: 5, bytesAnexos: 15 * 1024 * 1024, texto: 20_000 }

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function lerConfigEmail(ctx: Pick<Contexto, 'db'>): ConfigEmail {
  try {
    const salvo = JSON.parse(lerMeta(ctx.db, CHAVE) ?? '{}')
    return { ...VAZIA, ...(salvo && typeof salvo === 'object' ? salvo : {}) }
  } catch {
    return { ...VAZIA }
  }
}

export function configPublica(c: ConfigEmail): ConfigEmailPublica {
  const { senha, ...resto } = c
  return { ...resto, senhaDefinida: !!senha, configurado: !!(c.servidor && c.usuario && senha && c.remetenteEmail) }
}

/** Valida a configuração digitada; senha em branco mantém a que já estava gravada. */
export function normalizarConfigEmail(entrada: unknown, atual: ConfigEmail): ConfigEmail {
  const r = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>
  const seguranca: SegurancaEmail = r.seguranca === 'SSL' || r.seguranca === 'NENHUMA' ? r.seguranca : 'STARTTLS'
  const porta = Number(r.porta)
  const c: ConfigEmail = {
    servidor: texto(r.servidor, 200).toLowerCase(),
    porta: Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : seguranca === 'SSL' ? 465 : 587,
    seguranca,
    usuario: texto(r.usuario, 200),
    senha: typeof r.senha === 'string' && r.senha ? r.senha.slice(0, 500) : atual.senha,
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
  if (anexosBrutos.length > LIMITES_EMAIL.anexos) throw new ErroApi(400, `No máximo ${LIMITES_EMAIL.anexos} anexos.`)
  let total = 0
  const anexos = anexosBrutos.map((a) => {
    const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
    const conteudo = typeof x.conteudo === 'string' ? x.conteudo : ''
    if (!conteudo || !/^[A-Za-z0-9+/=\s]+$/.test(conteudo)) throw new ErroApi(400, 'Anexo inválido.')
    total += Math.floor((conteudo.replace(/\s/g, '').length * 3) / 4)
    const tipo = texto(x.tipo, 100)
    return {
      nome: texto(x.nome, 150).replace(/[\\/:*?"<>|\r\n]+/g, '-') || 'anexo',
      tipo: /^[\w.+-]+\/[\w.+-]+$/.test(tipo) ? tipo : 'application/octet-stream',
      conteudo,
    }
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
  return `Não foi possível enviar o e-mail: ${erro.message ?? 'erro desconhecido'}`
}

export function criarModuloEmail(ctx: Contexto, criarTransporte: CriarTransporte = criarTransporteSmtp) {
  async function enviar(msg: MensagemEmail) {
    const c = lerConfigEmail(ctx)
    if (!configPublica(c).configurado) {
      throw new ErroApi(409, 'O envio de e-mail ainda não foi configurado. Configure em Configurações → E-mail.')
    }
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
      gravarMeta(ctx.db, CHAVE, JSON.stringify(c))
      return configPublica(c)
    })

    // Esquecer a configuração (inclusive a senha)
    app.delete('/api/email/config', async (_req, reply) => {
      ctx.db.prepare('DELETE FROM meta WHERE chave = ?').run(CHAVE)
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
