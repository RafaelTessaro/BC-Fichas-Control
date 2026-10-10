// Arquivo apagado ou trocado não some: a cópia assinada anterior vai para contratos/<id>/anteriores/
// e o anexo apagado vai para anexos-removidos/<data>/<evento>/<arquivo>.

import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Anexo, Cliente, Contrato, Evento } from '#shared/tipos.ts'
import { criarApp } from './app.ts'

const H = { 'x-bc-fichas': '1' }
let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']
const banco = () => join(pasta, 'bc-fichas.db')
const abrir = async () => {
  ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: banco(), pastaEstatica: null, acessoLivreParaTestes: true }))
}

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-guarda-'))
  await abrir()
})
afterEach(async () => {
  await app.close()
  rmSync(pasta, { recursive: true, force: true })
})

async function req<T = unknown>(method: string, url: string, payload?: unknown, esperado?: number, headers: object = {}) {
  const r = await app.inject({ method: method as 'GET', url, headers: { ...H, ...headers }, payload: payload as object })
  if (esperado !== undefined) expect(r.statusCode, r.body).toBe(esperado)
  return { status: r.statusCode, json: (r.body ? r.json() : undefined) as T, body: r.body }
}

const arquivo = (nome: string, tipo: string) => ({
  'content-type': 'application/octet-stream',
  'x-nome': encodeURIComponent(nome),
  'x-tipo': tipo,
})

async function novoEvento() {
  const cli = (
    await req<Cliente>('POST', '/api/clientes', { tipo: 'PF', nome: 'Juliana Martins', documento: '529.982.247-25' }, 201)
  ).json
  return (
    await req<Evento>(
      'POST',
      '/api/eventos',
      {
        clienteId: cli.id,
        nome: 'Aniversário',
        dias: [{ data: '2099-05-10', maquinas: 2 }],
        valorDiaria: 50,
        status: 'EM_ABERTO',
      },
      201,
    )
  ).json
}

describe('cópia assinada do contrato', () => {
  it('trocar guarda a anterior em anteriores/; apagar também; excluir o contrato apaga a pasta', async () => {
    const e = await novoEvento()
    const c = (
      await req<Contrato>(
        'POST',
        '/api/contratos',
        {
          eventoId: e.id,
          local: 'Salão',
          retirada: { data: '2099-05-09', hora: '16:00' },
          devolucao: { data: '2099-05-11', hora: '' },
          assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
          condicoes: '',
        },
        201,
      )
    ).json
    const enviar = (conteudo: string, nome = 'Contrato assinado.pdf') =>
      req('POST', `/api/contratos/${c.id}/arquivo`, Buffer.from(conteudo), 200, arquivo(nome, 'application/pdf'))
    const anteriores = join(pasta, 'contratos', c.id, 'anteriores')
    const guardados = () => (existsSync(anteriores) ? readdirSync(anteriores).sort() : [])

    await enviar('%PDF-1 primeira')
    expect(guardados()).toEqual([])
    await enviar('%PDF-1 segunda')
    await enviar('%PDF-1 terceira', 'Foto.pdf')
    // Duas trocas: duas cópias guardadas, com data e hora e o nome original (-2 se repetir no mesmo segundo)
    expect(guardados()).toHaveLength(2)
    expect(guardados().every((n) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-Contrato assinado(-2)?\.pdf$/.test(n))).toBe(true)
    expect(
      guardados()
        .map((n) => readFileSync(join(anteriores, n), 'utf8'))
        .sort(),
    ).toEqual(['%PDF-1 primeira', '%PDF-1 segunda'])
    expect(readFileSync(join(pasta, 'contratos', c.id, 'assinado'), 'utf8')).toBe('%PDF-1 terceira')

    // Apagar a cópia: o arquivo sai de "assinado" e vai para anteriores/
    await req('DELETE', `/api/contratos/${c.id}/arquivo`, undefined, 200)
    expect(existsSync(join(pasta, 'contratos', c.id, 'assinado'))).toBe(false)
    expect(guardados()).toHaveLength(3)
    expect(guardados().some((n) => n.endsWith('-Foto.pdf'))).toBe(true)

    // Excluir o contrato (cancelado) é o descarte: a pasta inteira sai
    await req('PATCH', `/api/contratos/${c.id}`, { acao: 'cancelar' }, 200)
    await req('DELETE', `/api/contratos/${c.id}`, undefined, 204)
    expect(existsSync(join(pasta, 'contratos', c.id))).toBe(false)
  })
})

describe('anexos', () => {
  it('apagar move o arquivo para anexos-removidos; restaurar a cópia .db com o registro traz o arquivo de volta', async () => {
    const e = await novoEvento()
    const anexo = (
      await req<Anexo>(
        'POST',
        `/api/eventos/${e.id}/anexos`,
        Buffer.from('conteúdo do print'),
        201,
        arquivo('print.png', 'image/png'),
      )
    ).json
    const original = join(pasta, 'anexos', e.id, anexo.id)
    expect(existsSync(original)).toBe(true)

    // Cópia .db feita com o anexo registrado
    const copia = (await req<{ backups: Array<{ arquivo: string }> }>('POST', '/api/backups', undefined, 200)).json.backups[0]

    await req('DELETE', `/api/anexos/${anexo.id}`, undefined, 204)
    expect(existsSync(original)).toBe(false)
    const removidos = join(pasta, 'anexos-removidos')
    const [data] = readdirSync(removidos)
    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/)
    expect(readFileSync(join(removidos, data, e.id, anexo.id), 'utf8')).toBe('conteúdo do print')
    expect((await req('GET', `/api/anexos/${anexo.id}`)).status).toBe(404)

    // Volta a cópia do banco (como o restaurar-copia faz, com o servidor parado)
    await app.close()
    for (const sufixo of ['', '-wal', '-shm']) rmSync(banco() + sufixo, { force: true })
    copyFileSync(join(pasta, 'backups', copia.arquivo), banco())
    await abrir()
    const voltou = await app.inject({ method: 'GET', url: `/api/anexos/${anexo.id}` })
    expect(voltou.statusCode).toBe(200)
    expect(voltou.body).toBe('conteúdo do print')
    expect(existsSync(original)).toBe(true)
  })
})
