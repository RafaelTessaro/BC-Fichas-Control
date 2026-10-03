import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CalendarRange,
  Check,
  Clock,
  CopyCheck,
  CornerDownRight,
  CreditCard,
  Landmark,
  MoveHorizontal,
  Package,
  Plus,
  QrCode,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnexosEvento } from '../components/AnexosEvento'
import { ConferenciaBadge } from '../components/Badges'
import { ClienteFormModal } from '../components/ClienteFormModal'
import { SeletorMaquinas } from '../components/MaquinasEvento'
import { SeletorProgramacao } from '../components/Programacao'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Combobox, type AcaoCombo } from '../components/ui/Combobox'
import { CurrencyInput, Field, Input, NumberInput, Select, Textarea } from '../components/ui/Form'
import { Modal } from '../components/ui/Modal'
import { confirmar } from '../components/ui/Feedback'
import { ErroApi } from '../lib/api'
import { AnimatedNumber, Avatar, EmptyState, PageHeader } from '../components/ui/Misc'
import { calcularEvento, FORMAS_PAGAMENTO, ocupacaoPorDia, STATUS_EVENTO } from '#shared/calc.ts'
import { enviarPendentes } from '../lib/anexos'
import { listaDatas, resumoTrocas, trocasMaquinas } from '../lib/bloqueioMaquinas'
import { cn } from '../lib/cn'
import { codigoEvento, dataExtensa, hojeISO, moeda, normalizar, numero } from '../lib/format'
import { CLIENTE_VAZIO, LIMITES } from '#shared/dominio.ts'
import {
  capacidade,
  diasOcupados,
  ordenarMaquinas,
  quantidadeCurta,
  reservasDia,
  reservasUsadasDia,
  STATUS_PROGRAMACAO,
  totalDia,
  type DiaOcupado,
} from '#shared/maquinas.ts'
import { novoId } from '../lib/storage'
import type { DiaEvento, Evento, FormaPagamento, StatusEvento, TipoCliente } from '#shared/tipos.ts'
import { useDados, type EventoInput } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { useHoje } from '../lib/hoje'

const ICONES_PAGAMENTO: Record<FormaPagamento, ReactNode> = {
  NAO_PAGO: <Clock className="h-4 w-4" />,
  PIX: <QrCode className="h-4 w-4" />,
  DINHEIRO: <Banknote className="h-4 w-4" />,
  DEBITO: <CreditCard className="h-4 w-4" />,
  CREDITO: <CreditCard className="h-4 w-4" />,
  BOLETO: <Landmark className="h-4 w-4" />,
}
const ORDEM_PAGAMENTO: FormaPagamento[] = ['NAO_PAGO', 'PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO']

/** O que é a reserva, na descrição dos dias de utilização. */
const explicacaoReserva = (
  <>
    <b className="font-medium text-ink-2">Reserva:</b> máquina a mais que fica com o cliente sem custo; se ele usar, marque “Usou
    a reserva” para cobrar pelo valor da diária.
  </>
)

type Erros = Partial<Record<'cliente' | 'nome' | 'dias' | 'bobinas', string>>

