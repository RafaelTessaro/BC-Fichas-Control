import { addDays, format, subMonths } from 'date-fns'
import { CLIENTE_VAZIO, MAQUINA_VAZIA } from './dominio.ts'
import { completarCnpj, completarCpf, mascaraCnpj, mascaraCpf } from './documentos.ts'
import { novoId } from './id.ts'
import { identificacaoPadrao } from './maquinas.ts'
import type { Cliente, Evento, FormaPagamento, Maquina, OrdemServico, StatusEvento, TipoMaquina } from './tipos.ts'

/** Gerador pseudoaleatório determinístico para que o exemplo seja sempre igual. */
function rng(semente: number) {
  let s = semente
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const CLIENTES: Array<Partial<Cliente> & Pick<Cliente, 'nome' | 'tipo'>> = [
  { nome: 'Padaria Ideal', tipo: 'PJ', responsavel: 'Marcos Souza', cidade: 'Rio Claro', uf: 'SP' },
  { nome: 'Clube Recreativo Primavera', tipo: 'PJ', responsavel: 'Ana Lúcia Prado', cidade: 'Rio Claro', uf: 'SP' },
  { nome: 'Paróquia São José', tipo: 'PJ', responsavel: 'Pe. Antônio', cidade: 'Araras', uf: 'SP' },
  { nome: 'Associação Amigos do Bairro', tipo: 'PJ', responsavel: 'Cláudio Reis', cidade: 'Limeira', uf: 'SP' },
  { nome: 'Colégio Horizonte', tipo: 'PJ', responsavel: 'Fernanda Lima', cidade: 'Piracicaba', uf: 'SP' },
  { nome: 'Buffet Estrela', tipo: 'PJ', responsavel: 'Rogério Alves', cidade: 'Rio Claro', uf: 'SP' },
  { nome: 'Juliana Martins', tipo: 'PF', responsavel: '', cidade: 'Santa Gertrudes', uf: 'SP' },
  { nome: 'Comissão de Festas Vila Nova', tipo: 'PJ', responsavel: 'Sérgio Tavares', cidade: 'Ipeúna', uf: 'SP' },
  { nome: 'Barraca do Seu Zé', tipo: 'AVULSO', responsavel: '', cidade: 'Rio Claro', uf: 'SP' },
]

const EVENTOS = [
  'Baile da Cidade',
  'Festa Junina',
  'Quermesse',
  'Festival de Inverno',
  'Festa do Padroeiro',
  'Formatura 3º ano',
  'Encontro de Carros Antigos',
  'Arraiá Beneficente',
  'Festa da Primavera',
  'Aniversário de 15 anos',
  'Feira Gastronômica',
  'Show de Aniversário',
]

const FORMAS: FormaPagamento[] = ['PIX', 'PIX', 'PIX', 'DINHEIRO', 'BOLETO', 'CREDITO', 'DEBITO']

const PROBLEMAS = [
  'Papel enroscando na impressora',
  'Guilhotina não corta a ficha até o fim',
  'Tela sem resposta ao toque em alguns pontos',
  'Leitor de cartão sem comunicação',
  'Bateria não segura carga',
]

export function gerarDadosExemplo(hoje: Date) {
  const r = rng(2026)
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]
  const ts = hoje.toISOString()

  const clientes: Cliente[] = CLIENTES.map((c, i) => ({
    ...CLIENTE_VAZIO,
    id: novoId(),
    versao: 1,
    documento:
      c.tipo === 'PJ'
        ? mascaraCnpj(completarCnpj(`${10 + i}${300 + i * 7}${400 + i * 3}0001`))
        : c.tipo === 'PF'
          ? mascaraCpf(completarCpf(`${123456780 + i}`))
          : '',
    razaoSocial: c.tipo === 'PJ' ? `${c.nome.toUpperCase()} LTDA` : '',
    situacaoCadastral: c.tipo === 'PJ' ? 'ATIVA' : '',
    telefone: `(19) 9${8100 + i * 37}-${String(1000 + i * 413).slice(0, 4)}`,
    criadoEm: ts,
    atualizadoEm: ts,
    ...c,
  }))

  const eventos: Evento[] = []
  let codigo = 1
  const inicio = subMonths(hoje, 11)

  // ~3 eventos por mês nos últimos 11 meses + alguns futuros
  for (let semana = 0; semana < 52; semana++) {
    if (r() < 0.38) continue
    const dataBase = addDays(inicio, semana * 7 + Math.floor(r() * 3) + 3)
    const futuro = dataBase > hoje
    if (futuro && dataBase > addDays(hoje, 45)) break

    const qtdDias = r() < 0.55 ? 1 : r() < 0.7 ? 2 : 3
    const dias = Array.from({ length: qtdDias }, (_, d) => ({
      id: novoId(),
      data: format(addDays(dataBase, d), 'yyyy-MM-dd'),
      maquinas: 1 + Math.floor(r() * 4),
    }))
    const consignadas = Math.round((10 + r() * 50) * qtdDias)
    const finalizado = !futuro && r() < 0.85
    const devolvidas = futuro ? null : finalizado || r() < 0.5 ? Math.floor(consignadas * (0.15 + r() * 0.5)) : null
    const pago = finalizado && r() < 0.88
    const status: StatusEvento = futuro
      ? 'EM_ABERTO'
      : finalizado
        ? pago
          ? 'FINALIZADO'
          : 'PENDENTE'
        : r() < 0.15
          ? 'CANCELADO'
          : 'PENDENTE'
    const cliente = pick(clientes)
    const nome = pick(EVENTOS)

    eventos.push({
      id: novoId(),
      versao: 1,
      codigo: codigo++,
      clienteId: cliente.id,
      nome,
      cidade: cliente.cidade,
      cabecalho: `${nome.toUpperCase()}\n${cliente.nome.toUpperCase()}`,
      dias,
      maquinasIds: [],
      valorDiaria: 80,
      valorBobina: 6,
      bobinasConsignadas: consignadas,
      bobinasDevolvidas: devolvidas,
      desconto: r() < 0.12 ? 20 : 0,
      formaPagamento: pago ? pick(FORMAS) : 'NAO_PAGO',
      dataPagamento: pago ? dias[dias.length - 1].data : '',
      status,
      rodape: 'AGRADECEMOS SUA PRESENÇA!',
      observacoes: '',
      criadoEm: ts,
      atualizadoEm: ts,
    })
  }

  // Um evento acontecendo hoje, para o exemplo mostrar máquinas locadas
  const clienteHoje = clientes[1]
  eventos.push({
    id: novoId(),
    versao: 1,
    codigo: codigo++,
    clienteId: clienteHoje.id,
    nome: 'Festa da Primavera',
    cidade: clienteHoje.cidade,
    cabecalho: `FESTA DA PRIMAVERA\n${clienteHoje.nome.toUpperCase()}`,
    dias: [-1, 0, 1].map((d) => ({ id: novoId(), data: format(addDays(hoje, d), 'yyyy-MM-dd'), maquinas: 4 })),
    maquinasIds: [],
    valorDiaria: 80,
    valorBobina: 6,
    bobinasConsignadas: 120,
    bobinasDevolvidas: null,
    desconto: 0,
    formaPagamento: 'NAO_PAGO',
    dataPagamento: '',
    status: 'EM_ABERTO',
    rodape: 'AGRADECEMOS SUA PRESENÇA!',
    observacoes: '',
    criadoEm: ts,
    atualizadoEm: ts,
  })

  // Máquinas: 12 pequenas e 6 grandes, uma grande em manutenção e uma pequena antiga desativada
  const maquinas: Maquina[] = []
  const criar = (tipo: TipoMaquina, n: number, extra: Partial<Maquina> = {}) =>
    maquinas.push({
      ...MAQUINA_VAZIA,
      id: novoId(),
      versao: 1,
      tipo,
      identificacao: identificacaoPadrao(tipo, n),
      modelo: tipo === 'P' ? 'Compacta 2 vias' : 'Totem com tela 15"',
      numeroSerie: `${tipo}${2024}${String(n * 37).padStart(4, '0')}`,
      dataAquisicao: format(subMonths(hoje, 30 - n), 'yyyy-MM-dd'),
      criadoEm: ts,
      atualizadoEm: ts,
      ...extra,
    })
  for (let n = 1; n <= 12; n++) criar('P', n)
  for (let n = 1; n <= 6; n++) criar('G', n, n === 4 ? { status: 'MANUTENCAO' } : {})
  criar('P', 13, { status: 'DESATIVADA', observacoes: 'Placa principal queimada; sem conserto.' })

  // Máquinas enviadas: em cada evento, as livres naquelas datas (sem repetir entre eventos ao mesmo tempo)
  const emUso = new Map<string, Set<string>>()
  const operantes = maquinas.filter((m) => m.status === 'DISPONIVEL')
  for (const e of eventos) {
    const precisa = Math.max(...e.dias.map((d) => d.maquinas))
    const ocupadas = new Set(e.dias.flatMap((d) => [...(emUso.get(d.data) ?? [])]))
    const livres = operantes.filter((m) => !ocupadas.has(m.id))
    const inicio = Math.floor(r() * livres.length)
    e.maquinasIds = Array.from({ length: Math.min(precisa, livres.length) }, (_, i) => livres[(inicio + i) % livres.length].id)
    for (const d of e.dias) emUso.set(d.data, new Set([...(emUso.get(d.data) ?? []), ...e.maquinasIds]))
  }

  // Histórico de manutenção: limpezas periódicas e alguns consertos
  const ordens: OrdemServico[] = []
  const novaOS = (o: Partial<OrdemServico> & Pick<OrdemServico, 'maquinaId' | 'abertura'>) =>
    ordens.push({
      id: novoId(),
      versao: 1,
      numero: ordens.length + 1,
      tipo: 'PREVENTIVA',
      status: 'CONCLUIDA',
      conclusao: o.abertura,
      servicos: [],
      problema: '',
      solucao: '',
      pecas: '',
      responsavel: 'Rafael',
      custo: 0,
      criadoEm: ts,
      atualizadoEm: ts,
      ...o,
    })
  for (let mes = 10; mes >= 1; mes -= 3) {
    for (const m of operantes.filter((_, i) => i % 3 === mes % 3)) {
      novaOS({
        maquinaId: m.id,
        abertura: format(subMonths(hoje, mes), 'yyyy-MM-dd'),
        servicos: ['Limpeza completa', 'Higienização', 'Teste de funcionamento'],
        solucao: 'Limpeza interna e externa, higienização da tela e teste de impressão.',
      })
    }
  }
  for (let i = 0; i < 4; i++) {
    const m = operantes[(i * 5) % operantes.length]
    const abertura = format(subMonths(hoje, 9 - i * 2), 'yyyy-MM-dd')
    novaOS({
      maquinaId: m.id,
      tipo: 'CORRETIVA',
      abertura,
      conclusao: format(addDays(subMonths(hoje, 9 - i * 2), 2), 'yyyy-MM-dd'),
      servicos: i % 2 ? ['Reparo elétrico'] : ['Reparo da impressora', 'Troca de peças'],
      problema: PROBLEMAS[i],
      solucao: i % 2 ? 'Conector de alimentação refeito e bateria testada.' : 'Rolete da impressora trocado e lâmina ajustada.',
      pecas: i % 2 ? '' : 'Rolete de tração',
      custo: i % 2 ? 60 : 145,
    })
  }
  const emManutencao = maquinas.find((m) => m.status === 'MANUTENCAO')!
  novaOS({
    maquinaId: emManutencao.id,
    tipo: 'CORRETIVA',
    status: 'EM_ANDAMENTO',
    abertura: format(addDays(hoje, -2), 'yyyy-MM-dd'),
    conclusao: '',
    servicos: ['Reparo da impressora'],
    problema: PROBLEMAS[4],
  })

  return { clientes, eventos, maquinas, ordens, proximoCodigo: codigo, proximaOS: ordens.length + 1 }
}
