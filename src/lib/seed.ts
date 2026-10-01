import { addDays, format, subMonths } from 'date-fns'
import { novoId } from './storage'
import type { Cliente, Evento, FormaPagamento, StatusEvento } from './types'

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

export function gerarDadosExemplo(hoje: Date) {
  const r = rng(2026)
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]
  const ts = hoje.toISOString()

  const clientes: Cliente[] = CLIENTES.map((c, i) => ({
    id: novoId(),
    documento: c.tipo === 'PJ' ? `${10 + i}.${300 + i * 7}.${400 + i * 3}/0001-${10 + i}` : '123.456.789-09',
    telefone: `(19) 9${8100 + i * 37}-${String(1000 + i * 413).slice(0, 4)}`,
    email: '',
    endereco: '',
    observacoes: '',
    responsavel: '',
    cidade: '',
    uf: 'SP',
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

    eventos.push({
      id: novoId(),
      codigo: codigo++,
      clienteId: cliente.id,
      nome: pick(EVENTOS),
      local: pick(['Salão paroquial', 'Ginásio municipal', 'Sede social', 'Praça central', 'Quadra da escola']),
      cidade: cliente.cidade,
      dias,
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

  return { clientes, eventos, proximoCodigo: codigo }
}
