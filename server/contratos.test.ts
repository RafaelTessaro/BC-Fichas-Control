import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Backup, Cliente, Contrato, DadosCompletos, Evento } from '#shared/tipos.ts'
import { criarApp } from './app.ts'

const H = { 'x-bc-fichas': '1' }
let pasta: string
let app: Awaited<ReturnType<typeof criarApp>>['app']

beforeEach(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-ctr-'))
  ;({ app } = await criarApp({ pastaDados: pasta, arquivoBanco: ':memory:', pastaEstatica: null }))
})
afterEach(async () => {
  await app.close()
  rmSync(pasta, { recursive: true, force: true })
})

async function req<T = unknown>(method: string, url: string, payload?: unknown, esperado?: number) {
  const r = await app.inject({ method: method as 'GET', url, headers: H, payload: payload as object })
  if (esperado !== undefined) expect(r.statusCode, r.body).toBe(esperado)
  return { status: r.statusCode, json: (r.body ? r.json() : undefined) as T, body: r.body, headers: r.headers }
}
const dados = async () => (await req<DadosCompletos>('GET', '/api/dados')).json
const novoEvento = async () => {
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
        dias: [{ data: '2099-05-10', maquinas: 2, reservas: 1 }],
        valorDiaria: 50,
        status: 'EM_ABERTO',
      },
      201,
    )
  ).json
}
const pedido = (eventoId: string) => ({
  eventoId,
  local: 'Salão',
  retirada: { data: '2099-05-09', hora: '16:00' },
  devolucao: { data: '2099-05-11', hora: '' },
  assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
  condicoes: 'Entregar com 2 rolos extras.',
})

