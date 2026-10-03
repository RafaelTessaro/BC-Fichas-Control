import { describe, expect, it } from 'vitest'
import {
  assinaOProprio,
  assinantePadrao,
  devolucaoPadrao,
  montarDadosContrato,
  mudancasDesde,
  pendenciasContrato,
  periodosRetirada,
  podeExcluirContrato,
  retiradaPadrao,
  textoContrato,
} from './contrato.ts'
import { CLIENTE_VAZIO, CONFIG_PADRAO, MAQUINA_VAZIA, normalizarDadosContrato, normalizarNovoContrato } from './dominio.ts'
import type { Cliente, Evento, Maquina } from './tipos.ts'

const cliente = (extra: Partial<Cliente> = {}): Cliente => ({
  ...CLIENTE_VAZIO,
  id: 'c1',
  versao: 1,
  criadoEm: '',
  atualizadoEm: '',
  tipo: 'PF',
  nome: 'Juliana Martins',
  documento: '529.982.247-25',
  telefone: '(19) 99999-0000',
  logradouro: 'Rua 2',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Rio Claro',
  uf: 'SP',
  ...extra,
})

const maq = (identificacao: string): Maquina => ({
  ...MAQUINA_VAZIA,
  id: identificacao,
  versao: 1,
  tipo: identificacao[0] as 'P' | 'G',
  identificacao,
  criadoEm: '',
  atualizadoEm: '',
})

const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: 'e1',
  versao: 1,
  codigo: 12,
  clienteId: 'c1',
  nome: 'Aniversário',
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: [
    { id: 'a', data: '2026-11-14', maquinas: 2, reservas: 1, reservasUsadas: 1 },
    { id: 'b', data: '2026-11-15', maquinas: 3, reservas: 0, reservasUsadas: 0 },
  ],
  maquinasIds: ['G-01', 'P-02', 'P-01'],
  reservasIds: ['G-01'],
  grupoId: '',
  valorDiaria: 50,
  valorBobina: 6,
  bobinasConsignadas: 20,
  bobinasDevolvidas: null,
  desconto: 30,
  formaPagamento: 'NAO_PAGO',
  dataPagamento: '',
  status: 'EM_ABERTO',
  rodape: 'OBRIGADO',
  observacoes: 'interno',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const entrada = {
  local: '',
  retirada: { data: '2026-11-13', hora: '17:30' },
  devolucao: { data: '2026-11-16', hora: '' },
  assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
  condicoes: '',
}
const dados = (e = evento(), c: Cliente | undefined = cliente(), extra = {}, ent: Partial<typeof entrada> = {}) =>
  montarDadosContrato({
    evento: e,
    cliente: c,
    maquinas: ['P-01', 'P-02', 'G-01'].map(maq),
    config: { ...CONFIG_PADRAO, ...extra },
    entrada: { ...entrada, ...ent },
    hoje: '2026-10-03',
  })
const dia = (data: string, maquinas = 2, reservas = 0) => ({ id: data, data, maquinas, reservas, reservasUsadas: 0 })
const textoTodo = (d = dados()) =>
  textoContrato(d, 3)
    .map((b) => (b.tipo === 'campos' ? b.itens.map((i) => i.join(': ')).join('\n') : b.texto))
    .join('\n')

