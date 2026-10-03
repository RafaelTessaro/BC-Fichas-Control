// Cartão "Contrato de locação" no detalhe do evento: o contrato que vale (o mais recente que não foi
// cancelado), em que pé está a assinatura, as ações e os contratos anteriores do evento.

import {
  CalendarCheck,
  ChevronDown,
  CircleSlash,
  Download,
  Ellipsis,
  Eye,
  FileDown,
  FilePenLine,
  FilePlus,
  FileText,
  ImageIcon,
  Info,
  LoaderCircle,
  Mail,
  MessageCircle,
  Send,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { codigoContrato } from '#shared/contrato.ts'
import type { Contrato, Evento } from '#shared/tipos.ts'
import { tamanhoLegivel } from '../../lib/anexos'
import { cn } from '../../lib/cn'
import { contratosDoEvento, dataHoraCurta, juntarLista, mudancasDoContrato } from '../../lib/contratos'
import { dataCurta } from '../../lib/format'
import { useDados } from '../../store/dados'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Menu } from '../ui/Misc'
import { useAcoesContrato } from './AcoesContrato'
import { GerarContratoModal } from './GerarContratoModal'
import { StatusContratoBadge } from './StatusContrato'

/** Só reage ao arrastar arquivos (não a um texto arrastado de dentro da página). */
const temArquivos = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

