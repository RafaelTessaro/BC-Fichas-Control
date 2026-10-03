// Aba Contratos: todos os contratos de locação gerados nos eventos, para baixar, enviar ao cliente,
// guardar a cópia assinada e acompanhar quais ainda esperam a assinatura.

import {
  Ellipsis,
  Eye,
  FileDown,
  FilePenLine,
  Info,
  Landmark,
  LoaderCircle,
  Mail,
  MessageCircle,
  Paperclip,
  Printer,
  Send,
  Ticket,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { codigoContrato } from '#shared/contrato.ts'
import type { Cliente, Contrato, Evento } from '#shared/tipos.ts'
import { useAcoesContrato } from '../components/contrato/AcoesContrato'
import { StatusContratoBadge } from '../components/contrato/StatusContrato'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState, Menu, PageHeader, SearchInput, Segmented } from '../components/ui/Misc'
import { Linha, Tabela, Td, Th } from '../components/ui/Table'
import { cn } from '../lib/cn'
import {
  contratoCombina,
  dataHoraCurta,
  filtroInicial,
  juntarLista,
  maquinasDoContrato,
  mudancasDoContrato,
  nomeClienteContrato,
  type FiltroContratos,
} from '../lib/contratos'
import { datasDoEvento } from '../lib/envio'
import { codigoEvento, dataCurta } from '../lib/format'
import { useHoje } from '../lib/hoje'
import { useDados } from '../store/dados'

/** Contrato com o evento e o cliente de agora (o evento pode ter sido excluído). */
interface Item {
  contrato: Contrato
  evento: Evento | undefined
  cliente: Cliente | undefined
  /** O que mudou no aluguel depois do contrato (vazio se nada ou se não vale mais). */
  mudancas: string[]
}

const FILTROS: Array<{ valor: FiltroContratos; curto: string; longo: string }> = [
  { valor: 'AGUARDANDO', curto: 'Esperando', longo: 'Esperando assinatura' },
  { valor: 'ASSINADO', curto: 'Assinados', longo: 'Assinados' },
  { valor: 'CANCELADO', curto: 'Cancelados', longo: 'Cancelados' },
  { valor: 'TODOS', curto: 'Todos', longo: 'Todos' },
]

const nomeCliente = ({ contrato: c, cliente }: Item) => nomeClienteContrato(c, cliente ? [cliente] : [])

const datasDeUso = (c: Contrato) => datasDoEvento([...new Set(c.dados.evento.dias.map((d) => d.data).filter(Boolean))])