describe('dados do contrato', () => {
  it('congela cliente, máquinas (reserva marcada), datas e valores — cobrando só as titulares', () => {
    const d = dados()
    expect(d.cliente).toMatchObject({
      nome: 'Juliana Martins',
      documento: 'CPF 529.982.247-25',
      endereco: 'Rua 2, 10 - Centro - Rio Claro/SP',
    })
    expect(d.evento.maquinas).toEqual([
      { identificacao: 'P-01', tipo: 'P', reserva: false },
      { identificacao: 'P-02', tipo: 'P', reserva: false },
      { identificacao: 'G-01', tipo: 'G', reserva: true },
    ])
    // 2 + 3 diárias × R$ 50 − R$ 30 de desconto (a reserva usada é acertada na devolução)
    expect(d.valores).toMatchObject({ diarias: 5, desconto: 30, total: 220 })
    expect(d.foro).toBe('Rio Claro - SP')
    expect(d.empresa.endereco).toContain('Rua 13')
  })

  it('sugere retirada no 1º dia, devolução no dia seguinte ao último e quem assina', () => {
    expect(retiradaPadrao(evento())).toEqual({ data: '2026-11-14', hora: '' })
    expect(devolucaoPadrao(evento())).toEqual({ data: '2026-11-16', hora: '' })
    expect(
      devolucaoPadrao(
        evento({
          periodoCorrido: true,
          dias: [
            { id: 'a', data: '2026-11-07', maquinas: 1, reservas: 0, reservasUsadas: 0 },
            { id: 'b', data: '2026-11-28', maquinas: 1, reservas: 0, reservasUsadas: 0 },
          ],
        }),
      ),
    ).toEqual({ data: '2026-11-29', hora: '' })
    expect(assinantePadrao(cliente())).toEqual({ nome: 'Juliana Martins', cpf: '529.982.247-25' })
    expect(
      assinantePadrao(cliente({ tipo: 'PJ', nome: 'Clube', documento: '12.403.843/0001-18', responsavel: 'Carlos' })),
    ).toEqual({ nome: 'Carlos', cpf: '' })
  })

  it('avisa o que vai sair em branco e o que mudou desde que o contrato foi gerado', () => {
    const avulso = dados(
      evento({ maquinasIds: [], reservasIds: [] }),
      cliente({
        tipo: 'AVULSO',
        nome: 'Cliente avulso',
        documento: '',
        logradouro: '',
        numero: '',
        bairro: '',
        cidade: '',
        uf: '',
      }),
    )
    const p = pendenciasContrato(avulso)
    expect(p.some((x) => /não tem nome/.test(x))).toBe(true)
    expect(p.some((x) => /CPF\/CNPJ/.test(x))).toBe(true)
    expect(p.some((x) => /máquinas ainda não foram escolhidas/.test(x))).toBe(true)
    expect(p.some((x) => /quem assina pela empresa/.test(x))).toBe(true)
    const gerado = dados()
    expect(mudancasDesde(gerado, dados())).toEqual([])
    expect(mudancasDesde(gerado, dados(evento({ valorDiaria: 60, maquinasIds: ['P-01'] })))).toEqual([
      'máquinas enviadas',
      'valores',
    ])
  })
})

describe('texto do contrato (escolhas do dono, dentro do CDC)', () => {
  it('traz as regras escolhidas: cancelamento, arrependimento, danos, bobinas, multa de 2% e foro do consumidor', () => {
    const t = textoTodo(dados(undefined, undefined, { valorReposicaoP: 1800, valorReposicaoG: 2600 }))
    expect(t).toContain('sem nenhum custo até 7 (sete) dias antes da primeira data de uso')
    expect(t).toContain('art. 49 do Código de Defesa do Consumidor')
    expect(t).toContain('no máximo 10% (dez por cento)')
    expect(t).toContain('R$ 1.800,00 por máquina P (pequena) e R$ 2.600,00 por máquina G (grande)')
    expect(t).toContain('nem por roubo, incêndio, enchente')
    expect(t).toContain('as bobinas que voltarem lacradas não são cobradas')
    expect(t).toContain('multa de 2% (dois por cento)')
    expect(t).toContain('Não há multa por atraso na devolução')
    expect(t).toContain('art. 101, inciso I')
    expect(t).toContain('art. 10, § 2º, da Medida Provisória 2.200-2/2001')
    expect(t).toContain('Máquinas enviadas: P-01 e P-02; como reserva, G-01.')
    expect(t).toContain('14/11/2026 (sábado): 2 máquinas + 1 reserva')
    expect(t).toContain('Retirada na sede da LOCADORA')
    expect(t).toContain('às 17h30')
    expect(t).toContain('às ____h____')
    // Nada de caução nem de testemunhas; as observações internas do evento não vão para o contrato
    expect(t).not.toMatch(/cau[çc][ãa]o|testemunha/i)
    expect(t).not.toContain('interno')
  })

  it('sem reserva, sem a cláusula da reserva; sem valor de reposição, "valor de mercado, por orçamento"', () => {
    const semReserva = evento({
      dias: [{ id: 'a', data: '2026-11-14', maquinas: 2, reservas: 0, reservasUsadas: 0 }],
      reservasIds: [],
    })
    const t = textoTodo(dados(semReserva))
    expect(t).not.toContain('DA MÁQUINA RESERVA')
    expect(t).toContain('valor de mercado de uma máquina equivalente usada')
    // As cláusulas são numeradas sem buraco
    const numeros = [...t.matchAll(/CLÁUSULA (\d+)ª/g)].map((m) => Number(m[1]))
    expect(numeros).toEqual(numeros.map((_, i) => i + 1))
  })

  it('as cláusulas que limitam direitos vêm em destaque (negrito)', () => {
    const blocos = textoContrato(dados(), 1)
    const destacados = blocos.filter((b) => b.tipo === 'paragrafo' && b.destaque).map((b) => (b as { texto: string }).texto)
    expect(destacados.some((x) => x.includes('multa de 2%'))).toBe(true)
    expect(destacados.some((x) => x.includes('valor de reposição'))).toBe(true)
    expect(destacados.some((x) => x.includes('lacradas'))).toBe(true)
    expect(destacados.some((x) => x.includes('reter no máximo 10%'))).toBe(true)
  })
})