export function CartaoContrato({ evento }: { evento: Evento }) {
  const contratos = useDados((s) => s.contratos)
  const clientes = useDados((s) => s.clientes)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const acoes = useAcoesContrato()
  const [gerar, setGerar] = useState(false)
  const [verAnteriores, setVerAnteriores] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0)

  const doEvento = useMemo(() => contratosDoEvento(contratos, evento.id), [contratos, evento.id])
  const vigente = doEvento.find((c) => c.status !== 'CANCELADO')
  const anteriores = doEvento.filter((c) => c !== vigente)
  // Um contrato novo assinado não cancela sozinho o anterior que também foi assinado
  const assinadosAntes = vigente?.status === 'ASSINADO' ? anteriores.filter((c) => c.status === 'ASSINADO') : []
  const cliente = clientes.find((c) => c.id === evento.clienteId)
  const mudancas = useMemo(
    () => (vigente ? mudancasDoContrato(vigente, { evento, cliente, maquinas, config }) : []),
    [vigente, evento, cliente, maquinas, config],
  )
  const cancelado = evento.status === 'CANCELADO'

  // Soltar a foto ou o PDF assinado sobre o cartão, ou colar (Ctrl+V) uma foto com o cartão
  // selecionado (clicado), abre a janela de anexar já com o arquivo. O colar fica só com o cartão:
  // não vai também para os "Arquivos do evento", que ouvem o Ctrl+V na página toda.
  const receberArquivo = vigente
    ? {
        tabIndex: -1,
        onPaste: (e: ClipboardEvent) => {
          const arquivos = [...e.clipboardData.files]
          if (!arquivos.length) return
          e.preventDefault()
          e.stopPropagation()
          acoes.abrir('anexar', vigente, { arquivos })
        },
        onDragEnter: (e: DragEvent) => {
          if (!temArquivos(e)) return
          e.preventDefault()
          profundidade.current++
          setArrastando(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!temArquivos(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (e: DragEvent) => {
          if (!temArquivos(e)) return
          profundidade.current = Math.max(0, profundidade.current - 1)
          if (!profundidade.current) setArrastando(false)
        },
        onDrop: (e: DragEvent) => {
          if (!temArquivos(e)) return
          e.preventDefault()
          // Não deixa o arquivo cair também nos "Arquivos do evento"
          e.stopPropagation()
          profundidade.current = 0
          setArrastando(false)
          acoes.abrir('anexar', vigente, { arquivos: [...e.dataTransfer.files] })
        },
      }
    : {}

  return (
    <Card id="contrato" className="relative scroll-mt-24 outline-none" {...receberArquivo}>
      <CardHeader
        icone={<FilePenLine className="h-4 w-4" />}
        titulo="Contrato de locação"
        descricao={vigente ? 'Assinatura na retirada ou pelo gov.br' : 'Para o cliente ler antes e assinar'}
      />

      {vigente ? (
        <ContratoAtual
          contrato={vigente}
          mudancas={mudancas}
          assinadosAntes={assinadosAntes}
          acoes={acoes}
          podeGerar={!cancelado}
          aoGerarNovo={() => setGerar(true)}
        />
      ) : (
        <div className="px-5 pb-5">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {cancelado
              ? 'O evento está cancelado. Para gerar o contrato, reative o evento.'
              : 'Gere o contrato em PDF para o cliente ler antes e assinar na retirada das máquinas (ou pelo gov.br).'}
          </p>
          <Button
            variante="soft"
            icone={<FilePenLine className="h-4 w-4" />}
            className="mt-3 w-full"
            onClick={() => setGerar(true)}
            disabled={cancelado}
          >
            Gerar contrato
          </Button>
        </div>
      )}

      {anteriores.length > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            onClick={() => setVerAnteriores((v) => !v)}
            aria-expanded={verAnteriores}
            className="flex w-full cursor-pointer items-center justify-between gap-2 px-5 py-3 text-left text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <span>
              {anteriores.length === 1 ? 'Contrato anterior' : 'Contratos anteriores'}{' '}
              <span className="tnum text-muted">({anteriores.length})</span>
            </span>
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', verAnteriores && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {verAnteriores && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden px-5"
              >
                {anteriores.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="tnum text-[13px] font-semibold text-ink">{codigoContrato(c.numero)}</span>
                        <StatusContratoBadge status={c.status} />
                      </p>
                      <p className="tnum mt-0.5 line-clamp-2 text-xs text-muted">
                        Gerado em {dataCurta(c.dados.emitidoEm)}
                        {c.status === 'ASSINADO' && c.assinadoEm && ` • assinado em ${dataCurta(c.assinadoEm)}`}
                        {c.status === 'CANCELADO' && c.motivoCancelamento && ` • ${c.motivoCancelamento.replace(/\.$/, '')}`}
                      </p>
                    </div>
                    <Menu
                      gatilho={(abrir) => (
                        <Button
                          variante="ghost"
                          tamanho="icon-sm"
                          onClick={abrir}
                          aria-label={`Ações do contrato ${codigoContrato(c.numero)}`}
                        >
                          <Ellipsis className="h-4 w-4" />
                        </Button>
                      )}
                      itens={acoes.itensMenu(c, { semEvento: true, sem: ['gerar'] })}
                    />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Arrastando a cópia assinada sobre o cartão */}
      <AnimatePresence>
        {arrastando && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-surface/90 px-6 text-center backdrop-blur-[2px]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-md">
              <Upload className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-ink">Solte o contrato assinado</p>
            <p className="text-xs text-muted">Foto ou PDF</p>
          </motion.div>
        )}
      </AnimatePresence>

      {acoes.janelas}
      <GerarContratoModal aberto={gerar} evento={evento} aoFechar={() => setGerar(false)} />
    </Card>
  )
}

function ContratoAtual({
  contrato: c,
  mudancas,
  assinadosAntes,
  acoes,
  podeGerar,
  aoGerarNovo,
}: {
  contrato: Contrato
  mudancas: string[]
  /** Contratos mais antigos do evento que também estão assinados (este os substitui). */
  assinadosAntes: Contrato[]
  acoes: ReturnType<typeof useAcoesContrato>
  podeGerar: boolean
  aoGerarNovo: () => void
}) {
  const baixando = acoes.baixando === c.id
  const retirada = dataHoraCurta(c.dados.retirada)
  const devolucao = dataHoraCurta(c.dados.devolucao)
  const imagem = c.arquivo?.tipo.startsWith('image/')
  return (
    <div className="flex flex-col gap-3 px-5 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tnum text-[15px] font-semibold tracking-[-0.01em] text-ink">Contrato {codigoContrato(c.numero)}</p>
          <p className="tnum text-xs text-muted">Gerado em {dataCurta(c.dados.emitidoEm)}</p>
        </div>
        <StatusContratoBadge status={c.status} className="mt-0.5" />
      </div>

      <dl className="tnum grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <Dado rotulo="Retirada">{retirada || <span className="text-muted">a preencher à mão</span>}</Dado>
        <Dado rotulo="Devolução">{devolucao || <span className="text-muted">a preencher à mão</span>}</Dado>
        {c.status === 'ASSINADO' && <Dado rotulo="Assinado em">{c.assinadoEm ? dataCurta(c.assinadoEm) : '—'}</Dado>}
      </dl>

      {mudancas.length > 0 && (
        <div className="rounded-xl bg-warning-soft px-3.5 py-3 text-[13px] text-warning">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>O aluguel mudou depois deste contrato</span>
          </p>
          <p className="mt-1 pl-6 text-xs text-ink-2">Mudou: {juntarLista(mudancas)}. Gere um novo para o cliente assinar.</p>
          {podeGerar && (
            <Button tamanho="sm" icone={<FilePlus className="h-4 w-4" />} onClick={aoGerarNovo} className="mt-2.5 ml-6">
              Gerar novo
            </Button>
          )}
        </div>
      )}

      {assinadosAntes.length > 0 && (
        <div className="rounded-xl bg-info-soft px-3.5 py-3 text-[13px] text-info">
          <p className="flex items-start gap-2 font-medium">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {assinadosAntes.length === 1
                ? `O contrato ${codigoContrato(assinadosAntes[0].numero)} também está assinado`
                : `Os contratos ${juntarLista(assinadosAntes.map((a) => codigoContrato(a.numero)))} também estão assinados`}
            </span>
          </p>
          <p className="mt-1 pl-6 text-xs text-ink-2">
            Este contrato substitui o anterior: cancele-o para valer só o {codigoContrato(c.numero)}.
          </p>
          <div className="mt-2.5 ml-6 flex flex-wrap gap-2">
            {assinadosAntes.map((a) => (
              <Button
                key={a.id}
                tamanho="sm"
                icone={<CircleSlash className="h-4 w-4" />}
                onClick={() => acoes.abrir('cancelar', a, { motivo: `Substituído pelo contrato ${codigoContrato(c.numero)}.` })}
              >
                Cancelar o {codigoContrato(a.numero)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {c.arquivo && (
        <div className="flex items-center gap-1 rounded-xl border border-line py-1.5 pr-1.5 pl-2 transition-colors hover:border-line-strong">
          <button
            type="button"
            onClick={() => acoes.verAssinado(c)}
            title="Ver o contrato assinado (abre em outra aba)"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                imagem ? 'bg-info-soft text-info' : 'bg-danger-soft text-danger',
              )}
            >
              {imagem ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{c.arquivo.nome}</span>
              <span
                className="tnum block truncate text-xs text-muted"
                title={`Anexada em ${dataCurta(c.arquivo.enviadoEm.slice(0, 10))}`}
              >
                Cópia assinada • {tamanhoLegivel(c.arquivo.tamanho)}
              </span>
            </span>
          </button>
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={() => acoes.verAssinado(c)}
            aria-label="Ver assinado"
            title="Ver assinado"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={() => acoes.baixarAssinado(c)}
            aria-label="Baixar o contrato assinado"
            title="Baixar"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          tamanho="sm"
          icone={baixando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          onClick={() => void acoes.baixarPdf(c)}
          disabled={baixando}
        >
          Baixar PDF
        </Button>
        <Menu
          alinhar="right"
          gatilho={(abrir) => (
            <Button tamanho="sm" icone={<Send className="h-4 w-4" />} onClick={abrir} className="w-full">
              Enviar
              <ChevronDown className="-mr-1 h-3.5 w-3.5 text-muted" />
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
        {!c.arquivo && (
          <Button
            tamanho="sm"
            variante={c.status === 'AGUARDANDO' ? 'soft' : 'secondary'}
            icone={<Upload className="h-4 w-4" />}
            onClick={() => acoes.abrir('anexar', c)}
            className="col-span-2"
            title="Foto ou PDF do contrato assinado. Também dá para arrastar o arquivo para este cartão ou, com ele selecionado, colar uma foto (Ctrl+V)."
          >
            {c.status === 'AGUARDANDO' ? 'Anexar assinado (foto ou PDF)' : 'Anexar a cópia assinada'}
          </Button>
        )}
      </div>

      {c.status === 'AGUARDANDO' && (
        <p className="-mt-1 text-center text-xs text-muted">
          Assinou no papel e a foto fica para depois?{' '}
          <button
            type="button"
            onClick={() => acoes.abrir('assinar', c)}
            className="inline-flex cursor-pointer items-center gap-1 font-medium text-brand-ink hover:underline"
          >
            <CalendarCheck className="h-3 w-3" />
            Marcar como assinado
          </button>
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        {/* Com o aviso de que o aluguel mudou, o "Gerar novo" já está nele */}
        {mudancas.length > 0 && podeGerar ? (
          <span />
        ) : (
          <Button
            variante="ghost"
            tamanho="sm"
            icone={<FilePlus className="h-4 w-4" />}
            onClick={aoGerarNovo}
            disabled={!podeGerar}
            className="-ml-2"
            title={
              c.status === 'AGUARDANDO'
                ? 'Gera outro contrato com os dados de agora; este é substituído'
                : 'Gera outro contrato com os dados de agora'
            }
          >
            Gerar novo
          </Button>
        )}
        <Menu
          gatilho={(abrir) => (
            <Button variante="ghost" tamanho="sm" icone={<Ellipsis className="h-4 w-4" />} onClick={abrir} className="-mr-2">
              Mais
            </Button>
          )}
          itens={acoes.itensMenu(c, { semEvento: true, sem: ['pdf', 'whatsapp', 'email', 'gerar'] })}
        />
      </div>
    </div>
  )
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{rotulo}</dt>
      <dd className="truncate font-medium text-ink">{children}</dd>
    </>
  )
}