export function EventoForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const { eventos, clientes, maquinas, config, salvarEvento, enviarAnexo } = useDados()
  const existente = id ? eventos.find((e) => e.id === id) : undefined
  // Saiu da tela enquanto salvava (ex.: enviando arquivos): não puxa a pessoa de volta para o evento
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const [f, setF] = useState<EventoInput>(() => {
    if (existente) {
      const { id: _i, versao: _v, codigo: _c, criadoEm: _cr, atualizadoEm: _a, google: _g, ...resto } = existente
      // Dias gravados antes da máquina reserva não têm as reservas: começam com zero
      return {
        ...resto,
        dias: resto.dias.map((d) => ({ ...d, reservas: reservasDia(d), reservasUsadas: reservasUsadasDia(d) })),
        reservasIds: (resto.reservasIds ?? []).filter((x) => resto.maquinasIds.includes(x)),
        grupoId: resto.grupoId ?? '',
      }
    }
    return {
      clienteId: params.get('cliente') ?? '',
      nome: '',
      cidade: '',
      cabecalho: '',
      periodoCorrido: false,
      programacao: 'NAO_INICIADA',
      dias: [{ id: novoId(), data: params.get('data') ?? hojeISO(), maquinas: 1, reservas: 0, reservasUsadas: 0 }],
      maquinasIds: [],
      reservasIds: [],
      grupoId: '',
      valorDiaria: config.valorDiariaPadrao,
      valorBobina: config.valorBobinaPadrao,
      bobinasConsignadas: 0,
      bobinasDevolvidas: null,
      desconto: 0,
      formaPagamento: 'NAO_PAGO',
      dataPagamento: '',
      status: 'EM_ABERTO',
      rodape: config.rodapePadrao,
      observacoes: '',
    }
  })
  const [erros, setErros] = useState<Erros>({})
  // 'arquivos': o evento novo já foi criado e os arquivos escolhidos estão sendo enviados
  const [salvando, setSalvando] = useState<false | 'evento' | 'arquivos'>(false)
  // Evento novo: os arquivos escolhidos esperam o evento ser criado para serem enviados
  const [pendentes, setPendentes] = useState<File[]>([])
  // Versão aberta para edição; se outra pessoa salvar antes, o servidor recusa e avisamos
  const [versaoBase, setVersaoBase] = useState(existente?.versao)
  const [clienteModal, setClienteModal] = useState<{ aberto: boolean; nome?: string; tipo?: TipoCliente }>({ aberto: false })
  const [periodoModal, setPeriodoModal] = useState(false)

  const set = <K extends keyof EventoInput>(k: K, v: EventoInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const resumo = useMemo(() => calcularEvento(f), [f])
  // Reservas com o cliente que não foram usadas (somando os dias): ficam sem custo
  const reservasSemUso = resumo.reservas - resumo.diariasReserva
  const ocupacao = useMemo(() => ocupacaoPorDia(eventos, id), [eventos, id])
  // Máquinas que a empresa tem (sem as desativadas); sem cadastro, a quantidade das configurações
  const cap = useMemo(() => capacidade(maquinas, config), [maquinas, config])
  const totalMaquinas = cap.total
  // De hoje em diante, as máquinas em manutenção não estão livres (como no cartão de máquinas abaixo)
  const hoje = useHoje()
  const emManutencao = (data: string) => (data >= hoje ? cap.manutencao : 0)
  const cliente = clientes.find((c) => c.id === f.clienteId)
  // Cidade e telefone, embaixo do cliente. A cidade é a do cadastro dele (o evento não tem mais
  // cidade própria; os antigos mantêm a que tinham)
  const cidade = f.cidade.trim() || (cliente?.cidade ? [cliente.cidade, cliente.uf].filter(Boolean).join(' - ') : '')
  const contatoCliente = [cidade, cliente?.telefone].filter(Boolean).join(' • ')

  const irParaMaquinas = () =>
    document.getElementById('maquinas-enviadas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Vindo do detalhe por "Marcar máquinas": rola até o cartão das máquinas
  const secao = params.get('secao')
  useEffect(() => {
    if (secao !== 'maquinas') return
    const t = setTimeout(irParaMaquinas, 150)
    return () => clearTimeout(t)
  }, [secao])

  // ---- Rodapé das fichas (o topo é o nome do evento) ----------------------------
  const rodapePadrao = config.rodapePadrao.trim()
  const linhasRodape = Math.min(6, Math.max(2, f.rodape.split('\n').length))

  const opcoesClientes = useMemo(
    () =>
      [...clientes]
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map((c) => ({
          valor: c.id,
          label: c.nome,
          detalhe: [c.tipo === 'AVULSO' ? 'Avulso' : c.documento, c.cidade].filter(Boolean).join(' • '),
          icone: <Avatar nome={c.nome} className="h-6 w-6 rounded-md text-[10px]" />,
        })),
    [clientes],
  )

  // ---- Seletor de cliente: cadastro completo (modal) ou cliente avulso na hora ----
  // A cidade não é mais preenchida: vale a do cadastro do cliente (eventos antigos mantêm a sua)
  const salvarCliente = useDados((s) => s.salvarCliente)
  const selecionarCliente = (c: { id: string }) => {
    // Trocou o cliente: a cidade antiga (de eventos da versão anterior) era do outro cliente
    setF((s) => ({ ...s, clienteId: c.id, cidade: s.clienteId === c.id ? s.cidade : '' }))
    setErros((e) => ({ ...e, cliente: undefined }))
  }
  // Trava contra duplo clique (ou Enter seguido de clique): cada execução criaria outro avulso
  const criandoAvulso = useRef(false)
  const usarComoAvulso = async (nome: string) => {
    if (criandoAvulso.current) return
    criandoAvulso.current = true
    try {
      const c = await salvarCliente({ ...CLIENTE_VAZIO, tipo: 'AVULSO', nome })
      selecionarCliente(c)
      toast.sucesso('Cliente avulso criado', c.nome)
    } catch (e) {
      avisarErro('Não foi possível criar o cliente avulso', e)
    } finally {
      criandoAvulso.current = false
    }
  }
  // Nome digitado que ainda não é de nenhum cliente: vira avulso direto, sem abrir o cadastro
  const nomeNovo = (nome: string) => !!nome && !clientes.some((c) => normalizar(c.nome) === normalizar(nome))
  const acoesCliente: AcaoCombo[] = [
    {
      label: (nome: string) => (
        <>
          Cadastrar novo cliente
          {nome && <span className="truncate text-muted">“{nome}”</span>}
        </>
      ),
      icone: <UserPlus className="h-4 w-4" />,
      aoClicar: (nome: string) => setClienteModal({ aberto: true, nome }),
    },
    {
      // Sempre visível: sem nome digitado, abre o cadastro já em "Avulso" (só pede o nome)
      label: (nome: string) =>
        nomeNovo(nome) ? (
          <>
            Usar como cliente avulso: <span className="truncate">“{nome}”</span>
          </>
        ) : (
          <>
            Cliente avulso <span className="font-normal text-muted">(sem cadastro)</span>
          </>
        ),
      icone: <UserRound className="h-4 w-4" />,
      aoClicar: (nome: string) =>
        nomeNovo(nome) ? void usarComoAvulso(nome) : setClienteModal({ aberto: true, nome, tipo: 'AVULSO' }),
    },
  ]

  // ---- Dias -----------------------------------------------------------------
  const datasRepetidas = useMemo(() => {
    const vistos = new Set<string>()
    const rep = new Set<string>()
    for (const d of f.dias) {
      if (vistos.has(d.data)) rep.add(d.data)
      vistos.add(d.data)
    }
    return rep
  }, [f.dias])

  // ---- Dias ocupados: com período corrido, também os do meio (com a maior quantidade) ----
  const ocupados = useMemo(() => diasOcupados({ dias: f.dias, periodoCorrido: f.periodoCorrido }), [f.dias, f.periodoCorrido])
  // Máquinas fora da empresa em cada data: titulares + reservas (a reserva também sai)
  const qtdOcupada = useMemo(() => new Map(ocupados.map((d) => [d.data, totalDia(d)])), [ocupados])
  /** Datas de uso distintas, em ordem. */
  const datasUso = useMemo(() => [...new Set(f.dias.map((d) => d.data).filter(Boolean))].sort(), [f.dias])
  // Há dias sem uso entre o primeiro e o último: aí faz sentido perguntar se as máquinas voltam
  const temIntervalo =
    datasUso.length >= 2 &&
    differenceInCalendarDays(parseISO(datasUso[datasUso.length - 1]), parseISO(datasUso[0])) + 1 > datasUso.length
  /** Máquinas livres na data (sem as deste evento), descontando as em manutenção de hoje em diante. */
  const livresEm = (data: string) => totalMaquinas - emManutencao(data) - (ocupacao.get(data) ?? 0)
  // Dias do meio (só com o cliente) sem máquinas suficientes para as deste evento
  const faltasNoMeio = ocupados.filter((d) => !d.uso && totalDia(d) > livresEm(d.data))

  // As usadas nunca passam das reservas do dia (diminuiu a reserva: o uso acompanha)
  const atualizarDia = (diaId: string, patch: Partial<DiaEvento>) =>
    set(
      'dias',
      f.dias.map((d) => {
        if (d.id !== diaId) return d
        const novo = { ...d, ...patch }
        return { ...novo, reservasUsadas: reservasUsadasDia(novo) }
      }),
    )

  // ---- Reserva: a mesma em todos os dias -------------------------------------------
  const maiorReserva = Math.max(0, ...f.dias.map(reservasDia))
  const mostrarMesmaReserva = f.dias.length > 1 && maiorReserva > 0
  const reservaJaIgual = f.dias.every((d) => reservasDia(d) === maiorReserva)
  const mesmaReserva = () => {
    set(
      'dias',
      f.dias.map((d) => ({ ...d, reservas: maiorReserva, reservasUsadas: Math.min(reservasUsadasDia(d), maiorReserva) })),
    )
    toast.sucesso(
      'Mesma reserva em todos os dias',
      `${maiorReserva} ${maiorReserva === 1 ? 'reserva' : 'reservas'} por dia, como no dia que tinha mais.`,
    )
  }
  const botaoMesmaReserva = (className?: string) => (
    <BotaoTexto
      icone={<CopyCheck className="h-3.5 w-3.5" />}
      onClick={mesmaReserva}
      disabled={reservaJaIgual}
      title={
        reservaJaIgual
          ? `Todos os dias já têm ${maiorReserva} ${maiorReserva === 1 ? 'reserva' : 'reservas'}`
          : `Coloca ${maiorReserva} ${maiorReserva === 1 ? 'reserva' : 'reservas'} (a maior quantidade) em todos os dias`
      }
      className={className}
    >
      Mesma reserva em todos os dias
    </BotaoTexto>
  )

  const adicionarDia = () => {
    const ordenados = [...f.dias].filter((d) => d.data).sort((a, b) => a.data.localeCompare(b.data))
    const ultimo = ordenados[ordenados.length - 1]
    const data = ultimo ? format(addDays(parseISO(ultimo.data), 1), 'yyyy-MM-dd') : hojeISO()
    // A reserva continua no dia seguinte; o uso dela, não
    set('dias', [
      ...f.dias,
      { id: novoId(), data, maquinas: ultimo?.maquinas ?? 1, reservas: ultimo?.reservas ?? 0, reservasUsadas: 0 },
    ])
  }

  const adicionarPeriodo = (de: string, ate: string, maquinas: number, reservas: number) => {
    const n = differenceInCalendarDays(parseISO(ate), parseISO(de))
    const existentes = new Set(f.dias.map((d) => d.data))
    const novos: DiaEvento[] = []
    for (let i = 0; i <= n; i++) {
      const data = format(addDays(parseISO(de), i), 'yyyy-MM-dd')
      if (!existentes.has(data)) novos.push({ id: novoId(), data, maquinas, reservas, reservasUsadas: 0 })
    }
    // Remove a linha inicial "vazia" (padrão de hoje com 1 máquina, sem reserva) se o usuário ainda não mexeu nela
    const base =
      !existente &&
      f.dias.length === 1 &&
      f.dias[0].maquinas === 1 &&
      reservasDia(f.dias[0]) === 0 &&
      !novos.some((x) => x.data === f.dias[0].data) &&
      f.dias[0].data === hojeISO()
        ? []
        : f.dias
    set(
      'dias',
      [...base, ...novos].sort((a, b) => a.data.localeCompare(b.data)),
    )
    toast.sucesso(`${novos.length} ${novos.length === 1 ? 'dia adicionado' : 'dias adicionados'}`)
  }

  // ---- Salvar -----------------------------------------------------------------
  const validar = useCallback((): Erros => {
    const e: Erros = {}
    if (!f.clienteId) e.cliente = 'Selecione o cliente.'
    if (!f.nome.trim()) e.nome = 'Informe o nome do evento.'
    if (!f.dias.length) e.dias = 'Adicione pelo menos um dia de utilização.'
    else if (f.dias.some((d) => !d.data)) e.dias = 'Preencha a data de todos os dias.'
    else if (datasRepetidas.size) e.dias = 'Existem datas repetidas.'
    else if (f.dias.some((d) => d.maquinas < 1)) e.dias = 'Cada dia precisa de pelo menos 1 máquina.'
    if (f.bobinasDevolvidas !== null && f.bobinasDevolvidas > f.bobinasConsignadas)
      e.bobinas = 'As devolvidas não podem passar das consignadas.'
    return e
  }, [f, datasRepetidas])

  const salvar = useCallback(async () => {
    if (salvando) return
    const e = validar()
    setErros(e)
    const primeiro = Object.values(e)[0]
    if (primeiro) {
      toast.erro('Revise o formulário', primeiro)
      return
    }
    // Máquina excluída por outra pessoa enquanto o formulário estava aberto: sai da lista
    const existentes = new Set(maquinas.map((m) => m.id))
    const maquinasIds = f.maquinasIds.filter((x) => existentes.has(x))
    // A reserva é sempre uma das máquinas enviadas
    const reservasIds = f.reservasIds.filter((x) => maquinasIds.includes(x))
    // Máquina em manutenção ou já em outro evento nas mesmas datas não pode ir: explica e não envia
    const trocas = trocasMaquinas({
      selecionadas: maquinasIds,
      maquinas,
      eventos,
      clientes,
      dias: f.dias,
      periodoCorrido: f.periodoCorrido,
      eventoId: id,
      salvo: existente,
      cancelado: f.status === 'CANCELADO',
      hoje,
    })
    const trocar = [...trocas.keys()]
    if (trocar.length) {
      const itens = ordenarMaquinas(maquinas.filter((m) => trocas.has(m.id))).map((m) => ({
        identificacao: m.identificacao,
        bloqueio: trocas.get(m.id)!,
      }))
      const varias = trocar.length > 1
      toast.erro(
        varias ? `Troque as ${trocar.length} máquinas indisponíveis` : 'Troque a máquina indisponível',
        `${resumoTrocas(itens)}. Desmarque e escolha ${varias ? 'outras' : 'outra'} em “Máquinas enviadas”.`,
      )
      irParaMaquinas()
      return
    }
    const dados = {
      ...f,
      nome: f.nome.trim(),
      // As usadas nunca passam das reservas do dia
      dias: f.dias.map((d) => ({ ...d, reservas: reservasDia(d), reservasUsadas: reservasUsadasDia(d) })),
      maquinasIds,
      reservasIds,
      dataPagamento: f.formaPagamento === 'NAO_PAGO' ? '' : f.dataPagamento || hojeISO(),
    }
    const statusAntes = existente?.status
    setSalvando('evento')
    try {
      const salvo = await salvarEvento(dados, id && versaoBase !== undefined ? { id, versao: versaoBase } : undefined)
      toast.sucesso(id ? 'Evento atualizado' : 'Evento cadastrado', `${codigoEvento(salvo.codigo)} • ${salvo.nome}`)
      // Evento novo: agora que ele existe, envia os arquivos escolhidos (um de cada vez)
      if (!id && pendentes.length) {
        setSalvando('arquivos')
        const falhas = await enviarPendentes(salvo.id, pendentes, enviarAnexo)
        if (falhas.length) {
          const um = falhas.length === 1
          toast.erro(
            um ? 'Um arquivo não foi anexado' : `${falhas.length} arquivos não foram anexados`,
            `${falhas.map((x) => `${x.nome}: ${x.motivo}`).join(' · ')}. O evento foi salvo; anexe ${um ? 'o arquivo' : 'os arquivos'} de novo nele.`,
          )
        } else {
          toast.sucesso(pendentes.length === 1 ? '1 arquivo anexado' : `${pendentes.length} arquivos anexados`)
        }
      }
      // Finalizado agora, com máquinas: o detalhe sugere registrar reclamação do cliente
      const finalizou = salvo.status === 'FINALIZADO' && statusAntes !== 'FINALIZADO' && salvo.maquinasIds.length > 0
      if (montado.current)
        navegar(`/eventos/${salvo.id}`, { replace: !!id, state: finalizou ? { sugerirReclamacao: true } : undefined })
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409 && !err.dados.atual) {
        // Recusa do servidor (ex.: máquina já em outro evento): mostra a mensagem e mantém o que foi digitado
        avisarErro('Não foi possível salvar o evento', err)
        if (err.dados.conflitos || /m[áa]quina/i.test(err.message)) irParaMaquinas()
      } else if (err instanceof ErroApi && err.status === 409) {
        const atual = err.dados.atual as Evento | undefined
        const manter = await confirmar({
          titulo: 'Evento alterado por outra pessoa',
          descricao:
            'Alguém salvou este evento enquanto você editava. Deseja manter as suas alterações por cima das dela? (Se não, recarregue o evento para ver a versão atual.)',
          confirmar: 'Manter as minhas',
        })
        if (manter && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em “Salvar evento” novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar o evento', err)
    } finally {
      setSalvando(false)
    }
  }, [
    salvando,
    validar,
    salvarEvento,
    f,
    id,
    versaoBase,
    navegar,
    maquinas,
    eventos,
    clientes,
    existente,
    hoje,
    pendentes,
    enviarAnexo,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void salvar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [salvar])

  if (id && !existente) {
    return (
      <EmptyState
        icone={<CalendarDays className="h-6 w-6" />}
        titulo="Evento não encontrado"
        descricao="Ele pode ter sido excluído."
        acao={<Button onClick={() => navegar('/eventos')}>Voltar para eventos</Button>}
      />
    )
  }

  return (
    <>
      <PageHeader
        voltar={
          <Link
            to={existente ? `/eventos/${existente.id}` : '/eventos'}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {existente ? 'Voltar ao evento' : 'Eventos'}
          </Link>
        }
        titulo={existente ? `Editar evento ${codigoEvento(existente.codigo)}` : 'Novo evento'}
        descricao="Preencha o evento, os dias de uso e as máquinas — o resumo é calculado automaticamente."
        acoes={
          <>
            <Button onClick={() => navegar(-1)}>Cancelar</Button>
            <Button variante="primary" icone={<Save className="h-4 w-4" />} onClick={salvar} disabled={!!salvando}>
              {textoSalvar(salvando)}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* 1. Cliente e evento (o nome e o rodapé são o texto programado nas fichas) */}
          <Card>
            <CardHeader
              icone={<Users className="h-4 w-4" />}
              titulo="Cliente e evento"
              descricao="Quem contratou e o que sai impresso nas fichas das máquinas."
            />
            {/* Cliente, nome e rodapé à esquerda; status e programação à direita (no celular, no fim) */}
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              <Field
                label="Cliente"
                htmlFor="ev-cliente"
                erro={erros.cliente}
                hint={!f.clienteId ? 'Sem cadastro? Escolha “Cliente avulso”, no fim da lista.' : contatoCliente || undefined}
                className="sm:col-span-2 sm:row-start-1"
              >
                <Combobox
                  id="ev-cliente"
                  opcoes={opcoesClientes}
                  valor={f.clienteId}
                  aoMudar={(v) => selecionarCliente({ id: v })}
                  placeholder="Selecione ou cadastre um cliente"
                  vazio="Nenhum cliente encontrado"
                  invalido={!!erros.cliente}
                  acoes={acoesCliente}
                />
              </Field>
              <Field
                label="Nome do evento"
                htmlFor="ev-nome"
                erro={erros.nome}
                hint="É o que sai no topo de cada ficha."
                className="sm:col-span-2 sm:row-start-2"
              >
                <Input
                  id="ev-nome"
                  value={f.nome}
                  onChange={(e) => {
                    set('nome', e.target.value)
                    setErros((x) => ({ ...x, nome: undefined }))
                  }}
                  placeholder="Ex.: Festa da Primavera"
                  maxLength={LIMITES.texto}
                  className={cn(erros.nome && 'border-danger!')}
                />
              </Field>
              <Field
                label="Rodapé das fichas"
                htmlFor="ev-rodape"
                hint="Sai no fim de cada ficha e também fecha o resumo em PDF."
                className="sm:col-span-2 sm:row-start-3"
                extra={
                  rodapePadrao &&
                  f.rodape.trim() !== rodapePadrao && (
                    <BotaoTexto
                      icone={<RotateCcw className="h-3.5 w-3.5" />}
                      onClick={() => set('rodape', config.rodapePadrao)}
                      title={`Volta para o rodapé padrão: “${rodapePadrao}”`}
                    >
                      Usar o padrão
                    </BotaoTexto>
                  )
                }
              >
                <Textarea
                  id="ev-rodape"
                  value={f.rodape}
                  onChange={(e) => set('rodape', e.target.value)}
                  placeholder={rodapePadrao || 'Ex.: AGRADECEMOS SUA PRESENÇA!'}
                  rows={linhasRodape}
                  maxLength={LIMITES.texto}
                  spellCheck={false}
                  className="min-h-0! font-mono text-[13px] leading-relaxed"
                />
              </Field>
              <Field label="Status" htmlFor="ev-status" className="sm:col-start-3 sm:row-start-1">
                <Select id="ev-status" value={f.status} onChange={(e) => set('status', e.target.value as StatusEvento)}>
                  {(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_EVENTO[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Programação"
                htmlFor="ev-programacao"
                hint={STATUS_PROGRAMACAO[f.programacao].descricao}
                className="sm:col-start-3 sm:row-start-2"
              >
                <SeletorProgramacao id="ev-programacao" valor={f.programacao} aoMudar={(v) => set('programacao', v)} />
              </Field>
            </div>
          </Card>

          {/* 2. Dias de utilização */}
          <Card>
            <CardHeader
              icone={<CalendarDays className="h-4 w-4" />}
              titulo="Dias de utilização"
              descricao={
                <>
                  Cada máquina em cada dia de uso conta como uma diária.{' '}
                  <span className="mt-1 block max-md:hidden">{explicacaoReserva}</span>
                </>
              }
              acoes={
                <div className="flex flex-col items-end gap-2">
                  <span className="tnum rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-ink">
                    {numero(resumo.totalDiarias)} {resumo.totalDiarias === 1 ? 'diária' : 'diárias'}
                  </span>
                  {mostrarMesmaReserva && botaoMesmaReserva('max-md:hidden')}
                </div>
              }
            />
            <div className="px-5 pb-5">
              {/* No celular a explicação vem na largura toda (ao lado do selo de diárias ficaria espremida) */}
              <p className="-mt-1 mb-3 text-[13px] text-muted md:hidden">{explicacaoReserva}</p>
              <div className="hidden grid-cols-[150px_104px_104px_minmax(0,1fr)_36px] gap-3 px-1 pb-2 text-xs font-medium text-muted md:grid">
                <span>Data</span>
                <span>Máquinas</span>
                <span>Reserva</span>
                <span>Disponibilidade</span>
                <span />
              </div>
              <motion.div layout className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {f.dias.map((d) => {
                    const livres = livresEm(d.data)
                    // Titulares + reservas: a reserva também sai da empresa. Com período corrido, o
                    // cliente fica com a maior quantidade em todos os dias
                    const total = totalDia(d)
                    const reservas = reservasDia(d)
                    const fora = qtdOcupada.get(d.data) ?? total
                    const excede = fora > livres
                    const repetida = datasRepetidas.has(d.data)
                    // Explica a conta no balão: a reserva, a maior quantidade (período corrido) e as em manutenção
                    const manut = emManutencao(d.data)
                    const nota = [
                      reservas > 0 &&
                        `Contam ${quantidadeCurta(d.maquinas, reservas)}: a reserva também sai da empresa, mesmo sem uso.`,
                      f.periodoCorrido &&
                        fora !== total &&
                        `As máquinas ficam com o cliente entre os dias de uso: neste dia contam as ${fora} do evento.`,
                      manut > 0 && `${manut} em manutenção não ${manut > 1 ? 'entram' : 'entra'} na conta.`,
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <motion.div
                        key={d.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {/* No celular: data e lixeira; máquinas e reserva lado a lado; uso da reserva; disponibilidade */}
                        <div
                          className={cn(
                            'grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-2',
                            'md:grid-cols-[150px_104px_104px_minmax(0,1fr)_36px] md:gap-x-3 md:border-0 md:bg-transparent md:p-0',
                            reservas > 0 && 'md:pb-1',
                          )}
                        >
                          <div className="relative order-1 md:order-none">
                            <Input
                              type="date"
                              value={d.data}
                              onChange={(e) => atualizarDia(d.id, { data: e.target.value })}
                              className={cn('tnum pr-3', repetida && 'border-danger!')}
                              aria-label="Data"
                            />
                          </div>
                          <div className="order-3 col-span-2 grid grid-cols-2 gap-2 md:order-none md:col-span-1 md:contents">
                            <div className="min-w-0">
                              <span aria-hidden className="mb-1 block text-[11px] font-medium text-muted md:hidden">
                                Máquinas
                              </span>
                              <NumberInput
                                valor={d.maquinas}
                                min={1}
                                max={999}
                                aoMudar={(v) => atualizarDia(d.id, { maquinas: v ?? 1 })}
                                aria-label="Máquinas"
                              />
                            </div>
                            <div className="min-w-0">
                              <span aria-hidden className="mb-1 block text-[11px] font-medium text-muted md:hidden">
                                Reserva
                              </span>
                              <NumberInput
                                valor={reservas}
                                min={0}
                                max={99}
                                aoMudar={(v) => atualizarDia(d.id, { reservas: v ?? 0 })}
                                aria-label="Reservas"
                                className={cn(reservas > 0 && 'border-warning-dot/70!')}
                              />
                            </div>
                          </div>
                          <div className="order-5 col-span-2 flex min-w-0 items-center gap-2 text-xs md:order-none md:col-span-1">
                            {d.data && (
                              <>
                                {/* "Dom, 15 nov": curto para caber ao lado das livres */}
                                <span className="min-w-0 truncate text-muted">{dataExtensa(d.data, 'EEEEEE, d MMM')}</span>
                                <span className="text-line-strong">•</span>
                                {repetida ? (
                                  <span className="shrink-0 font-medium whitespace-nowrap text-danger">Data repetida</span>
                                ) : excede ? (
                                  <span
                                    className="inline-flex shrink-0 items-center gap-1 font-medium whitespace-nowrap text-warning"
                                    title={nota || undefined}
                                  >
                                    <TriangleAlert className="h-3.5 w-3.5" />
                                    {livres <= 0 ? 'Sem máquinas livres' : `Só ${livres} ${livres > 1 ? 'livres' : 'livre'}`}
                                  </span>
                                ) : (
                                  <span className="tnum shrink-0 whitespace-nowrap text-muted" title={nota || undefined}>
                                    {livres - fora} de {totalMaquinas} livres
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          <Button
                            variante="ghost"
                            tamanho="icon-sm"
                            aria-label="Remover dia"
                            onClick={() =>
                              set(
                                'dias',
                                f.dias.filter((x) => x.id !== d.id),
                              )
                            }
                            className="order-2 hover:bg-danger-soft hover:text-danger md:order-none"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {/* Uso da reserva no dia: só é cobrada se o cliente usar */}
                          {reservas > 0 && (
                            <div className="order-4 col-span-2 min-w-0 md:order-none md:col-span-3 md:col-start-3">
                              <UsoReserva
                                data={d.data}
                                reservas={reservas}
                                usadas={reservasUsadasDia(d)}
                                aoMudar={(n) => atualizarDia(d.id, { reservasUsadas: n })}
                              />
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </motion.div>
              {erros.dias && <p className="mt-2 text-xs font-medium text-danger">{erros.dias}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variante="soft" tamanho="sm" icone={<Plus className="h-4 w-4" />} onClick={adicionarDia}>
                  Adicionar dia
                </Button>
                <Button tamanho="sm" icone={<CalendarRange className="h-4 w-4" />} onClick={() => setPeriodoModal(true)}>
                  Adicionar período
                </Button>
                {mostrarMesmaReserva && botaoMesmaReserva('md:hidden')}
              </div>

              {/* As máquinas ficam com o cliente entre os dias de uso: só faz sentido com dias soltos */}
              <AnimatePresence initial={false}>
                {(temIntervalo || f.periodoCorrido) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <PeriodoCorrido
                      ligado={f.periodoCorrido}
                      aoMudar={(v) => set('periodoCorrido', v)}
                      temIntervalo={temIntervalo}
                      ocupados={ocupados}
                      diasDeUso={datasUso.length}
                      faltas={faltasNoMeio.map((d) => ({ data: d.data, livres: livresEm(d.data), precisa: totalDia(d) }))}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>

          {/* 3. Máquinas enviadas */}
          <SeletorMaquinas
            id="maquinas-enviadas"
            maquinasIds={f.maquinasIds}
            aoMudar={(ids) => set('maquinasIds', ids)}
            reservasIds={f.reservasIds}
            aoMudarReservas={(ids) => set('reservasIds', ids)}
            dias={f.dias}
            periodoCorrido={f.periodoCorrido}
            eventoId={id}
            cancelado={f.status === 'CANCELADO'}
          />

          {/* 4. Valores e bobinas */}
          <Card>
            <CardHeader
              icone={<Package className="h-4 w-4" />}
              titulo="Valores e bobinas"
              descricao="Bobinas utilizadas = consignadas − devolvidas."
              acoes={<ConferenciaBadge status={resumo.conferencia} />}
            />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Valor da diária" htmlFor="ev-vd">
                <CurrencyInput id="ev-vd" valor={f.valorDiaria} aoMudar={(v) => set('valorDiaria', v)} />
              </Field>
              <Field label="Valor de cada bobina" htmlFor="ev-vb">
                <CurrencyInput id="ev-vb" valor={f.valorBobina} aoMudar={(v) => set('valorBobina', v)} />
              </Field>
              <Field label="Desconto" htmlFor="ev-desc" hint="Opcional">
                <CurrencyInput id="ev-desc" valor={f.desconto} aoMudar={(v) => set('desconto', v)} />
              </Field>
              <Field label="Bobinas consignadas" htmlFor="ev-bc" hint="Entregues ao cliente">
                <NumberInput
                  id="ev-bc"
                  valor={f.bobinasConsignadas}
                  aoMudar={(v) => {
                    set('bobinasConsignadas', v ?? 0)
                    setErros((x) => ({ ...x, bobinas: undefined }))
                  }}
                />
              </Field>
              <Field
                label="Bobinas devolvidas"
                htmlFor="ev-bd"
                hint={erros.bobinas ? undefined : 'Deixe vazio até a conferência'}
                erro={erros.bobinas}
              >
                <NumberInput
                  id="ev-bd"
                  valor={f.bobinasDevolvidas}
                  permitirVazio
                  max={f.bobinasConsignadas}
                  placeholder="Aguardando"
                  aoMudar={(v) => {
                    set('bobinasDevolvidas', v)
                    setErros((x) => ({ ...x, bobinas: undefined }))
                  }}
                />
              </Field>
              <div className="flex flex-col justify-center rounded-xl bg-surface-2 px-4 py-3">
                <p className="text-xs text-muted">Bobinas utilizadas</p>
                <p className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {resumo.bobinasUtilizadas === null ? '—' : numero(resumo.bobinasUtilizadas)}
                </p>
              </div>
            </div>
          </Card>

          {/* 5. Pagamento */}
          <Card>
            <CardHeader icone={<Wallet className="h-4 w-4" />} titulo="Pagamento e observações" />
            <div className="flex flex-col gap-4 px-5 pb-5">
              <Field label="Forma de pagamento">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {ORDEM_PAGAMENTO.map((fp) => {
                    const ativo = f.formaPagamento === fp
                    return (
                      <button
                        key={fp}
                        type="button"
                        onClick={() => set('formaPagamento', fp)}
                        aria-pressed={ativo}
                        className={cn(
                          'relative flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition-[border-color,background-color,color,box-shadow] duration-150',
                          ativo
                            ? fp === 'NAO_PAGO'
                              ? 'border-warning-dot/60 bg-warning-soft text-warning'
                              : 'border-brand/60 bg-brand-soft text-brand-ink ring-4 ring-[var(--ring)]/40'
                            : 'border-line-strong/80 bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        {ICONES_PAGAMENTO[fp]}
                        {FORMAS_PAGAMENTO[fp].label}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <AnimatePresence initial={false}>
                {f.formaPagamento !== 'NAO_PAGO' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Field
                      label="Data do pagamento"
                      htmlFor="ev-dp"
                      className="sm:w-60"
                      hint="Se vazio, será usada a data de hoje."
                    >
                      <Input
                        id="ev-dp"
                        type="date"
                        value={f.dataPagamento}
                        onChange={(e) => set('dataPagamento', e.target.value)}
                      />
                    </Field>
                  </motion.div>
                )}
              </AnimatePresence>
              <Field label="Observações" htmlFor="ev-obs" hint="Aparecem no resumo em PDF entregue ao cliente.">
                <Textarea
                  id="ev-obs"
                  value={f.observacoes}
                  onChange={(e) => set('observacoes', e.target.value)}
                  placeholder="Ex.: entregar as máquinas às 18h"
                  className="min-h-0!"
                  rows={2}
                />
              </Field>
            </div>
          </Card>

          {/* 6. Arquivos (prints da conversa, logo, cardápio…). Num evento novo, vão depois de salvar */}
          <AnexosEvento eventoId={id} pendentes={pendentes} aoMudarPendentes={setPendentes} id="anexos" />
        </div>

        {/* Resumo financeiro (fixo ao rolar) */}
        <div className="xl:sticky xl:top-6">
          <Card className="overflow-hidden">
            <div className="relative overflow-hidden bg-brand px-5 pt-5 pb-6 text-white">
              <div className="pointer-events-none absolute -top-20 -right-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
              <p className="relative text-[13px] font-medium text-white/85">Total final</p>
              <p className="relative mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em]">
                <AnimatedNumber valor={resumo.total} formatar={moeda} />
              </p>
              <p className="relative mt-2 truncate text-[13px] text-white/80">
                {cliente ? cliente.nome : 'Nenhum cliente selecionado'}
              </p>
            </div>
            <dl className="divide-y divide-line px-5 text-sm">
              <Linha
                rotulo="Total de diárias"
                valor={numero(resumo.totalDiarias)}
                sub={
                  resumo.diariasReserva > 0
                    ? `inclui ${numero(resumo.diariasReserva)} de ${resumo.diariasReserva === 1 ? 'reserva usada' : 'reservas usadas'}`
                    : undefined
                }
              />
              <Linha
                rotulo="Valor das diárias"
                valor={moeda(resumo.valorDiarias)}
                sub={`${numero(resumo.totalDiarias)} × ${moeda(f.valorDiaria)}`}
              />
              {/* A reserva parada fica com o cliente, mas não é cobrada */}
              {reservasSemUso > 0 && (
                <Linha
                  discreta
                  rotulo="Reserva sem uso"
                  valor="Sem custo"
                  sub={
                    reservasSemUso === 1
                      ? '1 reserva parada com o cliente'
                      : `${numero(reservasSemUso)} reservas paradas, somando os dias`
                  }
                />
              )}
              <Linha
                rotulo="Bobinas utilizadas"
                valor={resumo.bobinasUtilizadas === null ? 'A conferir' : numero(resumo.bobinasUtilizadas)}
              />
              <Linha
                rotulo="Valor das bobinas"
                valor={moeda(resumo.valorBobinas)}
                sub={
                  resumo.bobinasUtilizadas === null
                    ? 'Cobrado após a devolução'
                    : `${numero(resumo.bobinasUtilizadas)} × ${moeda(f.valorBobina)}`
                }
              />
              {resumo.desconto > 0 && <Linha rotulo="Desconto" valor={`− ${moeda(resumo.desconto)}`} />}
            </dl>
            <div className="border-t border-line p-5">
              <Button
                variante="primary"
                className="w-full"
                icone={<Save className="h-4 w-4" />}
                onClick={salvar}
                disabled={!!salvando}
              >
                {textoSalvar(salvando)}
              </Button>
              <p className="mt-2.5 text-center text-xs text-muted">
                Atalho: <kbd className="rounded border border-line bg-surface-2 px-1">Ctrl</kbd> +{' '}
                <kbd className="rounded border border-line bg-surface-2 px-1">S</kbd>
              </p>
            </div>
          </Card>
        </div>
      </div>

      <ClienteFormModal
        aberto={clienteModal.aberto}
        nomeInicial={clienteModal.nome}
        tipoInicial={clienteModal.tipo}
        aoFechar={() => setClienteModal({ aberto: false })}
        aoSalvar={selecionarCliente}
      />
      <PeriodoModal aberto={periodoModal} aoFechar={() => setPeriodoModal(false)} aoConfirmar={adicionarPeriodo} />
    </>
  )
}

const textoSalvar = (etapa: false | 'evento' | 'arquivos') =>
  etapa === 'arquivos' ? 'Enviando arquivos…' : etapa ? 'Salvando…' : 'Salvar evento'

/** Botão pequeno e discreto ao lado do rótulo de um campo. */
function BotaoTexto({
  icone,
  children,
  className,
  ...props
}: { icone: ReactNode; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        '-my-1 inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap text-brand-ink transition-colors hover:bg-brand-soft',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    >
      {icone}
      {children}
    </button>
  )
}

/** "03/10" a partir de "2026-10-03". */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/**
 * Opção "as máquinas ficam com o cliente entre os dias de uso" (período corrido): o período em que
 * elas ficam ocupadas e o aviso dos dias do meio sem máquinas livres suficientes.
 */
function PeriodoCorrido({
  ligado,
  aoMudar,
  temIntervalo,
  ocupados,
  diasDeUso,
  faltas,
}: {
  ligado: boolean
  aoMudar: (v: boolean) => void
  /** Há dias sem uso entre o primeiro e o último. */
  temIntervalo: boolean
  ocupados: DiaOcupado[]
  diasDeUso: number
  /** Dias do meio em que faltam máquinas livres. */
  faltas: Array<{ data: string; livres: number; precisa: number }>
}) {
  const inicio = ocupados[0]?.data
  const fim = ocupados[ocupados.length - 1]?.data
  const pior = Math.min(...faltas.map((x) => x.livres))
  const precisa = Math.max(0, ...faltas.map((x) => x.precisa))
  return (
    <div
      className={cn(
        'mt-4 rounded-xl border p-3.5 transition-colors duration-200',
        ligado ? 'border-brand/35 bg-brand-soft/50' : 'border-line bg-surface-2/50',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 max-sm:hidden',
            ligado ? 'bg-brand text-white' : 'bg-surface text-ink-2 ring-1 ring-line',
          )}
        >
          <MoveHorizontal className="h-4 w-4" />
        </div>
        <label htmlFor="ev-periodo-corrido" className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-[13px] font-semibold text-ink">As máquinas ficam com o cliente entre os dias de uso</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            Para quem usa só em alguns dias (ex.: nos fins de semana do mês) e não devolve as máquinas no meio da semana. Elas
            contam como ocupadas o período todo, na agenda e na escolha das máquinas.
          </span>
        </label>
        <Interruptor id="ev-periodo-corrido" ligado={ligado} aoMudar={aoMudar} />
      </div>
      <AnimatePresence initial={false}>
        {ligado && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pt-3 sm:pl-11">
              {temIntervalo && inicio && fim ? (
                <p className="tnum rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-2 ring-1 ring-line">
                  Ocupadas de <b className="font-semibold text-ink">{diaMes(inicio)}</b> a{' '}
                  <b className="font-semibold text-ink">{diaMes(fim)}</b>, {ocupados.length} dias; as diárias continuam só{' '}
                  {diasDeUso === 1 ? 'no dia de uso' : `nos ${diasDeUso} dias de uso`}.
                </p>
              ) : (
                <p className="text-xs text-muted">
                  Os dias de uso já são seguidos: não há dias entre eles para as máquinas ficarem com o cliente.
                </p>
              )}
              {faltas.length > 0 && (
                <p className="tnum flex items-start gap-1.5 text-xs font-medium text-warning">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    Faltam máquinas em {listaDatas(faltas.map((x) => x.data))}, entre os dias de uso:{' '}
                    {pior <= 0 ? 'nenhuma livre' : `só ${pior} ${pior === 1 ? 'livre' : 'livres'}`}
                    {faltas.length > 1 ? ' no pior dia' : ''} para as {precisa} deste evento.
                  </span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Chave liga/desliga (o rótulo fica fora, ligado pelo `id`). */
function Interruptor({ id, ligado, aoMudar }: { id: string; ligado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => aoMudar(!ligado)}
      className={cn(
        'relative mt-1 inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200',
        'focus-visible:ring-4 focus-visible:ring-[var(--ring)] focus-visible:outline-none',
        ligado ? 'justify-end bg-brand' : 'justify-start bg-surface-3 ring-1 ring-line-strong ring-inset',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className="h-5 w-5 rounded-full bg-white shadow-xs"
      />
    </button>
  )
}

function Linha({ rotulo, valor, sub, discreta }: { rotulo: string; valor: string; sub?: string; discreta?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', discreta ? 'py-2.5' : 'py-3')}>
      <div>
        <dt className={discreta ? 'text-[13px] text-muted' : 'text-ink-2'}>{rotulo}</dt>
        {sub && <p className="tnum mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      <dd className={cn('tnum whitespace-nowrap', discreta ? 'text-[13px] font-medium text-muted' : 'font-semibold text-ink')}>
        {valor}
      </dd>
    </div>
  )
}

/**
 * Uso da reserva no dia: com 1 reserva, um botão "Usou a reserva" (liga/desliga); com mais, quantas
 * foram usadas. A usada é cobrada pelo mesmo valor da diária; a parada não custa nada.
 */
function UsoReserva({
  data,
  reservas,
  usadas,
  aoMudar,
}: {
  data: string
  reservas: number
  usadas: number
  aoMudar: (n: number) => void
}) {
  // O nome para o leitor de tela começa pelo texto visível e diz o dia
  const dia = data ? ` em ${data.slice(8, 10)}/${data.slice(5, 7)}` : ''
  const cobradas = Math.min(usadas, reservas)
  const nota = cobradas
    ? `+${cobradas} ${cobradas === 1 ? 'diária cobrada' : 'diárias cobradas'}`
    : reservas === 1
      ? 'Parada: sem custo'
      : 'Paradas: sem custo'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted max-md:hidden" />
      {reservas === 1 ? (
        <button
          type="button"
          aria-pressed={cobradas > 0}
          aria-label={`Usou a reserva${dia}`}
          onClick={() => aoMudar(cobradas ? 0 : 1)}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
            'focus-visible:ring-4 focus-visible:ring-[var(--ring)] focus-visible:outline-none',
            cobradas
              ? 'border-warning-dot bg-warning-soft text-warning'
              : 'border-line-strong/80 bg-surface text-ink-2 shadow-xs hover:border-line-strong hover:bg-surface-2',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
              cobradas ? 'border-warning bg-warning text-surface' : 'border-line-strong bg-surface',
            )}
          >
            {cobradas > 0 && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          Usou a reserva
        </button>
      ) : (
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-2">
          Usadas
          <NumberInput
            valor={cobradas}
            min={0}
            max={reservas}
            aoMudar={(v) => aoMudar(v ?? 0)}
            aria-label={`Reservas usadas${dia}`}
            className={cn('h-8! w-[104px]', cobradas > 0 && 'border-warning-dot!')}
          />
          <span className="tnum font-normal text-muted">de {reservas}</span>
        </span>
      )}
      <span className={cn('tnum text-xs', cobradas ? 'font-medium text-warning' : 'text-muted')}>{nota}</span>
    </div>
  )
}

function PeriodoModal({
  aberto,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean
  aoFechar: () => void
  aoConfirmar: (de: string, ate: string, maquinas: number, reservas: number) => void
}) {
  const [de, setDe] = useState(hojeISO)
  const [ate, setAte] = useState(() => format(addDays(new Date(), 2), 'yyyy-MM-dd'))
  const [maq, setMaq] = useState(1)
  const [res, setRes] = useState(0)
  const dias = de && ate ? differenceInCalendarDays(parseISO(ate), parseISO(de)) + 1 : 0
  const valido = dias >= 1 && dias <= 120
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<CalendarRange className="h-5 w-5" />}
      titulo="Adicionar período"
      descricao="Cria um dia para cada data do intervalo, com as mesmas quantidades de máquinas e de reservas."
      largura="max-w-md"
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button
            variante="primary"
            disabled={!valido}
            onClick={() => {
              aoConfirmar(de, ate, maq, res)
              aoFechar()
            }}
          >
            Adicionar {valido ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="De" htmlFor="per-de">
          <Input id="per-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="per-ate">
          <Input id="per-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Field>
        {(dias > 120 || dias < 1) && (
          <p className="col-span-2 -mt-2 text-xs font-medium text-danger">
            {dias > 120 ? 'Período máximo de 120 dias.' : 'A data final deve ser depois da inicial.'}
          </p>
        )}
        <Field label="Máquinas por dia" htmlFor="per-maq">
          <NumberInput id="per-maq" valor={maq} min={1} aoMudar={(v) => setMaq(v ?? 1)} />
        </Field>
        <Field label="Reservas por dia" htmlFor="per-res" hint="Sem custo, se não usar.">
          <NumberInput id="per-res" valor={res} min={0} max={99} aoMudar={(v) => setRes(v ?? 0)} />
        </Field>
      </div>
    </Modal>
  )
}