describe('texto do contrato: casos da revisão', () => {
  it('quantidade do dia de maior uso de verdade; a reserva trabalha como titular nas datas sem reserva', () => {
    // 2+1 no sábado e 3 no domingo: o dia de maior uso é o de 3 titulares (e não "3 + 1")
    const t = textoTodo()
    expect(t).toContain('(3 máquinas no dia de maior uso)')
    expect(t).toContain('Nas datas sem reserva, a máquina marcada como reserva pode ser usada como titular')
    expect(t).toContain('A máquina reserva fica com o LOCATÁRIO sem custo, nas datas com reserva indicadas na cláusula 3ª')
    // Marcada como reserva sem nenhum dia com reserva: vai como titular
    const semReserva = dados(evento({ dias: [dia('2026-11-14', 3)] }))
    expect(semReserva.evento.maquinas.every((m) => !m.reserva)).toBe(true)
    expect(textoTodo(semReserva)).toContain('(3 máquinas)')
  })

  it('datas separadas: uma retirada e uma devolução por período, com a mesma distância e os mesmos horários', () => {
    const separado = dados(
      evento({ dias: [dia('2026-11-14'), dia('2026-11-15'), dia('2026-11-21')] }),
      undefined,
      {},
      {
        devolucao: { data: '2026-11-22', hora: '10:00' },
      },
    )
    expect(periodosRetirada(separado)).toEqual([
      { retirada: { data: '2026-11-13', hora: '17:30' }, devolucao: { data: '2026-11-16', hora: '10:00' } },
      { retirada: { data: '2026-11-20', hora: '17:30' }, devolucao: { data: '2026-11-22', hora: '10:00' } },
    ])
    const t = textoTodo(separado)
    expect(t).toContain('Entre um período de uso e outro, as máquinas voltam à LOCADORA')
    expect(t).toContain('2º período: retirada em 20/11/2026, às 17h30; devolução até 22/11/2026, às 10h00.')
    expect(t).toContain('Retirada: 13/11/2026, às 17h30 (1º de 2 períodos; os demais na cláusula 3ª)')
    // Com período corrido, um período só
    expect(periodosRetirada({ ...separado, evento: { ...separado.evento, periodoCorrido: true } })).toHaveLength(1)
    // Devolveria no dia da retirada seguinte: as máquinas ficam com o cliente
    const perto = dados(
      evento({ dias: [dia('2026-11-14'), dia('2026-11-16')] }),
      undefined,
      {},
      {
        devolucao: { data: '2026-11-17', hora: '' },
      },
    )
    expect(periodosRetirada(perto)).toEqual([
      { retirada: { data: '2026-11-13', hora: '17:30' }, devolucao: { data: '2026-11-17', hora: '' } },
    ])
  })

  it('reposição por tipo; 1 bobina no singular; representante em branco para preencher', () => {
    const t = textoTodo(dados(evento({ bobinasConsignadas: 1 }), undefined, { valorReposicaoP: 1800 }))
    expect(t).toContain(
      'R$ 1.800,00 por máquina P (pequena); para a máquina G (grande), o valor de mercado de uma máquina equivalente usada',
    )
    expect(t).toContain('1. É entregue 1 (uma) bobina em consignação, ao preço de R$ 6,00.')
    expect(t).toContain('neste ato representada por ____________________, CPF ____________________.')
  })

  it('o próprio cliente assina sem "representado por"; outra pessoa assina como representante', () => {
    const proprio = dados()
    expect(assinaOProprio(proprio)).toBe(true)
    expect(textoTodo(proprio)).not.toContain('neste ato representado por')
    const outro = dados(undefined, undefined, {}, { assinante: { nome: 'Pedro Martins', cpf: '' } })
    expect(assinaOProprio(outro)).toBe(false)
    expect(textoTodo(outro)).toContain('neste ato representado por Pedro Martins, CPF ____________________.')
    const pj = dados(
      undefined,
      cliente({ tipo: 'PJ', nome: 'Clube', documento: '12.403.843/0001-18' }),
      {},
      {
        assinante: { nome: 'Juliana Martins', cpf: '529.982.247-25' },
      },
    )
    expect(assinaOProprio(pj)).toBe(false)
  })

  it('dados pessoais (LGPD) em destaque, com os direitos do titular', () => {
    const blocos = textoContrato(dados(), 1)
    const i = blocos.findIndex((b) => b.tipo === 'clausula' && b.texto.includes('DADOS PESSOAIS'))
    const lgpd = blocos.slice(
      i + 1,
      blocos.findIndex((b, j) => j > i && b.tipo === 'clausula'),
    )
    expect(lgpd.every((b) => b.tipo === 'paragrafo' && b.destaque)).toBe(true)
    const texto = lgpd.map((b) => (b as { texto: string }).texto).join(' ')
    expect(texto).toContain('art. 18 da LGPD')
    expect(texto).toContain('portabilidade')
    expect(texto).toContain('agenda on-line')
  })

  it('pode excluir o cancelado ou, 5 anos depois do fim da locação, qualquer um', () => {
    const d = dados()
    expect(podeExcluirContrato({ status: 'CANCELADO', dados: d }, '2026-10-03')).toBe(true)
    expect(podeExcluirContrato({ status: 'ASSINADO', dados: d }, '2026-10-03')).toBe(false)
    expect(podeExcluirContrato({ status: 'ASSINADO', dados: d }, '2031-11-16')).toBe(false)
    expect(podeExcluirContrato({ status: 'ASSINADO', dados: d }, '2031-11-17')).toBe(true)
  })

  it('o texto do modelo 1 não muda (mudou uma cláusula? crie o modelo 2)', () => {
    const d = dados(undefined, undefined, { empresaRepresentante: 'Fabio de Godoy Lima', valorReposicaoP: 1800 })
    expect(d.modelo).toBe(1)
    expect(textoTodo(d)).toMatchSnapshot()
    // Modelo desconhecido (backup de uma versão mais nova): sai com o texto atual
    expect(textoTodo({ ...d, modelo: 99 })).toBe(textoTodo(d))
    // Gravado antes do número do modelo: é o modelo 1, com as condições do contrato vazias
    const { modelo: _m, condicoesContrato: _c, ...antigo } = d
    expect(normalizarDadosContrato(antigo)).toMatchObject({ modelo: 1, condicoesContrato: '' })
  })
})

describe('pedido de contrato', () => {
  it('confere o CPF de quem assina, as horas e a ordem das datas', () => {
    expect(normalizarNovoContrato({ eventoId: 'e1', assinante: { cpf: '111.111.111-11' } }).erros).toContain(
      'CPF de quem assina pelo cliente inválido. Confira o número digitado.',
    )
    const { valor, erros } = normalizarNovoContrato({
      eventoId: 'e1',
      retirada: { data: '2026-11-13', hora: '25:00' },
      devolucao: { data: '2026-11-16', hora: '09:30' },
      assinante: { nome: ' Ana ', cpf: '52998224725' },
    })
    expect(erros).toEqual([])
    expect(valor).toMatchObject({
      retirada: { hora: '' },
      devolucao: { hora: '09:30' },
      assinante: { nome: 'Ana', cpf: '529.982.247-25' },
    })
    expect(
      normalizarNovoContrato({ eventoId: 'e1', retirada: { data: '2026-11-13' }, devolucao: { data: '2026-11-12' } }).erros,
    ).toContain('A devolução não pode ser antes da retirada.')
  })
})
