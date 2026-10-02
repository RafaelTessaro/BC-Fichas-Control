import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { normalizar } from '../../lib/format'

export interface OpcaoCombo {
  valor: string
  label: string
  detalhe?: string
  icone?: ReactNode
}

/** Ação exibida no rodapé da lista (ex.: "Cadastrar novo cliente"). Recebe o texto digitado na busca. */
export interface AcaoCombo {
  /** Texto fixo, ou montado a partir do texto digitado. */
  label: ReactNode | ((busca: string) => ReactNode)
  aoClicar: (busca: string) => void
  icone?: ReactNode
  /** Esconde a ação conforme o texto digitado (ex.: só com algo digitado). */
  visivel?: (busca: string) => boolean
}

/**
 * Seleção com busca e navegação por teclado (↑ ↓ Home End Enter Esc), incluindo as ações do rodapé.
 * Digitar com o campo fechado já abre a lista buscando pelo texto.
 * Segue o padrão ARIA de combobox: a busca aponta o item ativo (`aria-activedescendant`) e, ao
 * escolher ou fechar, o foco volta ao botão do campo.
 */
export function Combobox({
  opcoes,
  valor,
  aoMudar,
  placeholder = 'Selecione…',
  vazio = 'Nada encontrado',
  acaoCriar,
  acoes: acoesExtras,
  id,
  invalido,
}: {
  opcoes: OpcaoCombo[]
  valor: string
  aoMudar: (v: string) => void
  placeholder?: string
  vazio?: string
  /** Ação de criação (mostra o texto digitado ao lado). Mantida por compatibilidade; equivale a uma entrada de `acoes`. */
  acaoCriar?: { label: string; aoClicar: (texto: string) => void }
  acoes?: AcaoCombo[]
  id?: string
  invalido?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  // Lido pelos cliques: a lista que está saindo (animação de 140 ms) continua na tela com os
  // handlers antigos, e um segundo clique nela não pode escolher ou executar de novo
  const abertoRef = useRef(false)
  const base = useId()
  const idLista = `${base}-lista`
  const idItem = (i: number) => `${base}-item-${i}`

  const selecionada = opcoes.find((o) => o.valor === valor)
  const filtradas = useMemo(() => {
    const q = normalizar(busca)
    if (!q) return opcoes
    return opcoes.filter((o) => normalizar(`${o.label} ${o.detalhe ?? ''}`).includes(q))
  }, [opcoes, busca])

  const acoes = useMemo(() => {
    const todas: AcaoCombo[] = []
    if (acaoCriar) {
      todas.push({
        label: (b) => (
          <>
            {acaoCriar.label}
            {b && <span className="truncate text-muted">“{b}”</span>}
          </>
        ),
        aoClicar: acaoCriar.aoClicar,
      })
    }
    todas.push(...(acoesExtras ?? []))
    return todas.filter((a) => !a.visivel || a.visivel(busca.trim()))
  }, [acaoCriar, acoesExtras, busca])
  const totalItens = filtradas.length + acoes.length

  /** Fecha a lista; por padrão devolve o foco ao botão do campo (em vez de deixá-lo cair no <body>). */
  const fechar = (devolverFoco = true) => {
    abertoRef.current = false
    setAberto(false)
    if (devolverFoco) botao.current?.focus()
  }

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) fechar(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  // Foco na busca logo que a lista aparece (antes do próximo quadro), para a primeira tecla
  // digitada depois do clique não se perder
  useLayoutEffect(() => {
    if (aberto) input.current?.focus()
  }, [aberto])

  const abrir = () => {
    setBusca('')
    setAtivo(
      Math.max(
        0,
        opcoes.findIndex((o) => o.valor === valor),
      ),
    )
    abertoRef.current = true
    setAberto(true)
  }

  const escolher = (o: OpcaoCombo) => {
    if (!abertoRef.current) return
    fechar()
    aoMudar(o.valor)
  }

  const executar = (a: AcaoCombo, texto: string) => {
    if (!abertoRef.current) return
    // Devolve o foco antes, para que um modal aberto pela ação possa pegá-lo
    fechar()
    a.aoClicar(texto)
  }

  const itemAtivo = totalItens > 0 ? idItem(Math.min(ativo, totalItens - 1)) : undefined

  return (
    <div
      ref={raiz}
      className="relative"
      onBlur={(e) => {
        // O foco ir para fora (clique em outro lugar, atalho do navegador) fecha a lista
        if (abertoRef.current && !raiz.current?.contains(e.relatedTarget as Node | null)) fechar(false)
      }}
      onKeyDown={(e) => {
        if (!abertoRef.current) return
        if (e.key === 'Escape') {
          // Vale com o foco na busca ou no botão do campo; não deixa o Esc fechar o modal em volta
          e.stopPropagation()
          fechar()
        } else if (e.key === 'Tab' && (e.shiftKey || e.target !== botao.current)) {
          // Sair da busca com Tab ou Shift+Tab fecha a lista e o foco segue o caminho normal (Shift+Tab
          // para no botão do campo). Só o Tab do botão para a busca, logo abaixo, mantém a lista aberta
          fechar(false)
        }
      }}
    >
      <button
        ref={botao}
        id={id}
        type="button"
        // Com a lista aberta, o clique só fecha: não tira o foco da busca antes (Safari não foca botões)
        onMouseDown={(e) => aberto && e.preventDefault()}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={(e) => {
          // Começar a digitar com o campo fechado abre a lista já buscando pelo que foi digitado
          if (aberto || e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
          e.preventDefault()
          abrir()
          setBusca(e.key)
        }}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        className={cn(
          'flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl border bg-surface px-3.5 text-left text-sm shadow-xs transition-[border-color,box-shadow]',
          aberto ? 'border-brand ring-4 ring-[var(--ring)]' : 'border-line-strong/80 hover:border-line-strong',
          invalido && !aberto && 'border-danger!',
        )}
      >
        {selecionada?.icone}
        <span className={cn('min-w-0 flex-1 truncate', selecionada ? 'text-ink' : 'text-muted/80')}>
          {selecionada?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" />
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, pointerEvents: 'none' }}
            transition={{ duration: 0.14 }}
            className="absolute top-full right-0 left-0 z-40 mt-1.5 origin-top overflow-hidden rounded-xl border border-line bg-surface shadow-float"
            // Clique em qualquer parte do painel (item, margem, aviso de "nada encontrado") mantém o foco
            // na busca: a lista não fecha nem perde o texto digitado. Só a própria busca recebe o clique,
            // para posicionar o cursor
            onMouseDown={(e) => e.target !== input.current && e.preventDefault()}
          >
            <div className="border-b border-line p-2">
              <input
                ref={input}
                role="combobox"
                aria-expanded={true}
                aria-controls={idLista}
                aria-autocomplete="list"
                aria-activedescendant={itemAtivo}
                aria-label="Buscar"
                autoComplete="off"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setAtivo(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setAtivo((a) => Math.min(a + 1, totalItens - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setAtivo((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Home' || e.key === 'End') {
                    if (!totalItens) return
                    e.preventDefault()
                    setAtivo(e.key === 'Home' ? 0 : totalItens - 1)
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (filtradas[ativo]) escolher(filtradas[ativo])
                    else if (acoes[ativo - filtradas.length]) executar(acoes[ativo - filtradas.length], busca.trim())
                  }
                }}
                placeholder="Digite para buscar…"
                className="h-9 w-full rounded-lg bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-muted"
              />
            </div>
            {filtradas.length === 0 && (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted">
                {vazio}
              </p>
            )}
            {/* Opções e ações ficam na mesma lista, para o leitor de tela anunciar o item que o Enter vai usar */}
            <div ref={lista} id={idLista} role="listbox" aria-label={placeholder}>
              {filtradas.length > 0 && (
                // tabIndex -1: o Chrome torna focável um contêiner rolável sem itens focáveis, e o Tab
                // pararia nele em vez de sair do campo
                <div role="group" tabIndex={-1} className="scroll-fino max-h-64 overflow-y-auto p-1">
                  {filtradas.map((o, i) => (
                    <button
                      key={o.valor}
                      id={idItem(i)}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      data-idx={i}
                      aria-selected={i === ativo}
                      aria-current={o.valor === valor || undefined}
                      onMouseEnter={() => setAtivo(i)}
                      onClick={() => escolher(o)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        i === ativo ? 'bg-surface-2 text-ink' : 'text-ink-2',
                      )}
                    >
                      {o.icone}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{o.label}</span>
                        {o.detalhe && <span className="block truncate text-xs text-muted">{o.detalhe}</span>}
                      </span>
                      {o.valor === valor && <Check className="h-4 w-4 shrink-0 text-brand" />}
                    </button>
                  ))}
                </div>
              )}
              {acoes.length > 0 && (
                <div role="group" aria-label="Outras opções" className="border-t border-line p-1">
                  {acoes.map((a, i) => {
                    const idx = filtradas.length + i
                    return (
                      <button
                        key={i}
                        id={idItem(idx)}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        data-idx={idx}
                        aria-selected={idx === ativo}
                        onMouseEnter={() => setAtivo(idx)}
                        onClick={() => executar(a, busca.trim())}
                        className={cn(
                          'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand-ink transition-colors',
                          idx === ativo ? 'bg-brand-soft' : 'hover:bg-brand-soft',
                        )}
                      >
                        <span className="shrink-0">{a.icone ?? <Plus className="h-4 w-4" />}</span>
                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                          {typeof a.label === 'function' ? a.label(busca.trim()) : a.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
