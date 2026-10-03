import { addDays, format, subMonths } from 'date-fns'
import { assinantePadrao, devolucaoPadrao, montarDadosContrato, retiradaPadrao } from './contrato.ts'
import { CLIENTE_VAZIO, CONFIG_PADRAO, MAQUINA_VAZIA } from './dominio.ts'
import { completarCnpj, completarCpf, mascaraCnpj, mascaraCpf } from './documentos.ts'
import { novoId } from './id.ts'
import { datasOcupadas, identificacaoPadrao, totalDia } from './maquinas.ts'
import type {
  Cliente,
  Contrato,
  Evento,
  FormaPagamento,
  Maquina,
  OrdemServico,
  Reclamacao,
  StatusEvento,
  StatusProgramacao,
  TipoMaquina,
} from './tipos.ts'

/** Serviços de manutenção do exemplo (entram na lista de serviços se ela estiver vazia). */
export const SERVICOS_EXEMPLO = ['Limpeza completa', 'Higienização', 'Revisão', 'Troca de cabeçote', 'Teste de impressão']

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
    // Alguns clientes levam uma máquina reserva; nos eventos que já passaram, às vezes ela foi usada
    const comReserva = r() < 0.25
    const finalizado = !futuro && r() < 0.85
    const dias = Array.from({ length: qtdDias }, (_, d) => ({
      id: novoId(),
      data: format(addDays(dataBase, d), 'yyyy-MM-dd'),
      maquinas: 1 + Math.floor(r() * 4),
      reservas: comReserva ? 1 : 0,
      reservasUsadas: comReserva && finalizado && r() < 0.3 ? 1 : 0,
    }))
    const consignadas = Math.round((10 + r() * 50) * qtdDias)
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
    const programacao: StatusProgramacao = futuro
      ? pick(['NAO_INICIADA', 'EM_PROGRAMACAO', 'ENVIADA', 'CONCLUIDA'] as const)
      : 'CONCLUIDA'

    eventos.push({
      id: novoId(),
      versao: 1,
      codigo: codigo++,
      clienteId: cliente.id,
      nome,
      cidade: '',
      cabecalho: '',
      dias,
      periodoCorrido: false,
      programacao,
      maquinasIds: [],
      reservasIds: [],
      grupoId: '',
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
    cidade: '',
    cabecalho: '',
    // 4 titulares e 1 reserva (no segundo dia, com muito movimento, a reserva foi usada)
    dias: [-1, 0, 1].map((d) => ({
      id: novoId(),
      data: format(addDays(hoje, d), 'yyyy-MM-dd'),
      maquinas: 4,
      reservas: 1,
      reservasUsadas: d === 0 ? 1 : 0,
    })),
    periodoCorrido: false,
    programacao: 'CONCLUIDA',
    maquinasIds: [],
    reservasIds: [],
    grupoId: '',
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

  // Um cliente que usa só nos fins de semana do mês, mas fica com as máquinas o período todo
  const primeiroSabado = addDays(hoje, ((6 - hoje.getDay() + 7) % 7) + 7)
  eventos.push({
    id: novoId(),
    versao: 1,
    codigo: codigo++,
    clienteId: clientes[3].id,
    nome: 'Feira de Artesanato',
    cidade: '',
    cabecalho: '',
    dias: [0, 1, 7, 8, 14, 15, 21, 22].map((d) => ({
      id: novoId(),
      data: format(addDays(primeiroSabado, d), 'yyyy-MM-dd'),
      maquinas: 3,
      reservas: 1,
      reservasUsadas: 0,
    })),
    periodoCorrido: true,
    programacao: 'EM_PROGRAMACAO',
    maquinasIds: [],
    reservasIds: [],
    grupoId: '',
    valorDiaria: 70,
    valorBobina: 6,
    bobinasConsignadas: 200,
    bobinasDevolvidas: null,
    desconto: 0,
    formaPagamento: 'NAO_PAGO',
    dataPagamento: '',
    status: 'EM_ABERTO',
    rodape: 'OBRIGADO PELA VISITA!',
    observacoes: 'Usa nos fins de semana do mês; as máquinas ficam no salão da associação.',
    criadoEm: ts,
    atualizadoEm: ts,
  })

  // Um cliente que já passou as datas dos próximos meses: um baile por mês, todos no mesmo grupo
  const grupoBaile = novoId()
  for (let mes = 1; mes <= 4; mes++) {
    const primeiroDoMes = new Date(hoje.getFullYear(), hoje.getMonth() + mes, 1)
    // Segundo sábado do mês
    const sabado = addDays(primeiroDoMes, ((6 - primeiroDoMes.getDay() + 7) % 7) + 7)
    eventos.push({
      id: novoId(),
      versao: 1,
      codigo: codigo++,
      clienteId: clientes[2].id,
      nome: 'Baile da Terceira Idade',
      cidade: '',
      cabecalho: '',
      dias: [{ id: novoId(), data: format(sabado, 'yyyy-MM-dd'), maquinas: 2, reservas: 0, reservasUsadas: 0 }],
      periodoCorrido: false,
      programacao: 'NAO_INICIADA',
      maquinasIds: [],
      reservasIds: [],
      grupoId: grupoBaile,
      valorDiaria: 80,
      valorBobina: 6,
      bobinasConsignadas: 40,
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
  }

  // Máquinas: 12 pequenas e 6 grandes, uma grande em manutenção e uma pequena antiga desativada
  const maquinas: Maquina[] = []
  const criar = (tipo: TipoMaquina, n: number, extra: Partial<Maquina> = {}) =>
    maquinas.push({
      ...MAQUINA_VAZIA,
      id: novoId(),
      versao: 1,
      tipo,
      identificacao: identificacaoPadrao(tipo, n),
      criadoEm: ts,
      atualizadoEm: ts,
      ...extra,
    })
  for (let n = 1; n <= 12; n++) criar('P', n)
  for (let n = 1; n <= 6; n++) criar('G', n, n === 4 ? { status: 'MANUTENCAO' } : {})
  criar('P', 13, { status: 'DESATIVADA' })

  // Máquinas enviadas: em cada evento, as livres naquelas datas (sem repetir entre eventos ao mesmo tempo)
  const emUso = new Map<string, Set<string>>()
  const operantes = maquinas.filter((m) => m.status === 'DISPONIVEL')
  for (const e of eventos) {
    // Só os eventos que já passaram ou estão perto têm as máquinas escolhidas (as do baile, não)
    if (e.grupoId) continue
    const precisa = Math.max(...e.dias.map(totalDia))
    const reservas = Math.max(...e.dias.map((d) => d.reservas))
    // Dias ocupados: com período corrido, também os do meio
    const datas = datasOcupadas(e)
    const ocupadas = new Set(datas.flatMap((d) => [...(emUso.get(d) ?? [])]))
    const livres = operantes.filter((m) => !ocupadas.has(m.id))
    const inicio = Math.floor(r() * livres.length)
    e.maquinasIds = Array.from({ length: Math.min(precisa, livres.length) }, (_, i) => livres[(inicio + i) % livres.length].id)
    // As últimas vão como reserva
    e.reservasIds = e.maquinasIds.length > reservas ? e.maquinasIds.slice(e.maquinasIds.length - reservas) : []
    for (const d of datas) emUso.set(d, new Set([...(emUso.get(d) ?? []), ...e.maquinasIds]))
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
        servicos: ['Limpeza completa', 'Higienização', 'Teste de impressão'],
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
      servicos: i % 2 ? ['Revisão'] : ['Troca de cabeçote', 'Teste de impressão'],
      problema: PROBLEMAS[i],
    })
  }
  const emManutencao = maquinas.find((m) => m.status === 'MANUTENCAO')!
  novaOS({
    maquinaId: emManutencao.id,
    tipo: 'CORRETIVA',
    status: 'EM_ANDAMENTO',
    abertura: format(addDays(hoje, -2), 'yyyy-MM-dd'),
    conclusao: '',
    servicos: ['Revisão'],
    problema: PROBLEMAS[4],
  })

  // Reclamações de clientes: nas duas primeiras locações já terminadas que tinham máquinas
  const reclamacoes: Reclamacao[] = []
  const hojeIso = format(hoje, 'yyyy-MM-dd')
  const terminados = eventos.filter(
    (e) => e.status === 'FINALIZADO' && e.maquinasIds.length && e.dias[e.dias.length - 1].data < hojeIso,
  )
  const relatos = ['Cliente disse que a máquina travou duas vezes no meio da festa.', 'Ficha saindo com a impressão fraca.']
  terminados.slice(-2).forEach((e, i) => {
    reclamacoes.push({
      id: novoId(),
      versao: 1,
      maquinaId: e.maquinasIds[0],
      eventoId: e.id,
      data: e.dias[e.dias.length - 1].data,
      descricao: relatos[i],
      criadoEm: ts,
      atualizadoEm: ts,
    })
  })

  // Contratos: a Festa da Primavera (assinado na retirada) e a Feira de Artesanato (esperando a assinatura)
  const contratos: Contrato[] = []
  const config = { ...CONFIG_PADRAO, empresaRepresentante: 'Fabio de Godoy Lima', valorReposicaoP: 1800, valorReposicaoG: 2600 }
  for (const nome of ['Festa da Primavera', 'Feira de Artesanato']) {
    const evento = eventos.find((e) => e.nome === nome)
    if (!evento) continue
    const cliente = clientes.find((c) => c.id === evento.clienteId)
    const assinado = nome === 'Festa da Primavera'
    const retirada = retiradaPadrao(evento)
    // Gerado 3 dias antes da retirada, mas nunca depois de hoje (a retirada pode estar perto)
    const tresDiasAntes = format(addDays(new Date(`${retirada.data}T12:00:00`), -3), 'yyyy-MM-dd')
    const emitido = tresDiasAntes < hojeIso ? tresDiasAntes : hojeIso
    contratos.push({
      id: novoId(),
      versao: 1,
      numero: contratos.length + 1,
      eventoId: evento.id,
      clienteId: evento.clienteId,
      status: assinado ? 'ASSINADO' : 'AGUARDANDO',
      assinadoEm: assinado ? retirada.data : '',
      motivoCancelamento: '',
      dados: montarDadosContrato({
        evento,
        cliente,
        maquinas,
        config,
        entrada: {
          local: '',
          retirada: { data: retirada.data, hora: '09:00' },
          devolucao: { ...devolucaoPadrao(evento), hora: '12:00' },
          assinante: assinantePadrao(cliente),
          condicoes: '',
        },
        hoje: emitido,
      }),
      arquivo: null,
      criadoEm: ts,
      atualizadoEm: ts,
    })
  }

  return {
    clientes,
    eventos,
    maquinas,
    ordens,
    reclamacoes,
    contratos,
    proximoCodigo: codigo,
    proximaOS: ordens.length + 1,
    proximoContrato: contratos.length + 1,
  }
}