export function Contratos() {
  const contratos = useDados((s) => s.contratos)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const acoes = useAcoesContrato()
  const navegar = useNavigate()
  const hoje = useHoje()
  const [params, setParams] = useSearchParams()
  const [filtro, setFiltro] = useState<FiltroContratos>(() => filtroInicial(contratos))
  const [busca, setBusca] = useState('')

  // Vindo da busca global (?contrato=id): mostra o contrato, com um destaque passageiro
  const pedido = params.get('contrato')
  const [pedidoAntes, setPedidoAntes] = useState<string | null>(null)
  const [realce, setRealce] = useState<string | null>(null)
  if (pedido !== pedidoAntes) {
    setPedidoAntes(pedido)
    const c = pedido ? contratos.find((x) => x.id === pedido) : undefined
    if (c) {
      setFiltro(c.status)
      setBusca('')
      setRealce(c.id)
    }
  }
  useEffect(() => {
    if (!realce) return
    const rolar = setTimeout(() => {
      const alvo = [...document.querySelectorAll<HTMLElement>(`[data-contrato="${realce}"]`)].find((el) => el.offsetParent)
      alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    const apagar = setTimeout(() => {
      setRealce(null)
      setParams(
        (p) => {
          p.delete('contrato')
          return p
        },
        { replace: true },
      )
    }, 2600)
    return () => {
      clearTimeout(rolar)
      clearTimeout(apagar)
    }
  }, [realce, setParams])

  const itens = useMemo<Item[]>(() => {
    const porEvento = new Map(eventos.map((e) => [e.id, e]))
    const porCliente = new Map(clientes.map((c) => [c.id, c]))
    return contratos.map((contrato) => {
      const evento = porEvento.get(contrato.eventoId)
      // O cliente do contrato; para ver o que mudou, o cliente que o evento tem agora
      const cliente = porCliente.get(contrato.clienteId)
      const atual = evento ? porCliente.get(evento.clienteId) : undefined
      return { contrato, evento, cliente, mudancas: mudancasDoContrato(contrato, { evento, cliente: atual, maquinas, config }) }
    })
  }, [contratos, eventos, clientes, maquinas, config])

  const encontrados = useMemo(
    () => itens.filter((it) => contratoCombina(it.contrato, busca, `${it.cliente?.nome ?? ''} ${it.evento?.nome ?? ''}`)),
    [itens, busca],
  )
  const contagem = useMemo(() => {
    const n: Record<FiltroContratos, number> = { AGUARDANDO: 0, ASSINADO: 0, CANCELADO: 0, TODOS: encontrados.length }
    for (const it of encontrados) n[it.contrato.status]++
    return n
  }, [encontrados])
  const lista = encontrados.filter((it) => filtro === 'TODOS' || it.contrato.status === filtro)

  /** Detalhe da situação: a retirada (esperando), a data da assinatura ou o motivo do cancelamento. */
  const detalhe = ({ contrato: c }: Item): ReactNode => {
    if (c.status === 'AGUARDANDO') {
      const r = c.dados.retirada
      if (!r.data) return null
      if (r.data < hoje) return <span className="text-warning">Retirada já passou ({dataCurta(r.data)})</span>
      return `Retirada ${r.data === hoje ? 'hoje' : dataHoraCurta(r)}`
    }
    if (c.status === 'ASSINADO') {
      return (
        <span className="inline-flex items-center gap-1">
          {c.assinadoEm ? `Em ${dataCurta(c.assinadoEm)}` : 'Assinado'}
          {c.arquivo ? (
            <span className="inline-flex items-center gap-0.5" title={`Cópia assinada: ${c.arquivo.nome}`}>
              {' '}
              • <Paperclip className="h-3 w-3" /> cópia
            </span>
          ) : (
            ' • sem cópia'
          )}
        </span>
      )
    }
    // "nº 0005" não se separa na quebra de linha
    return c.motivoCancelamento.replace(/\.$/, '').replace(/nº /g, 'nº\u00a0')
  }

  const vazioTotal = !contratos.length

  return (
    <>
      <PageHeader
        titulo="Contratos"
        descricao="Contratos de locação gerados nos eventos: baixe, envie ao cliente e guarde a cópia assinada."
      />

      {vazioTotal ? (
        <Card>
          <EmptyState
            icone={<FilePenLine className="h-6 w-6" />}
            titulo="Nenhum contrato gerado ainda"
            descricao="O contrato é gerado no evento: abra o evento e use “Gerar contrato”, no cartão Contrato de locação. Ele sai em PDF para o cliente ler antes e assinar na retirada (ou pelo gov.br)."
            acao={
              <Button variante="primary" icone={<Ticket className="h-4 w-4" />} onClick={() => navegar('/eventos')}>
                Ir para Eventos
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <Segmented
              valor={filtro}
              aoMudar={setFiltro}
              // No celular, as quatro opções em duas linhas (numa só, não caberiam)
              className="self-start max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:[&>button]:justify-center"
              opcoes={FILTROS.map((f) => ({
                valor: f.valor,
                contagem: contagem[f.valor],
                label: (
                  <>
                    <span className="sm:hidden">{f.curto}</span>
                    <span className="max-sm:hidden">{f.longo}</span>
                  </>
                ),
              }))}
            />
            <SearchInput valor={busca} aoMudar={setBusca} placeholder="Buscar nº, cliente ou evento…" className="xl:w-80" />
          </div>

          <Card className="overflow-hidden">
            {lista.length === 0 ? (
              <EmptyState
                icone={<FilePenLine className="h-6 w-6" />}
                titulo={
                  busca
                    ? 'Nenhum contrato encontrado'
                    : filtro === 'AGUARDANDO'
                      ? 'Nenhum contrato esperando assinatura'
                      : filtro === 'ASSINADO'
                        ? 'Nenhum contrato assinado'
                        : 'Nenhum contrato cancelado'
                }
                descricao={
                  busca
                    ? 'Busque pelo número do contrato, pelo nome do cliente ou do evento.'
                    : filtro === 'AGUARDANDO'
                      ? 'Todos os contratos gerados já foram assinados ou cancelados.'
                      : 'Para gerar um contrato, abra o evento e use “Gerar contrato”.'
                }
                acao={filtro !== 'TODOS' && <Button onClick={() => setFiltro('TODOS')}>Ver todos os contratos</Button>}
              />
            ) : (
              <>
                {/* Celular e tela estreita: um cartão por contrato (sem rolagem para o lado) */}
                <ul className="divide-y divide-line md:hidden">
                  {lista.map((it) => (
                    <ItemCelular
                      key={it.contrato.id}
                      item={it}
                      detalhe={detalhe(it)}
                      realce={realce === it.contrato.id}
                      acoes={acoes}
                    />
                  ))}
                </ul>
                {/* Abaixo de 1280 px o evento e as datas vão para baixo do cliente */}
                <Tabela className="max-md:hidden">
                  <thead>
                    <tr>
                      <Th className="w-28">Contrato</Th>
                      <Th>Cliente</Th>
                      <Th className="max-xl:hidden">Evento e datas de uso</Th>
                      <Th>Situação</Th>
                      <Th className="w-0">
                        <span className="sr-only">Ações</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((it, i) => (
                      <LinhaContrato
                        key={it.contrato.id}
                        item={it}
                        indice={i}
                        detalhe={detalhe(it)}
                        realce={realce === it.contrato.id}
                        acoes={acoes}
                      />
                    ))}
                  </tbody>
                </Tabela>
              </>
            )}
          </Card>
          {lista.length > 0 && (
            <p className="mt-2 px-1 text-xs text-muted">
              {lista.length} {lista.length === 1 ? 'contrato' : 'contratos'}
              {lista.length < contratos.length && ` de ${contratos.length}`}, do mais novo para o mais antigo.
            </p>
          )}
        </>
      )}

      <ComoAssinar />
      {acoes.janelas}
    </>
  )
}

type Acoes = ReturnType<typeof useAcoesContrato>

/** Nome do evento (link para ele; "evento excluído" se não existe mais). */
function NomeEvento({ item: { contrato: c, evento }, className }: { item: Item; className?: string }) {
  if (!evento) {
    return (
      <span className={cn('text-ink-2', className)}>
        {c.dados.evento.nome} <span className="font-normal text-muted">(evento excluído)</span>
      </span>
    )
  }
  return (
    <Link
      to={`/eventos/${evento.id}`}
      className={cn('font-medium text-ink hover:text-brand-ink hover:underline', className)}
      title={`Abrir o evento ${evento.nome} (${codigoEvento(evento.codigo)})`}
    >
      {evento.nome}
    </Link>
  )
}

/** Datas de uso e máquinas: "8 dias, de 10/10 a 01/11/2026 • 3+1 máquinas". */
function DatasDeUso({ contrato: c }: { contrato: Contrato }) {
  const maq = maquinasDoContrato(c.dados)
  return (
    <>
      {datasDeUso(c) || 'sem datas'}{' '}
      <span title={maq.extenso} className="whitespace-nowrap">
        • {maq.curto} {maq.curto === '1' ? 'máquina' : 'máquinas'}
      </span>
    </>
  )
}

function AvisoMudou({ mudancas, className }: { mudancas: string[]; className?: string }) {
  if (!mudancas.length) return null
  return (
    <p
      className={cn('flex items-start gap-1 text-xs text-warning', className)}
      title={`O aluguel mudou depois do contrato: ${juntarLista(mudancas)}. Gere um novo para o cliente assinar.`}
    >
      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>Aluguel mudou depois</span>
    </p>
  )
}

/**
 * Botões de ação da linha (baixar, enviar, anexar/ver) e o menu "…" com todas. Em tela estreita
 * (ou `compacto`) ficam só o PDF e o menu.
 */
function BotoesLinha({ contrato: c, acoes, compacto }: { contrato: Contrato; acoes: Acoes; compacto?: boolean }) {
  const ativo = c.status !== 'CANCELADO'
  const baixando = acoes.baixando === c.id
  const extra = 'max-xl:hidden'
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variante="ghost"
        tamanho="icon-sm"
        onClick={() => void acoes.baixarPdf(c)}
        disabled={baixando}
        aria-label={`Baixar o PDF do contrato ${codigoContrato(c.numero)}`}
        title="Baixar PDF"
      >
        {baixando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      </Button>
      {!compacto && ativo && acoes.temEvento(c) && (
        <span className={cn('inline-flex', extra)}>
          <Menu
            gatilho={(abrir) => (
              <Button variante="ghost" tamanho="icon-sm" onClick={abrir} aria-label="Enviar ao cliente" title="Enviar ao cliente">
                <Send className="h-4 w-4" />
              </Button>
            )}
            itens={[
              {
                label: 'Por WhatsApp',
                icone: <MessageCircle className="h-4 w-4" />,
                aoClicar: () => acoes.abrir('enviar', c, { canal: 'whatsapp' }),
              },
              {
                label: 'Por e-mail',
                icone: <Mail className="h-4 w-4" />,
                aoClicar: () => acoes.abrir('enviar', c, { canal: 'email' }),
              },
            ]}
          />
        </span>
      )}
      {compacto ? null : c.arquivo ? (
        <Button
          variante="ghost"
          tamanho="icon-sm"
          onClick={() => acoes.verAssinado(c)}
          aria-label="Ver assinado"
          title="Ver assinado"
          className={extra}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ) : (
        ativo && (
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={() => acoes.abrir('anexar', c)}
            aria-label="Anexar assinado"
            title="Anexar assinado (foto ou PDF)"
            className={extra}
          >
            <Upload className="h-4 w-4" />
          </Button>
        )
      )}
      <Menu
        gatilho={(abrir) => (
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={abrir}
            aria-label={`Ações do contrato ${codigoContrato(c.numero)}`}
            title="Mais ações"
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        )}
        itens={acoes.itensMenu(c)}
      />
    </div>
  )
}

function LinhaContrato({
  item,
  indice,
  detalhe,
  realce,
  acoes,
}: {
  item: Item
  indice: number
  detalhe: ReactNode
  realce: boolean
  acoes: Acoes
}) {
  const { contrato: c, cliente } = item
  return (
    <Linha indice={indice} className={cn('transition-colors duration-500', realce && 'bg-brand-soft/70')}>
      <Td data-contrato={c.id}>
        <p className="tnum font-semibold whitespace-nowrap text-ink">{codigoContrato(c.numero)}</p>
        <p className="tnum text-xs whitespace-nowrap text-muted" title="Gerado em">
          em {dataCurta(c.dados.emitidoEm)}
        </p>
      </Td>
      {/* Nomes e datas quebram a linha em vez de cortar: a tabela cabe na largura sem esconder o nome */}
      <Td>
        <p className="line-clamp-2 max-w-[280px] min-w-[150px] font-medium break-words text-ink" title={nomeCliente(item)}>
          {nomeCliente(item)}
        </p>
        <p className="tnum text-xs whitespace-nowrap text-muted">
          {c.dados.cliente.documento || (cliente ? 'sem CPF/CNPJ' : 'cliente removido')}
        </p>
        {/* Abaixo de 1280 px o evento e as datas vêm aqui (a coluna some) */}
        <p className="mt-1 line-clamp-2 max-w-[280px] text-xs break-words xl:hidden">
          <NomeEvento item={item} />
        </p>
        <p className="tnum max-w-[280px] text-xs text-muted xl:hidden">
          <DatasDeUso contrato={c} />
        </p>
      </Td>
      <Td className="max-xl:hidden">
        <p className="line-clamp-2 max-w-[320px] min-w-[150px] break-words">
          <NomeEvento item={item} />
        </p>
        <p className="tnum max-w-[320px] text-xs text-muted">
          <DatasDeUso contrato={c} />
        </p>
      </Td>
      <Td>
        <div className="flex flex-col items-start gap-1">
          <StatusContratoBadge status={c.status} />
          {detalhe && <p className="tnum line-clamp-2 max-w-[200px] text-xs text-muted">{detalhe}</p>}
          <AvisoMudou mudancas={item.mudancas} />
        </div>
      </Td>
      <Td>
        <BotoesLinha contrato={c} acoes={acoes} />
      </Td>
    </Linha>
  )
}

function ItemCelular({ item, detalhe, realce, acoes }: { item: Item; detalhe: ReactNode; realce: boolean; acoes: Acoes }) {
  const { contrato: c } = item
  return (
    <li
      data-contrato={c.id}
      className={cn('flex items-start gap-2 px-4 py-3.5 transition-colors duration-500', realce && 'bg-brand-soft/70')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tnum text-sm font-semibold text-ink">{codigoContrato(c.numero)}</span>
          <StatusContratoBadge status={c.status} />
        </div>
        <p className="mt-1 line-clamp-2 text-sm font-medium break-words text-ink">{nomeCliente(item)}</p>
        <p className="truncate text-[13px]">
          <NomeEvento item={item} />
        </p>
        <p className="tnum text-xs text-muted">
          <DatasDeUso contrato={c} />
        </p>
        {detalhe && <p className="tnum mt-0.5 line-clamp-2 text-xs text-muted">{detalhe}</p>}
        <AvisoMudou mudancas={item.mudancas} className="mt-1" />
      </div>
      <div className="-mr-1.5">
        <BotoesLinha contrato={c} acoes={acoes} compacto />
      </div>
    </li>
  )
}

/** Como o cliente assina: no papel, na retirada, ou pelo gov.br (de graça). */
function ComoAssinar() {
  return (
    <Card className="mt-6">
      <CardHeader
        icone={<Info className="h-4 w-4" />}
        titulo="Como o cliente assina"
        descricao="Vale a assinatura no papel ou pela internet, sem testemunhas."
      />
      <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2">
        <Forma icone={<Printer className="h-4 w-4" />} titulo="No papel, na retirada">
          Imprima 2 vias. Na retirada das máquinas, o cliente e a empresa assinam as duas e cada um fica com uma. Depois, tire uma
          foto (ou digitalize) e use <b className="font-medium text-ink">Anexar assinado</b>.
        </Forma>
        <Forma icone={<Landmark className="h-4 w-4" />} titulo="Pelo gov.br, sem imprimir">
          Envie o PDF pelo WhatsApp ou e-mail. O cliente assina de graça em{' '}
          <a
            href="https://assinador.iti.br"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-ink underline underline-offset-2"
          >
            assinador.iti.br
          </a>{' '}
          com a conta gov.br e devolve o PDF assinado, que vocês anexam aqui.
        </Forma>
      </div>
      <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
        <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Mande o contrato ao cliente antes da retirada: pelo Código de Defesa do Consumidor, ele tem o direito de ler antes de
        assinar.
      </p>
    </Card>
  )
}

function Forma({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-surface-2/70 p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">{icone}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </div>
  )
}
