import { describe, expect, it, vi } from 'vitest'
import { montarDadosContrato } from '#shared/contrato.ts'
import { CLIENTE_VAZIO, CONFIG_PADRAO, MAQUINA_VAZIA } from '#shared/dominio.ts'
import type { Cliente, Contrato, Evento, Maquina } from '#shared/tipos.ts'
import { gerarContratoPDF } from './pdfContrato'

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
  razaoSocial: 'ASSOCIAÇÃO DOS MORADORES DO BAIRRO JARDIM PRIMAVERA',
  documento: '12.403.843/0001-18',
  responsavel: 'Maria Aparecida Souza',
  telefone: '(19) 99876-5432',
  logradouro: 'Rua 7',
  numero: '1200',
  bairro: 'Jardim Primavera',
  cidade: 'Rio Claro',
  uf: 'SP',
}

const maq = (identificacao: string): Maquina => ({
  ...MAQUINA_VAZIA,
  id: identificacao,
  versao: 1,
  tipo: identificacao[0] as 'P' | 'G',
  identificacao,
  criadoEm: '',
  atualizadoEm: '',
})

const evento: Evento = {
  id: 'e1',
  versao: 1,
  codigo: 31,
  clienteId: 'c1',
  nome: 'Festa Junina',
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: [
    { id: 'a', data: '2026-10-10', maquinas: 3, reservas: 1, reservasUsadas: 0 },
    { id: 'b', data: '2026-10-11', maquinas: 3, reservas: 1, reservasUsadas: 0 },
  ],
  maquinasIds: ['P-01', 'P-02', 'P-03', 'P-04'],
  reservasIds: ['P-04'],
  grupoId: '',
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 40,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'PIX',
  dataPagamento: '',
  status: 'EM_ABERTO',
  rodape: 'AGRADECEMOS SUA PRESENÇA!',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
}

const contrato = (extra: Partial<Contrato> = {}): Contrato => ({
  id: 'k1',
  versao: 1,
  numero: 7,
  eventoId: 'e1',
  clienteId: 'c1',
  status: 'AGUARDANDO',
  assinadoEm: '',
  motivoCancelamento: '',
  arquivo: null,
  criadoEm: '',
  atualizadoEm: '',
  dados: montarDadosContrato({
    evento,
    cliente,
    maquinas: ['P-01', 'P-02', 'P-03', 'P-04'].map(maq),
    config: { ...CONFIG_PADRAO, empresaRepresentante: 'Fabio de Godoy Lima', valorReposicaoP: 1800, valorReposicaoG: 2600 },
    entrada: {
      local: 'Salão paroquial',
      retirada: { data: '2026-10-09', hora: '15:00' },
      devolucao: { data: '2026-10-12', hora: '' },
      assinante: { nome: 'Maria Aparecida Souza', cpf: '529.982.247-25' },
      condicoes: '',
    },
    hoje: '2026-10-03',
  }),
  ...extra,
})

/** Para conferir à mão: SALVAR_PDF=/caminho/contrato.pdf npx vitest run src/lib/pdfContrato.test.ts */
async function salvarSePedido(doc: { output: (tipo: 'arraybuffer') => ArrayBuffer }, sufixo = '') {
  // Os testes rodam no Node, mas os tipos desta pasta são os do navegador
  const ambiente = globalThis as unknown as { process?: { env: Record<string, string | undefined> } }
  const salvar = ambiente.process?.env.SALVAR_PDF
  if (!salvar) return
  const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (c: string, d: Uint8Array) => void }
  fs.writeFileSync(salvar.replace(/\.pdf$/, `${sufixo}.pdf`), new Uint8Array(doc.output('arraybuffer')))
}

describe('contrato em PDF', () => {
  it('gera as páginas com o texto, as assinaturas, o termo de entrega e o rodapé com as rubricas', async () => {
    const { doc, nome } = await gerarContratoPDF(contrato())
    await salvarSePedido(doc)
    const paginas = doc.getNumberOfPages()
    expect(paginas).toBeGreaterThanOrEqual(3)
    expect(nome).toMatch(/^Contrato 0007 - .+ - Festa Junina\.pdf$/)
    const texto = doc.output()
    expect(texto).toContain('TERMO DE ENTREGA E DEVOLU')
    expect(texto).toContain(`${paginas} de ${paginas}`)
  })

  it('pessoa física assinando, datas separadas e empresa sem representante', async () => {
    const pf: Cliente = {
      ...cliente,
      tipo: 'PF',
      nome: 'João Carlos Pereira',
      razaoSocial: '',
      documento: '529.982.247-25',
      responsavel: '',
    }
    const ev: Evento = {
      ...evento,
      dias: [
        { id: 'a', data: '2026-10-10', maquinas: 3, reservas: 1, reservasUsadas: 0 },
        { id: 'b', data: '2026-10-17', maquinas: 4, reservas: 0, reservasUsadas: 0 },
      ],
      maquinasIds: ['P-01', 'P-02', 'P-03', 'G-04'],
      reservasIds: ['G-04'],
      bobinasConsignadas: 1,
    }
    const { doc } = await gerarContratoPDF(
      contrato({
        dados: montarDadosContrato({
          evento: ev,
          cliente: pf,
          maquinas: ['P-01', 'P-02', 'P-03', 'G-04'].map(maq),
          config: { ...CONFIG_PADRAO, valorReposicaoP: 1800 },
          entrada: {
            local: '',
            retirada: { data: '2026-10-09', hora: '15:00' },
            devolucao: { data: '2026-10-18', hora: '10:00' },
            assinante: { nome: 'João Carlos Pereira', cpf: '529.982.247-25' },
            condicoes: '',
          },
          hoje: '2026-10-03',
        }),
      }),
    )
    await salvarSePedido(doc, '-pf')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3)
  })

  it('contrato cancelado avisa no topo de cada página', async () => {
    const { doc } = await gerarContratoPDF(
      contrato({ status: 'CANCELADO', motivoCancelamento: 'Substituído pelo contrato nº 0008.' }),
    )
    expect(doc.output()).toContain('CONTRATO CANCELADO')
  })
})
