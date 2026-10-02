// Lista de serviços de manutenção cadastrados pelo usuário (ex.: "Troca de cabeçote"): são as
// opções para marcar no formulário de manutenção. Começa vazia; cada alteração já fica gravada.

import { Check, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { chaveServico } from '#shared/maquinas.ts'
import { cn } from '../lib/cn'
import { adicionarServico, renomearServico, usoDosServicos, type ResultadoServico } from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { Input } from './ui/Form'
import { Modal } from './ui/Modal'

/** Exemplos oferecidos com um clique enquanto a lista está vazia. */
const EXEMPLOS = ['Troca de cabeçote', 'Higienização', 'Revisão']

export function ServicosManutencaoModal({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-lg"
      icone={<ListChecks className="h-5 w-5" />}
      titulo="Serviços cadastrados"
      descricao="Os serviços que aparecem para marcar nas manutenções. Renomear ou remover não muda as manutenções já registradas."
      rodape={<Button onClick={aoFechar}>Fechar</Button>}
    >
      <ListaServicos />
    </Modal>
  )
}

function ListaServicos() {
  const servicos = useDados((s) => s.config.servicosManutencao)
  const ordens = useDados((s) => s.ordens)
  const salvarServicos = useDados((s) => s.salvarServicos)
  const uso = useMemo(() => usoDosServicos(ordens), [ordens])

  const [novo, setNovo] = useState('')
  const [erroNovo, setErroNovo] = useState<string | null>(null)
  /** Serviço em edição (pelo nome, que não muda de posição se outra pessoa mexer na lista). */
  const [editando, setEditando] = useState<{ original: string; texto: string; erro: string | null } | null>(null)
  const [salvando, setSalvando] = useState(false)

  /** Grava a lista; devolve se deu certo. */
  const gravar = async (r: ResultadoServico, mensagem: (nome: string) => [string, string?]) => {
    if ('erro' in r) return false
    setSalvando(true)
    try {
      await salvarServicos(r.lista)
      toast.sucesso(...mensagem(r.nome))
      return true
    } catch (e) {
      avisarErro('Não foi possível salvar a lista de serviços', e)
      return false
    } finally {
      setSalvando(false)
    }
  }

  // A lista é sempre lida na hora de gravar: outra pessoa pode ter mexido nela enquanto isso
  const atual = () => useDados.getState().config.servicosManutencao

  const adicionar = async (nome = novo) => {
    if (salvando) return
    const r = adicionarServico(atual(), nome)
    if ('erro' in r) return void (nome === novo ? setErroNovo(r.erro) : toast.erro(r.erro))
    // Uma sugestão clicada não apaga o que estiver digitado no campo
    if ((await gravar(r, (n) => ['Serviço cadastrado', n])) && nome === novo) {
      setNovo('')
      setErroNovo(null)
    }
  }

  const salvarEdicao = async () => {
    if (!editando || salvando) return
    const lista = atual()
    const i = lista.indexOf(editando.original)
    if (i === -1) {
      setEditando(null)
      return void toast.erro('Este serviço foi alterado por outra pessoa', 'Confira a lista e tente de novo.')
    }
    if (editando.texto.trim() === editando.original) return setEditando(null)
    const r = renomearServico(lista, i, editando.texto)
    if ('erro' in r) return void setEditando({ ...editando, erro: r.erro })
    if (await gravar(r, (n) => ['Serviço renomeado', `“${editando.original}” agora é “${n}”.`])) setEditando(null)
  }

  const remover = async (nome: string) => {
    if (salvando) return
    const lista = atual()
    if (!lista.includes(nome)) return
    const usado = uso.get(chaveServico(nome)) ?? 0
    await gravar({ lista: lista.filter((s) => s !== nome), nome }, (n) => [
      'Serviço removido da lista',
      usado ? `As manutenções que já têm “${n}” continuam com ele.` : n,
    ])
  }

  const teclaEdicao = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void salvarEdicao()
    } else if (e.key === 'Escape') {
      // Esc cancela só a edição, sem fechar a janela
      e.stopPropagation()
      setEditando(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="servico-novo" className="text-[13px] font-medium text-ink-2">
          Novo serviço
        </label>
        <div className="flex gap-2">
          <Input
            id="servico-novo"
            value={novo}
            onChange={(e) => {
              setNovo(e.target.value)
              setErroNovo(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void adicionar()
              }
            }}
            placeholder="Ex.: Troca de cabeçote"
            maxLength={60}
            autoComplete="off"
            aria-invalid={!!erroNovo}
            className={cn('flex-1', erroNovo && 'border-danger! focus:ring-danger/20!')}
          />
          <Button
            variante="primary"
            icone={<Plus className="h-4 w-4" />}
            onClick={() => void adicionar()}
            disabled={!novo.trim() || salvando}
          >
            Adicionar
          </Button>
        </div>
        {erroNovo && (
          <p className="text-xs font-medium text-danger" role="alert">
            {erroNovo}
          </p>
        )}
      </div>

      {servicos.length ? (
        <div>
          <p className="mb-1.5 text-xs text-muted">
            {servicos.length} {servicos.length === 1 ? 'serviço cadastrado' : 'serviços cadastrados'}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            <AnimatePresence initial={false}>
              {servicos.map((s) => {
                const usado = uso.get(chaveServico(s)) ?? 0
                const emEdicao = editando?.original === s
                return (
                  <motion.li
                    key={s}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {emEdicao ? (
                      <div className="flex flex-col gap-1 bg-surface-2/60 px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Input
                            autoFocus
                            aria-label={`Novo nome para “${s}”`}
                            value={editando.texto}
                            onChange={(e) => setEditando({ ...editando, texto: e.target.value, erro: null })}
                            onKeyDown={teclaEdicao}
                            maxLength={60}
                            aria-invalid={!!editando.erro}
                            className={cn('h-9 flex-1', editando.erro && 'border-danger! focus:ring-danger/20!')}
                          />
                          <Button
                            variante="primary"
                            tamanho="icon-sm"
                            onClick={() => void salvarEdicao()}
                            disabled={!editando.texto.trim() || salvando}
                            aria-label="Salvar o novo nome"
                            title="Salvar"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variante="ghost"
                            tamanho="icon-sm"
                            onClick={() => setEditando(null)}
                            aria-label="Cancelar"
                            title="Cancelar"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {editando.erro && (
                          <p className="text-xs font-medium text-danger" role="alert">
                            {editando.erro}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="group flex min-h-12 items-center gap-2 py-1.5 pr-1.5 pl-3.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{s}</span>
                          <span className="block text-xs text-muted">
                            {usado ? `Usado em ${usado} ${usado === 1 ? 'manutenção' : 'manutenções'}` : 'Ainda não usado'}
                          </span>
                        </span>
                        <Button
                          variante="ghost"
                          tamanho="icon-sm"
                          onClick={() => setEditando({ original: s, texto: s, erro: null })}
                          disabled={salvando}
                          aria-label={`Renomear “${s}”`}
                          title="Renomear"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variante="ghost"
                          tamanho="icon-sm"
                          onClick={() => void remover(s)}
                          disabled={salvando}
                          aria-label={`Remover “${s}” da lista`}
                          title="Remover da lista"
                          className="hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-5 py-7 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
            <ListChecks className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">Nenhum serviço cadastrado</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            Cadastre os serviços que você costuma fazer, ex.: Troca de cabeçote, Higienização, Revisão. Se aparecer um serviço
            diferente, cadastre na hora e ele fica na lista.
          </p>
          {/* Atalho para começar: um clique cadastra o exemplo (nada vem cadastrado sozinho) */}
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {EXEMPLOS.map((ex) => (
              <button
                type="button"
                key={ex}
                onClick={() => void adicionar(ex)}
                disabled={salvando}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand/50 hover:bg-brand-soft hover:text-brand-ink disabled:cursor-wait"
              >
                <Plus className="h-3 w-3" />
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
