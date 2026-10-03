// "Anexar contrato assinado": a foto ou o PDF do contrato assinado pelo cliente (no papel ou pelo
// gov.br). Aceita escolher, arrastar ou colar (Ctrl+V) uma foto; várias fotos (uma por página)
// são juntadas aqui mesmo num PDF só. Um contrato que esperava a assinatura passa a assinado.

import { Camera, FileText, ImageIcon, LoaderCircle, Paperclip, TriangleAlert, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { codigoContrato } from '#shared/contrato.ts'
import type { Contrato } from '#shared/tipos.ts'
import { tamanhoLegivel } from '../../lib/anexos'
import { LIMITE_ANEXO } from '../../lib/api'
import { cn } from '../../lib/cn'
import { encaixarNaPagina, fotoComum, nomeAssinado, nomeClienteContrato, tipoAssinado } from '../../lib/contratos'
import { dataCurta } from '../../lib/format'
import { useDados } from '../../store/dados'
import { avisarErro, toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/** Arquivo escolhido, já com o tipo conferido. */
interface Escolhido {
  chave: number
  arquivo: File
  tipo: string
}

let sequencia = 0

/**
 * Junta os arquivos novos aos já escolhidos: a seleção é um PDF só ou fotos (uma por página).
 * Devolve a nova seleção e o aviso sobre o que ficou de fora.
 */
function selecionar(lista: File[], atuais: Escolhido[]): { lista: Escolhido[]; erro: string | null } {
  const recusados: string[] = []
  const grandes: string[] = []
  const novos: Escolhido[] = []
  for (const arquivo of lista) {
    const tipo = tipoAssinado(arquivo.name, arquivo.type)
    if (!tipo) recusados.push(arquivo.name || 'arquivo')
    else if (arquivo.size > LIMITE_ANEXO) grandes.push(arquivo.name)
    else if (arquivo.size > 0) novos.push({ chave: ++sequencia, arquivo, tipo })
  }
  const avisos = [
    recusados.length ? `${recusados.join(', ')}: envie o contrato em PDF ou foto (JPG, PNG).` : '',
    grandes.length ? `${grandes.join(', ')}: o limite é 25 MB.` : '',
  ].filter(Boolean)
  const erro = avisos.length ? avisos.join(' ') : null
  if (!novos.length) return { lista: atuais, erro }
  const pdf = novos.filter((n) => n.tipo === 'application/pdf')
  if (pdf.length) {
    return {
      lista: [pdf[pdf.length - 1]],
      erro: pdf.length > 1 || novos.length > 1 ? 'Escolha um PDF só (ou as fotos, uma por página).' : erro,
    }
  }
  // Fotos: somam com as fotos já escolhidas (um PDF escolhido antes sai)
  return { lista: [...atuais.filter((a) => a.tipo !== 'application/pdf'), ...novos], erro }
}

/** Só reage ao arrastar arquivos (não a um texto arrastado de dentro da página). */
const temArquivos = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/**
 * Junta as fotos (uma por página) num PDF, cada uma numa folha A4 em pé ou deitada, conforme a
 * foto. As fotos grandes do celular são reduzidas para o arquivo não ficar pesado.
 */
async function juntarFotos(fotos: File[], nome: string): Promise<File> {
  const { jsPDF } = await import('jspdf')
  let doc: InstanceType<typeof jsPDF> | null = null
  for (const foto of fotos) {
    const img = await createImageBitmap(foto)
    const escala = Math.min(1, 2200 / Math.max(img.width, img.height))
    const largura = Math.round(img.width * escala)
    const altura = Math.round(img.height * escala)
    const tela = document.createElement('canvas')
    tela.width = largura
    tela.height = altura
    const ctx = tela.getContext('2d')
    if (!ctx) throw new Error('Este navegador não conseguiu preparar as fotos.')
    // Fundo branco: PNG com transparência ficaria preto no JPEG
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, largura, altura)
    ctx.drawImage(img, 0, 0, largura, altura)
    img.close()
    const deitada = largura > altura
    const pagina = deitada ? { l: 297, a: 210 } : { l: 210, a: 297 }
    if (!doc) doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: deitada ? 'landscape' : 'portrait' })
    else doc.addPage('a4', deitada ? 'landscape' : 'portrait')
    const r = encaixarNaPagina(largura, altura, pagina)
    doc.addImage(tela.toDataURL('image/jpeg', 0.82), 'JPEG', r.x, r.y, r.l, r.a, undefined, 'FAST')
  }
  if (!doc) throw new Error('Nenhuma foto escolhida.')
  return new File([doc.output('blob')], nome, { type: 'application/pdf' })
}

