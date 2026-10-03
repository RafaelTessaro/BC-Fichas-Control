// Cartão "Arquivos do evento": prints da conversa, PDF, imagens, logo, cardápio que o cliente manda.
// A secretária anexa (botão, arrastar e soltar, ou Ctrl+V com um print) e o técnico vê na própria
// tela, sem precisar baixar, ou baixa. Num evento ainda não salvo, os arquivos ficam na fila
// (`pendentes`) e o formulário envia depois de salvar.

import { format } from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileIcon,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Info,
  Paperclip,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ImgHTMLAttributes, type ReactNode } from 'react'
import type { Anexo } from '#shared/tipos.ts'
import { anexosDoEvento, classeAnexo, tamanhoLegivel, type ClasseAnexo } from '../lib/anexos'
import { api, LIMITE_ANEXO } from '../lib/api'
import { cn } from '../lib/cn'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { confirmar } from './ui/Feedback'
import { Modal } from './ui/Modal'

export interface AnexosEventoProps {
  /** Evento já gravado: os arquivos vão direto para o servidor. Sem ele, ficam na fila (`pendentes`). */
  eventoId?: string
  /** Fila de arquivos escolhidos antes de salvar um evento novo (enviados depois de salvar). */
  pendentes?: File[]
  aoMudarPendentes?: (arquivos: File[]) => void
  /** id do cartão, para rolar até ele. */
  id?: string
}

/** Arquivo subindo para o servidor (no máximo dois ao mesmo tempo; os outros esperam na fila). */
interface Envio {
  chave: number
  eventoId: string
  arquivo: File
  estado: 'fila' | 'enviando' | 'erro'
  /** De 0 a 1. */
  progresso: number
  erro?: string
}

const ENVIOS_SIMULTANEOS = 2
let sequencia = 0

const dataHora = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm")

/** Só reage ao arrastar arquivos (não a um texto ou imagem arrastada de dentro da página). */
const temArquivos = (e: DragEvent | globalThis.DragEvent) => !!e.dataTransfer?.types.includes('Files')

/** O print colado vem como "image.png": ganha um nome que diz o que é e quando foi colado. */
function nomeDoColado(arquivo: File, i: number) {
  if (arquivo.name && !/^image\.\w+$/i.test(arquivo.name)) return arquivo
  const ext = arquivo.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const nome = `Print colado ${format(new Date(), 'dd-MM-yyyy HH-mm-ss')}${i ? ` (${i + 1})` : ''}.${ext}`
  return new File([arquivo], nome, { type: arquivo.type, lastModified: Date.now() })
}

/** Tipo para mostrar ("PDF", "Imagem", "DOCX"…). */
function rotuloTipo(a: Pick<Anexo, 'nome' | 'tipo'>, classe: ClasseAnexo) {
  if (classe === 'imagem') return 'Imagem'
  if (classe === 'pdf') return 'PDF'
  if (classe === 'texto') return 'Texto'
  const ext = /\.([a-z0-9]{1,5})$/i.exec(a.nome)?.[1]
  return ext ? ext.toUpperCase() : 'Arquivo'
}

/** Ícone e cor do arquivo que não tem miniatura. */
function iconeArquivo(a: Pick<Anexo, 'nome' | 'tipo'>, classe: ClasseAnexo): { icone: ReactNode; cor: string } {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(a.nome)?.[1]?.toLowerCase() ?? ''
  if (classe === 'imagem') return { icone: <ImageIcon className="h-5 w-5" />, cor: 'bg-info-soft text-info' }
  if (classe === 'pdf') return { icone: <FileText className="h-5 w-5" />, cor: 'bg-danger-soft text-danger' }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext))
    return { icone: <FileSpreadsheet className="h-5 w-5" />, cor: 'bg-success-soft text-success' }
  if (['zip', 'rar', '7z'].includes(ext))
    return { icone: <FileArchive className="h-5 w-5" />, cor: 'bg-warning-soft text-warning' }
  if (classe === 'texto' || ['doc', 'docx', 'odt', 'rtf'].includes(ext))
    return { icone: <FileText className="h-5 w-5" />, cor: 'bg-info-soft text-info' }
  return { icone: <FileIcon className="h-5 w-5" />, cor: 'bg-surface-3 text-ink-2' }
}