describe('contratos de locação', () => {
  it('gera com os dados congelados; gerar de novo substitui o que esperava a assinatura', async () => {
    const e = await novoEvento()
    const c1 = (await req<Contrato>('POST', '/api/contratos', pedido(e.id), 201)).json
    expect(c1).toMatchObject({ numero: 1, status: 'AGUARDANDO', eventoId: e.id, clienteId: e.clienteId, arquivo: null })
    expect(c1.dados.cliente.documento).toBe('CPF 529.982.247-25')
    expect(c1.dados.valores).toMatchObject({ diarias: 2, total: 100 })
    // Mudar o evento depois não muda o contrato gerado
    await req('PUT', `/api/eventos/${e.id}`, { ...e, valorDiaria: 80 }, 200)
    expect((await dados()).contratos[0].dados.valores.diaria).toBe(50)
    const c2 = (await req<Contrato>('POST', '/api/contratos', pedido(e.id), 201)).json
    expect(c2.numero).toBe(2)
    expect(c2.dados.valores.diaria).toBe(80)
    const lista = (await dados()).contratos
    expect(lista.map((c) => [c.numero, c.status])).toEqual([
      [2, 'AGUARDANDO'],
      [1, 'CANCELADO'],
    ])
    expect(lista[1].motivoCancelamento).toBe('Substituído pelo contrato nº 0002.')
  })

  it('recusa evento cancelado ou inexistente e CPF inválido', async () => {
    const e = await novoEvento()
    expect((await req('POST', '/api/contratos', pedido('nao-existe'))).status).toBe(404)
    expect(
      (await req('POST', '/api/contratos', { ...pedido(e.id), assinante: { nome: 'X', cpf: '111.111.111-11' } })).status,
    ).toBe(400)
    await req('PATCH', `/api/eventos/${e.id}`, { status: 'CANCELADO' }, 200)
    const r = await req<{ erro: string }>('POST', '/api/contratos', pedido(e.id))
    expect(r.status).toBe(400)
    expect(r.json.erro).toMatch(/cancelado/)
  })

  it('assinar, cancelar e reabrir, com controle de versão', async () => {
    const e = await novoEvento()
    const c = (await req<Contrato>('POST', '/api/contratos', pedido(e.id), 201)).json
    const assinado = (
      await req<Contrato>('PATCH', `/api/contratos/${c.id}`, { acao: 'assinar', data: '2099-05-09', versao: 1 }, 200)
    ).json
    expect(assinado).toMatchObject({ status: 'ASSINADO', assinadoEm: '2099-05-09', versao: 2 })
    expect((await req('PATCH', `/api/contratos/${c.id}`, { acao: 'cancelar', versao: 1 })).status).toBe(409)
    const cancelado = (
      await req<Contrato>('PATCH', `/api/contratos/${c.id}`, { acao: 'cancelar', motivo: 'Cliente desistiu' }, 200)
    ).json
    expect(cancelado).toMatchObject({ status: 'CANCELADO', motivoCancelamento: 'Cliente desistiu' })
    const reaberto = (await req<Contrato>('PATCH', `/api/contratos/${c.id}`, { acao: 'reabrir' }, 200)).json
    expect(reaberto).toMatchObject({ status: 'AGUARDANDO', assinadoEm: '', motivoCancelamento: '' })
    expect((await req('PATCH', `/api/contratos/${c.id}`, { acao: 'apagar' })).status).toBe(400)
  })

  it('guarda a cópia assinada (PDF ou foto), marca como assinado, mostra e remove', async () => {
    const e = await novoEvento()
    const c = (await req<Contrato>('POST', '/api/contratos', pedido(e.id), 201)).json
    const pdf = Buffer.from('%PDF-1.4\n% assinado\n')
    const enviar = (tipo: string, corpo = pdf, cab: object = H) =>
      app.inject({
        method: 'POST',
        url: `/api/contratos/${c.id}/arquivo`,
        headers: {
          ...cab,
          'content-type': 'application/octet-stream',
          'x-nome': encodeURIComponent('Contrato assinado.pdf'),
          'x-tipo': tipo,
        },
        payload: corpo,
      })
    expect((await enviar('text/html')).statusCode).toBe(400)
    expect((await enviar('application/pdf', pdf, {})).statusCode).toBe(403)
    const r = await enviar('application/pdf')
    expect(r.statusCode, r.body).toBe(200)
    const salvo = r.json() as Contrato
    expect(salvo.status).toBe('ASSINADO')
    expect(salvo.arquivo).toMatchObject({ nome: 'Contrato assinado.pdf', tipo: 'application/pdf', tamanho: pdf.length })
    const arquivo = join(pasta, 'contratos', c.id, 'assinado')
    expect(readFileSync(arquivo)).toEqual(pdf)
    const ver = await app.inject({ method: 'GET', url: `/api/contratos/${c.id}/arquivo` })
    expect(ver.statusCode).toBe(200)
    expect(ver.headers['content-type']).toBe('application/pdf')
    expect(ver.headers['content-disposition']).toMatch(/^inline/)
    const baixar = await app.inject({ method: 'GET', url: `/api/contratos/${c.id}/arquivo?baixar=1` })
    expect(baixar.headers['content-disposition']).toMatch(/^attachment/)
    const sem = (await req<Contrato>('DELETE', `/api/contratos/${c.id}/arquivo`, undefined, 200)).json
    expect(sem.arquivo).toBeNull()
    expect(sem.status).toBe('ASSINADO')
    expect(existsSync(arquivo)).toBe(false)
    expect((await req('GET', `/api/contratos/${c.id}/arquivo`)).status).toBe(404)
  })

  it('entra no backup (versão 6), volta na restauração e na mesclagem sem repetir número', async () => {
    const e = await novoEvento()
    const c = (await req<Contrato>('POST', '/api/contratos', pedido(e.id), 201)).json
    const backup = (await req<Backup>('GET', '/api/backup')).json
    expect(backup.versao).toBe(6)
    expect(backup.contratos).toHaveLength(1)
    expect(backup.proximoContrato).toBe(2)
    await req('POST', '/api/limpar', { confirmacao: 'APAGAR' }, 200)
    expect((await dados()).contratos).toEqual([])
    await req('POST', '/api/backup/restaurar', backup, 200)
    const voltou = (await dados()).contratos
    expect(voltou.map((x) => [x.id, x.numero])).toEqual([[c.id, 1]])
    expect(voltou[0].dados).toEqual(c.dados)
    // Mesclar um backup com outro contrato de mesmo número: ganha o próximo número
    const outro = { ...backup, contratos: [{ ...backup.contratos[0], id: 'outro-contrato' }] }
    const m = (await req<{ contratos: number }>('POST', '/api/backup/mesclar', outro, 200)).json
    expect(m.contratos).toBe(1)
    expect((await dados()).contratos.map((x) => x.numero).sort()).toEqual([1, 2])
    // Backup antigo (sem contratos) continua aceito
    const { contratos: _c, proximoContrato: _p, ...antigo } = backup
    await req('POST', '/api/backup/restaurar', { ...antigo, versao: 5 }, 200)
    expect((await dados()).contratos).toEqual([])
  })

  it('o exemplo traz dois contratos (um assinado, um esperando a assinatura)', async () => {
    await req('POST', '/api/exemplo', undefined, 200)
    const lista = (await dados()).contratos
    expect(lista.map((c) => c.status).sort()).toEqual(['AGUARDANDO', 'ASSINADO'])
    expect(lista.every((c) => c.dados.evento.nome && c.dados.cliente.nome)).toBe(true)
  })
})