export function AnexarAssinadoModal({
  aberto,
  contrato,
  arquivosIniciais,
  aoFechar,
}: {
  aberto: boolean
  contrato: Contrato | undefined
  /** Arquivos soltos sobre o cartão do contrato (já entram escolhidos). */
  arquivosIniciais?: File[]
  aoFechar: () => void
}) {
  const enviarContratoAssinado = useDados((s) => s.enviarContratoAssinado)
  const clientes = useDados((s) => s.clientes)
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [etapa, setEtapa] = useState<'escolher' | 'juntando' | 'enviando'>('escolher')
  const [progresso, setProgresso] = useState(0)
  const [arrastando, setArrastando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const profundidade = useRef(0)

  const incluir = (lista: File[]) => {
    const r = selecionar(lista, escolhidos)
    setEscolhidos(r.lista)
    setErro(r.erro)
  }

  // Cada vez que abre, começa de novo (com os arquivos soltos sobre o cartão, se vieram)
  const [abertoAntes, setAbertoAntes] = useState(false)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      const r = selecionar(arquivosIniciais ?? [], [])
      setErro(r.erro)
      setEtapa('escolher')
      setProgresso(0)
      setEscolhidos(r.lista)
    }
  }

  // Ctrl+V com uma foto copiada (print, foto do WhatsApp Web) enquanto a janela está aberta
  const incluirRef = useRef(incluir)
  useEffect(() => {
    incluirRef.current = incluir
  })
  useEffect(() => {
    if (!aberto) return
    const aoColar = (e: ClipboardEvent) => {
      const arquivos = [...(e.clipboardData?.files ?? [])]
      if (!arquivos.length) return
      e.preventDefault()
      incluirRef.current(
        arquivos.map((f, i) =>
          f.name && !/^image\.\w+$/i.test(f.name)
            ? f
            : new File([f], `Foto colada${i ? ` ${i + 1}` : ''}.${EXTENSAO[f.type] ?? 'png'}`, { type: f.type }),
        ),
      )
    }
    window.addEventListener('paste', aoColar)
    return () => window.removeEventListener('paste', aoColar)
  }, [aberto])

  const ocupado = etapa !== 'escolher'
  const fotos = escolhidos.filter((e) => e.tipo !== 'application/pdf')
  const variasFotos = fotos.length > 1
  const fotoQueNaoJunta = variasFotos && fotos.some((f) => !fotoComum(f.tipo))
  const aguardando = contrato?.status === 'AGUARDANDO'

  const enviar = async () => {
    if (!contrato || !escolhidos.length || fotoQueNaoJunta) return
    setErro(null)
    try {
      let arquivo: File
      if (variasFotos) {
        setEtapa('juntando')
        arquivo = await juntarFotos(
          fotos.map((f) => f.arquivo),
          nomeAssinado(contrato.numero, 'pdf'),
        )
        if (arquivo.size > LIMITE_ANEXO) throw new Error('As fotos juntas passaram de 25 MB: envie menos páginas ou um PDF.')
      } else {
        const [unico] = escolhidos
        arquivo = new File([unico.arquivo], nomeAssinado(contrato.numero, EXTENSAO[unico.tipo] ?? 'pdf'), { type: unico.tipo })
      }
      setEtapa('enviando')
      setProgresso(0)
      const salvo = await enviarContratoAssinado(contrato.id, arquivo, arquivo.name, setProgresso)
      toast.sucesso(
        aguardando ? `Contrato ${codigoContrato(salvo.numero)} assinado` : 'Cópia assinada anexada',
        aguardando ? `${arquivo.name} • assinado em ${dataCurta(salvo.assinadoEm)}` : arquivo.name,
      )
      aoFechar()
    } catch (e) {
      setEtapa('escolher')
      setErro(e instanceof Error ? e.message : 'Erro inesperado.')
      avisarErro('Não foi possível anexar o contrato assinado', e)
    }
  }

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
      if (!ocupado) incluir([...e.dataTransfer.files])
    },
  }

  const pct = Math.round(progresso * 100)

  return (
    <Modal
      aberto={aberto}
      aoFechar={ocupado ? () => {} : aoFechar}
      largura="max-w-xl"
      icone={<Paperclip className="h-5 w-5" />}
      titulo="Anexar contrato assinado"
      descricao={contrato && `Contrato ${codigoContrato(contrato.numero)} • ${nomeClienteContrato(contrato, clientes)}`}
      rodape={
        <>
          <Button onClick={aoFechar} disabled={ocupado} className="max-sm:hidden">
            Cancelar
          </Button>
          <Button
            variante="primary"
            icone={ocupado ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            onClick={() => void enviar()}
            disabled={ocupado || !escolhidos.length || fotoQueNaoJunta}
            className="max-sm:flex-1"
          >
            {etapa === 'juntando'
              ? 'Juntando as fotos…'
              : etapa === 'enviando'
                ? `Enviando… ${pct}%`
                : aguardando
                  ? 'Anexar e marcar como assinado'
                  : 'Anexar'}
          </Button>
        </>
      }
    >
      <div className="relative flex flex-col gap-4" {...arrastar}>
        <input
          ref={entrada}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            incluir([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            incluir([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />

        {contrato?.arquivo && (
          <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-2.5 text-[13px] text-info">
            <Paperclip className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Substitui a cópia anexada em {dataCurta(contrato.arquivo.enviadoEm.slice(0, 10))} (“{contrato.arquivo.nome}”).
            </span>
          </p>
        )}

        {/* Área para soltar ou escolher (grande enquanto nada foi escolhido) */}
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={ocupado}
          className={cn(
            'group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong text-left transition-colors',
            'hover:border-brand hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            'disabled:cursor-wait disabled:opacity-60',
            escolhidos.length ? 'px-3.5 py-2.5' : 'flex-col justify-center px-5 py-8 text-center',
          )}
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center bg-brand-soft text-brand-ink transition-transform group-hover:scale-105',
              escolhidos.length ? 'h-8 w-8 rounded-lg' : 'h-11 w-11 rounded-xl',
            )}
          >
            <Upload className={escolhidos.length ? 'h-4 w-4' : 'h-5 w-5'} />
          </span>
          <span className="min-w-0">
            <span className={cn('block font-medium text-ink', escolhidos.length ? 'text-[13px]' : 'text-sm')}>
              {escolhidos.length ? (
                fotos.length ? (
                  'Escolher mais fotos (uma por página)'
                ) : (
                  'Escolher outro arquivo'
                )
              ) : (
                <>
                  <span className="max-sm:hidden">Arraste a foto ou o PDF para cá, ou clique para escolher</span>
                  <span className="sm:hidden">Toque para escolher a foto ou o PDF</span>
                </>
              )}
            </span>
            <span className={cn('block text-xs text-muted', !escolhidos.length && 'mt-1 max-w-sm')}>
              <span className="max-sm:hidden">
                <Tecla>Ctrl</Tecla> + <Tecla>V</Tecla> cola uma foto copiada •{' '}
              </span>
              PDF ou foto, até 25 MB. Várias fotos viram um PDF só.
            </span>
          </span>
        </button>

        <Button
          variante="soft"
          icone={<Camera className="h-4 w-4" />}
          onClick={() => camera.current?.click()}
          disabled={ocupado}
          className="sm:hidden"
        >
          Tirar foto do contrato
        </Button>

        {escolhidos.length > 0 && (
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {escolhidos.map((e, i) => (
                <motion.li
                  key={e.chave}
                  layout="position"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pr-1.5 pl-2"
                >
                  <Miniatura escolhido={e} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink" title={e.arquivo.name}>
                      {variasFotos ? `Página ${i + 1}` : e.arquivo.name}
                    </span>
                    <span className="tnum block truncate text-xs text-muted">
                      {variasFotos ? `${e.arquivo.name} • ` : ''}
                      {e.tipo === 'application/pdf' ? 'PDF' : 'Foto'} • {tamanhoLegivel(e.arquivo.size)}
                    </span>
                  </span>
                  <Button
                    variante="ghost"
                    tamanho="icon-sm"
                    onClick={() => setEscolhidos((l) => l.filter((x) => x.chave !== e.chave))}
                    disabled={ocupado}
                    aria-label={`Tirar ${e.arquivo.name}`}
                    title="Tirar"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {variasFotos && !fotoQueNaoJunta && (
          <p className="text-xs text-muted">
            As {fotos.length} fotos vão num PDF só, nesta ordem (uma por página): “{nomeAssinado(contrato?.numero ?? 0, 'pdf')}”.
          </p>
        )}

        {fotoQueNaoJunta && (
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Fotos HEIC (do iPhone) não dá para juntar aqui: envie uma foto só, um PDF, ou fotos em JPG.
          </p>
        )}

        {etapa === 'enviando' && (
          <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct}>
            <motion.span
              className="block h-full rounded-full bg-brand"
              initial={false}
              animate={{ width: `${Math.max(3, pct)}%` }}
              transition={{ duration: 0.2 }}
            />
          </span>
        )}

        {erro && <p className="text-[13px] font-medium break-words text-danger">{erro}</p>}

        <p className="text-xs leading-relaxed text-muted">
          {aguardando
            ? 'Ao anexar, o contrato passa a assinado (com a data de hoje). '
            : contrato?.status === 'ASSINADO'
              ? 'O contrato continua assinado. '
              : ''}
          Assinado pelo gov.br? Anexe o PDF que o cliente devolveu.
        </p>

        {/* Arrastando arquivos sobre a janela */}
        <AnimatePresence>
          {arrastando && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute -inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-surface/90 backdrop-blur-[2px]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-md">
                <Upload className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-ink">Solte para anexar</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}

function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1 py-px font-sans text-[11px] font-medium text-ink-2">
      {children}
    </kbd>
  )
}

/** Miniatura da foto escolhida (endereço temporário, liberado ao sair) ou o ícone do PDF. */
function Miniatura({ escolhido }: { escolhido: Escolhido }) {
  const img = useRef<HTMLImageElement>(null)
  const foto = fotoComum(escolhido.tipo)
  useEffect(() => {
    if (!foto) return
    const url = URL.createObjectURL(escolhido.arquivo)
    if (img.current) img.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [foto, escolhido.arquivo])
  if (foto) {
    return (
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
        <img ref={img} alt="" className="h-full w-full object-cover" />
      </span>
    )
  }
  const pdf = escolhido.tipo === 'application/pdf'
  return (
    <span
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
        pdf ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info',
      )}
    >
      {pdf ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
    </span>
  )
}