/** Salva o arquivo no computador (o servidor manda como download). */
function baixar(a: Anexo) {
  const link = document.createElement('a')
  link.href = api.urlAnexo(a.id, true)
  link.download = a.nome
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function AnexosEvento({ eventoId, pendentes = [], aoMudarPendentes, id }: AnexosEventoProps) {
  const todos = useDados((s) => s.anexos)
  const enviarAnexo = useDados((s) => s.enviarAnexo)
  const excluirAnexo = useDados((s) => s.excluirAnexo)
  const anexos = useMemo(() => (eventoId ? anexosDoEvento(todos, eventoId) : []), [todos, eventoId])
  // Os que abrem na tela (imagem, PDF, texto), para passar de um para o outro no visualizador
  const visiveis = useMemo(() => anexos.filter((a) => classeAnexo(a) !== 'outro'), [anexos])
  const [envios, setEnvios] = useState<Envio[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [vendo, setVendo] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const profundidade = useRef(0)

  // Envia os da fila, até dois ao mesmo tempo (cada um mostra o próprio progresso)
  const esperando = useRef<Envio[]>([])
  const ativos = useRef(0)
  const atualizar = (chave: number, mudanca: Partial<Envio>) =>
    setEnvios((l) => l.map((e) => (e.chave === chave ? { ...e, ...mudanca } : e)))
  const iniciarProximos = () => {
    while (ativos.current < ENVIOS_SIMULTANEOS && esperando.current.length) {
      const envio = esperando.current.shift()!
      ativos.current++
      atualizar(envio.chave, { estado: 'enviando', progresso: 0 })
      enviarAnexo(envio.eventoId, envio.arquivo, envio.arquivo.name, (p) => atualizar(envio.chave, { progresso: p }))
        .then(() => setEnvios((l) => l.filter((e) => e.chave !== envio.chave)))
        .catch((e: Error) => atualizar(envio.chave, { estado: 'erro', erro: e.message }))
        .finally(() => {
          ativos.current--
          iniciarProximos()
        })
    }
  }
  const enfileirar = (lista: Envio[]) => {
    esperando.current.push(...lista)
    iniciarProximos()
  }
  const repetir = (envio: Envio) => {
    atualizar(envio.chave, { estado: 'fila', erro: undefined, progresso: 0 })
    enfileirar([envio])
  }

  const adicionar = (lista: File[]) => {
    const grandes = lista.filter((f) => f.size > LIMITE_ANEXO)
    const vazios = lista.filter((f) => f.size === 0)
    const bons = lista.filter((f) => f.size > 0 && f.size <= LIMITE_ANEXO)
    if (grandes.length) {
      toast.erro(
        grandes.length === 1 ? 'Arquivo grande demais' : `${grandes.length} arquivos grandes demais`,
        `${grandes.map((f) => f.name).join(', ')}: o limite é 25 MB por arquivo.`,
      )
    }
    if (vazios.length) toast.erro(vazios.length === 1 ? 'Arquivo vazio' : 'Arquivos vazios', vazios.map((f) => f.name).join(', '))
    if (!bons.length) return
    if (!eventoId) {
      aoMudarPendentes?.([...pendentes, ...bons])
      return
    }
    const novos = bons.map((arquivo): Envio => ({ chave: ++sequencia, eventoId, arquivo, estado: 'fila', progresso: 0 }))
    setEnvios((atual) => [...atual, ...novos])
    enfileirar(novos)
  }
  // O Ctrl+V é ouvido na janela toda: usa sempre a versão atual de `adicionar`
  const adicionarRef = useRef(adicionar)
  useEffect(() => {
    adicionarRef.current = adicionar
  })

  // Colar um print (Ctrl+V) em qualquer lugar da página anexa o arquivo; texto colado segue normal
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const arquivos = [...(e.clipboardData?.files ?? [])]
      // Com uma janela aberta (ex.: reclamação), o colar é dela
      if (!arquivos.length || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      adicionarRef.current(arquivos.map(nomeDoColado))
      document.getElementById(id ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    // Arquivo solto fora do cartão não pode abrir no navegador (e fazer perder o que foi digitado)
    const segurar = (e: globalThis.DragEvent) => {
      if (temArquivos(e)) e.preventDefault()
    }
    window.addEventListener('paste', aoColar)
    window.addEventListener('dragover', segurar)
    window.addEventListener('drop', segurar)
    return () => {
      window.removeEventListener('paste', aoColar)
      window.removeEventListener('dragover', segurar)
      window.removeEventListener('drop', segurar)
    }
  }, [id])

  const apagar = async (a: Anexo) => {
    const ok = await confirmar({
      titulo: 'Apagar este arquivo?',
      descricao: `“${a.nome}” será apagado do servidor, para todos os computadores. Esta ação não pode ser desfeita.`,
      confirmar: 'Apagar arquivo',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirAnexo(a.id)
      if (vendo === a.id) setVendo(null)
      toast.sucesso('Arquivo apagado', a.nome)
    } catch (e) {
      avisarErro('Não foi possível apagar o arquivo', e)
    }
  }

  const abrir = (a: Anexo) => (classeAnexo(a) === 'outro' ? baixar(a) : setVendo(a.id))

  const arrastar = {
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
      profundidade.current = 0
      setArrastando(false)
      adicionar([...e.dataTransfer.files])
    },
  }

  const total = anexos.length + pendentes.length
  const nada = !total && !envios.length

  return (
    <Card id={id} className="relative scroll-mt-24" {...arrastar}>
      <CardHeader
        icone={<Paperclip className="h-4 w-4" />}
        titulo="Arquivos do evento"
        descricao={
          total
            ? `${total} ${total === 1 ? 'arquivo' : 'arquivos'} • prints, PDF, logo, cardápio…`
            : 'Prints da conversa, PDF, imagens, logo, cardápio…'
        }
        acoes={
          <Button tamanho="sm" variante="soft" icone={<Upload className="h-4 w-4" />} onClick={() => entrada.current?.click()}>
            Anexar
          </Button>
        }
      />
      <input
        ref={entrada}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          adicionar([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <div className="@container flex flex-col gap-3 px-5 pb-5">
        {!eventoId && pendentes.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3 py-2.5 text-[13px] text-info">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Os arquivos são enviados quando você salvar o evento.
          </p>
        )}

        {(anexos.length > 0 || pendentes.length > 0 || envios.length > 0) && (
          <ul className="grid grid-cols-1 gap-2 @3xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {anexos.map((a) => (
                <ItemLista key={a.id}>
                  <LinhaAnexo anexo={a} aoAbrir={() => abrir(a)} aoApagar={() => void apagar(a)} />
                </ItemLista>
              ))}
              {pendentes.map((f, i) => (
                <ItemLista key={`p-${i}-${f.name}-${f.size}`}>
                  <LinhaArquivoLocal
                    arquivo={f}
                    detalhe="Vai ser enviado ao salvar"
                    acoes={
                      <Button
                        variante="ghost"
                        tamanho="icon-sm"
                        onClick={() => aoMudarPendentes?.(pendentes.filter((_, j) => j !== i))}
                        aria-label={`Tirar ${f.name}`}
                        title="Tirar da lista"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    }
                  />
                </ItemLista>
              ))}
              {envios.map((envio) => (
                <ItemLista key={`e-${envio.chave}`}>
                  <LinhaEnvio
                    envio={envio}
                    aoRepetir={() => repetir(envio)}
                    aoDispensar={() => setEnvios((l) => l.filter((e) => e.chave !== envio.chave))}
                  />
                </ItemLista>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {/* Área para soltar ou escolher arquivos (grande quando ainda não há nenhum) */}
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          className={cn(
            'group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong text-left transition-colors',
            'hover:border-brand hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            nada ? 'flex-col justify-center px-5 py-8 text-center' : 'px-3.5 py-2.5',
          )}
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink transition-transform group-hover:scale-105',
              nada ? 'h-11 w-11' : 'h-8 w-8 rounded-lg',
            )}
          >
            <Upload className={nada ? 'h-5 w-5' : 'h-4 w-4'} />
          </span>
          <span className="min-w-0">
            <span className={cn('block font-medium text-ink', nada ? 'text-sm' : 'text-[13px]')}>
              {nada ? (
                <>
                  <span className="max-sm:hidden">Arraste os arquivos para cá ou clique para escolher</span>
                  <span className="sm:hidden">Toque para escolher os arquivos</span>
                </>
              ) : (
                <>
                  <span className="max-sm:hidden">Arraste mais arquivos, clique para escolher ou cole um print</span>
                  <span className="sm:hidden">Anexar mais arquivos</span>
                </>
              )}
            </span>
            <span className={cn('block text-xs text-muted', nada && 'mt-1 max-w-md')}>
              {nada ? (
                <>
                  <span className="max-sm:hidden">
                    Para um print da conversa, copie e cole aqui com <Tecla>Ctrl</Tecla> + <Tecla>V</Tecla>.{' '}
                  </span>
                  Vários de uma vez, até 25 MB cada.
                </>
              ) : (
                <>
                  <span className="max-sm:hidden">
                    <Tecla>Ctrl</Tecla> + <Tecla>V</Tecla> cola um print copiado •{' '}
                  </span>
                  até 25 MB cada
                </>
              )}
            </span>
          </span>
        </button>
      </div>

      {/* Arrastando arquivos sobre o cartão */}
      <AnimatePresence>
        {arrastando && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-surface/90 backdrop-blur-[2px]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-md">
              <Upload className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-ink">Solte para anexar</p>
            <p className="text-xs text-muted">
              {eventoId ? 'Os arquivos vão direto para o evento.' : 'Os arquivos são enviados quando você salvar o evento.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <VisualizadorAnexo
        anexos={visiveis}
        idAberto={vendo}
        aoTrocar={setVendo}
        aoFechar={() => setVendo(null)}
        aoApagar={(a) => void apagar(a)}
      />
    </Card>
  )
}

function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1 py-px font-sans text-[11px] font-medium text-ink-2">
      {children}
    </kbd>
  )
}

function ItemLista({ children }: { children: ReactNode }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="min-w-0"
    >
      {children}
    </motion.li>
  )
}

/** Moldura de uma linha da lista: miniatura (ou ícone), nome, detalhe e ações. */
function Linha({
  miniatura,
  nome,
  detalhe,
  acoes,
  aoAbrir,
  tituloAbrir,
  children,
}: {
  miniatura: ReactNode
  nome: string
  detalhe: ReactNode
  acoes?: ReactNode
  aoAbrir?: () => void
  tituloAbrir?: string
  children?: ReactNode
}) {
  const corpo = (
    <>
      {miniatura}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink" title={nome}>
          {nome}
        </span>
        <span className="block truncate text-xs text-muted">{detalhe}</span>
        {children}
      </span>
    </>
  )
  return (
    <div className="flex h-full items-center gap-1 rounded-xl border border-line bg-surface py-2 pr-1.5 pl-2 transition-colors hover:border-line-strong">
      {aoAbrir ? (
        <button
          type="button"
          onClick={aoAbrir}
          title={tituloAbrir}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {corpo}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{corpo}</div>
      )}
      {acoes && <div className="flex shrink-0 items-center">{acoes}</div>}
    </div>
  )
}

/**
 * Quadradinho com a miniatura da imagem ou o ícone do tipo do arquivo. A imagem vem do servidor
 * (`src`) ou, antes de enviada, do próprio computador (`arquivo`).
 */
function Miniatura({ src, arquivo, anexo }: { src?: string; arquivo?: File; anexo: Pick<Anexo, 'nome' | 'tipo'> }) {
  const classe = classeAnexo(anexo)
  const [falhou, setFalhou] = useState(false)
  if (classe === 'imagem' && (src || arquivo) && !falhou) {
    const props = {
      alt: '',
      decoding: 'async' as const,
      onError: () => setFalhou(true),
      className: 'h-full w-full object-cover',
    }
    return (
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
        {arquivo ? <ImagemLocal arquivo={arquivo} {...props} /> : <img src={src} loading="lazy" {...props} />}
      </span>
    )
  }
  const { icone, cor } = iconeArquivo(anexo, classe)
  return <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', cor)}>{icone}</span>
}

/** Imagem que ainda está no computador: um endereço temporário, liberado quando sai da tela. */
function ImagemLocal({ arquivo, ...props }: { arquivo: File } & ImgHTMLAttributes<HTMLImageElement>) {
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(arquivo)
    if (img.current) img.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [arquivo])
  return <img ref={img} {...props} />
}

function LinhaAnexo({ anexo, aoAbrir, aoApagar }: { anexo: Anexo; aoAbrir: () => void; aoApagar: () => void }) {
  const classe = classeAnexo(anexo)
  const naTela = classe !== 'outro'
  return (
    <Linha
      miniatura={<Miniatura src={api.urlAnexo(anexo.id)} anexo={anexo} />}
      nome={anexo.nome}
      detalhe={
        <span className="tnum" title={`Enviado em ${dataHora(anexo.criadoEm)}`}>
          {rotuloTipo(anexo, classe)} • {tamanhoLegivel(anexo.tamanho)} • {format(new Date(anexo.criadoEm), 'dd/MM/yyyy')}
        </span>
      }
      aoAbrir={aoAbrir}
      tituloAbrir={naTela ? 'Ver na tela' : 'Este tipo de arquivo não abre na tela: clique para baixar'}
      acoes={
        <>
          {naTela && (
            // No celular, tocar na linha já abre (sobra espaço para o nome)
            <Button
              variante="ghost"
              tamanho="icon-sm"
              onClick={aoAbrir}
              aria-label={`Ver ${anexo.nome}`}
              title="Ver"
              className="max-sm:hidden"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={() => baixar(anexo)}
            aria-label={`Baixar ${anexo.nome}`}
            title="Baixar"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={aoApagar}
            aria-label={`Apagar ${anexo.nome}`}
            title="Apagar"
            className="hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      }
    />
  )
}

function LinhaArquivoLocal({
  arquivo,
  detalhe,
  acoes,
  children,
}: {
  arquivo: File
  detalhe: ReactNode
  acoes?: ReactNode
  children?: ReactNode
}) {
  const anexo = { nome: arquivo.name, tipo: arquivo.type }
  return (
    <Linha
      miniatura={<Miniatura arquivo={arquivo} anexo={anexo} />}
      nome={arquivo.name}
      detalhe={
        <>
          <span className="tnum">
            {rotuloTipo(anexo, classeAnexo(anexo))} • {tamanhoLegivel(arquivo.size)}
          </span>
          {detalhe && <> • {detalhe}</>}
        </>
      }
      acoes={acoes}
    >
      {children}
    </Linha>
  )
}

function LinhaEnvio({ envio, aoRepetir, aoDispensar }: { envio: Envio; aoRepetir: () => void; aoDispensar: () => void }) {
  const pct = Math.round(envio.progresso * 100)
  if (envio.estado === 'erro') {
    return (
      <LinhaArquivoLocal
        arquivo={envio.arquivo}
        detalhe={<span className="text-danger">Não foi enviado</span>}
        acoes={
          <>
            <Button variante="ghost" tamanho="icon-sm" onClick={aoRepetir} aria-label="Tentar de novo" title="Tentar de novo">
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button variante="ghost" tamanho="icon-sm" onClick={aoDispensar} aria-label="Dispensar" title="Dispensar">
              <X className="h-4 w-4" />
            </Button>
          </>
        }
      >
        <span className="mt-0.5 block text-xs break-words text-danger">{envio.erro}</span>
      </LinhaArquivoLocal>
    )
  }
  return (
    <LinhaArquivoLocal
      arquivo={envio.arquivo}
      detalhe={envio.estado === 'fila' ? 'Na fila…' : pct >= 100 ? 'Concluindo…' : `Enviando… ${pct}%`}
    >
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct}>
        <motion.span
          className="block h-full rounded-full bg-brand"
          initial={false}
          animate={{ width: `${envio.estado === 'fila' ? 0 : Math.max(3, pct)}%` }}
          transition={{ duration: 0.2 }}
        />
      </span>
    </LinhaArquivoLocal>
  )
}

/** Imagem, PDF ou texto aberto na própria tela, com setas para passar de um arquivo para o outro. */
function VisualizadorAnexo({
  anexos,
  idAberto,
  aoTrocar,
  aoFechar,
  aoApagar,
}: {
  anexos: Anexo[]
  idAberto: string | null
  aoTrocar: (id: string) => void
  aoFechar: () => void
  aoApagar: (a: Anexo) => void
}) {
  const i = anexos.findIndex((a) => a.id === idAberto)
  const anexo = i >= 0 ? anexos[i] : undefined
  // O último aberto continua na tela enquanto a janela fecha (animação de saída)
  const [ultimo, setUltimo] = useState(anexo)
  if (anexo && anexo !== ultimo) setUltimo(anexo)
  const atual = anexo ?? ultimo
  const varios = anexos.length > 1
  const anterior = varios && i >= 0 ? anexos[(i - 1 + anexos.length) % anexos.length] : undefined
  const proximo = varios && i >= 0 ? anexos[(i + 1) % anexos.length] : undefined

  // Setas do teclado passam de um arquivo para o outro
  useEffect(() => {
    if (!anexo || !varios) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && anterior) aoTrocar(anterior.id)
      if (e.key === 'ArrowRight' && proximo) aoTrocar(proximo.id)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [anexo, varios, anterior, proximo, aoTrocar])

  const classe = atual ? classeAnexo(atual) : 'outro'
  const { icone } = atual ? iconeArquivo(atual, classe) : { icone: null }

  return (
    <Modal
      aberto={!!anexo}
      aoFechar={aoFechar}
      largura="max-w-5xl"
      icone={icone}
      titulo={<span className="block truncate">{atual?.nome}</span>}
      descricao={
        atual && (
          <span className="tnum">
            {rotuloTipo(atual, classe)} • {tamanhoLegivel(atual.tamanho)} • enviado em {dataHora(atual.criadoEm)}
            {varios && i >= 0 && ` • ${i + 1} de ${anexos.length}`}
          </span>
        )
      }
      rodape={
        atual && (
          <>
            {varios && (
              <div className="mr-auto flex gap-1">
                <Button
                  tamanho="icon"
                  variante="ghost"
                  onClick={() => anterior && aoTrocar(anterior.id)}
                  aria-label="Arquivo anterior"
                  title="Anterior (seta para a esquerda)"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  tamanho="icon"
                  variante="ghost"
                  onClick={() => proximo && aoTrocar(proximo.id)}
                  aria-label="Próximo arquivo"
                  title="Próximo (seta para a direita)"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            )}
            <Button
              tamanho="icon"
              variante="ghost"
              onClick={() => aoApagar(atual)}
              aria-label="Apagar arquivo"
              title="Apagar"
              className="hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              icone={<ExternalLink className="h-4 w-4" />}
              onClick={() => window.open(api.urlAnexo(atual.id), '_blank', 'noopener')}
              className="max-sm:hidden"
            >
              Abrir em nova aba
            </Button>
            <Button variante="primary" icone={<Download className="h-4 w-4" />} onClick={() => baixar(atual)}>
              Baixar
            </Button>
          </>
        )
      }
    >
      {atual && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={atual.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {classe === 'imagem' ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-xl bg-surface-2 p-2">
                <img
                  src={api.urlAnexo(atual.id)}
                  alt={atual.nome}
                  className="max-h-[66dvh] w-auto max-w-full rounded-lg object-contain shadow-xs"
                />
              </div>
            ) : (
              <>
                <iframe
                  src={api.urlAnexo(atual.id)}
                  title={atual.nome}
                  className="h-[66dvh] w-full rounded-xl border border-line bg-white"
                />
                {classe === 'pdf' && (
                  <p className="mt-2 text-xs text-muted">
                    O PDF não apareceu (acontece em alguns celulares)? Use{' '}
                    <a
                      href={api.urlAnexo(atual.id)}
                      target="_blank"
                      rel="noopener"
                      className="font-medium text-brand-ink underline underline-offset-2"
                    >
                      abrir em nova aba
                    </a>{' '}
                    ou “Baixar”.
                  </p>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </Modal>
  )
}
