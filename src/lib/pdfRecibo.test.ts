import { describe, expect, it, vi } from 'vitest'
import { CLIENTE_VAZIO, CONFIG_PADRAO } from '#shared/dominio.ts'
import type { Cliente, Evento } from '#shared/tipos.ts'
import { gerarReciboPDF } from './pdfRecibo'

// No teste não há navegador para carregar a imagem: o timbrado vai direto, como data URL
vi.mock('./pdf', async (original) => ({
  ...(await original<typeof import('./pdf')>()),
  carregarTimbrado: async () => (await import('../assets/timbrado.jpg?inline')).default,
}))

const cliente: Cliente = {
  ...CLIENTE_VAZIO,
  id: 'c1',
  versao: 1,
  criadoEm: '',
  atualizadoEm: '',
  tipo: 'PJ',
  nome: 'Associação Jardim Primavera',
  razaoSocial: 'ASSOCIAÇÃO DOS MORADORES E AMIGOS DO BAIRRO JARDIM PRIMAVERA DE RIO CLARO',
  documento: '12.403.843/0001-18',
}

const evento: Evento = {
  id: 'e1',
  versao: 1,
  codigo: 31,
  clienteId: 'c1',
  nome: 'Festa Junina da Escola Estadual Professor João Batista de Oliveira',
  cidade: 'Santa Gertrudes',
  cabecalho: '',
  dias: ['2026-10-11', '2026-10-12', '2026-10-18', '2026-10-19'].map((data, i) => ({ id: `d${i}`, data, maquinas: 6 })),
  maquinasIds: [],
  valorDiaria: 143.37,
  valorBobina: 6,
  bobinasConsignadas: 100,
  bobinasDevolvidas: 13,
  desconto: 10.5,
  formaPagamento: 'PIX',
  dataPagamento: '2026-10-02',
  status: 'FINALIZADO',
  rodape: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
}

describe('recibo em PDF', () => {
  it('texto longo com bobinas e desconto: a assinatura continua na mesma página', async () => {
    const { doc, nome } = await gerarReciboPDF(evento, cliente, CONFIG_PADRAO)
    expect(doc.getNumberOfPages()).toBe(1)
    expect(nome).toBe('Recibo_0031_Associação_Jardim_Primavera.pdf')
  })

  it('recibo curto: uma página', async () => {
    const curto = { ...evento, nome: 'Baile', bobinasConsignadas: 0, bobinasDevolvidas: null, desconto: 0 }
    const { doc } = await gerarReciboPDF(curto, cliente, CONFIG_PADRAO)
    expect(doc.getNumberOfPages()).toBe(1)
  })
})
