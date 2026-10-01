import { CalendarPlus, Download, Ellipsis, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClienteFormModal } from '../components/ClienteFormModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { Select } from '../components/ui/Form'
import { Avatar, EmptyState, Menu, PageHeader, SearchInput, Segmented } from '../components/ui/Misc'
import { Linha, Tabela, Td, Th } from '../components/ui/Table'
import { exportarCSV } from '../lib/csv'
import { dataCurta, moeda, normalizar, numero } from '../lib/format'
import { useEventosCompletos } from '../lib/hooks'
import type { Cliente } from '#shared/tipos.ts'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'

type Ordem = 'nome' | 'faturado' | 'recente'

export function Clientes() {
  const clientes = useDados((s) => s.clientes)
  const excluirCliente = useDados((s) => s.excluirCliente)
  const eventos = useEventosCompletos()
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()

  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<'todos' | 'PJ' | 'PF'>('todos')
  const [ordem, setOrdem] = useState<Ordem>('nome')
  const [modalLocal, setModal] = useState<{ aberto: boolean; cliente?: Cliente }>({ aberto: false })
  // `?novo=1` (vindo do painel ou da busca global) abre o cadastro direto
  const modal = params.get('novo') === '1' ? { aberto: true } : modalLocal
  const fecharModal = () => {
    setModal({ aberto: false })
    if (params.has('novo')) setParams({}, { replace: true })
  }

  const estat = useMemo(() => {
    const m = new Map<string, { qtd: number; faturado: number; ultimo: string | null }>()
    for (const { evento, resumo } of eventos) {
      const s = m.get(evento.clienteId) ?? { qtd: 0, faturado: 0, ultimo: null }
      s.qtd++
      if (evento.status !== 'CANCELADO') s.faturado += resumo.total
      if (resumo.dataInicio && (!s.ultimo || resumo.dataInicio > s.ultimo)) s.ultimo = resumo.dataInicio
      m.set(evento.clienteId, s)
    }
    return m
  }, [eventos])

  const lista = useMemo(() => {
    const q = normalizar(busca)
    const vazio = { qtd: 0, faturado: 0, ultimo: null }
    return clientes
      .filter((c) => tipo === 'todos' || c.tipo === tipo)
      .filter(
        (c) => !q || normalizar(`${c.nome} ${c.documento} ${c.responsavel} ${c.cidade} ${c.telefone} ${c.email}`).includes(q),
      )
      .map((c) => ({ c, s: estat.get(c.id) ?? vazio }))
      .sort((a, b) => {
        if (ordem === 'faturado') return b.s.faturado - a.s.faturado
        if (ordem === 'recente') return (b.s.ultimo ?? '').localeCompare(a.s.ultimo ?? '')
        return a.c.nome.localeCompare(b.c.nome, 'pt-BR')
      })
  }, [clientes, busca, tipo, ordem, estat])

  const excluir = async (c: Cliente) => {
    const ok = await confirmar({
      titulo: `Excluir ${c.nome}?`,
      descricao: 'Esta ação não pode ser desfeita.',
      confirmar: 'Excluir cliente',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirCliente(c.id)
      toast.sucesso('Cliente excluído')
    } catch (e) {
      avisarErro('Não foi possível excluir', e)
    }
  }

  const exportar = () => {
    exportarCSV(
      'clientes.csv',
      ['Nome', 'Tipo', 'CPF/CNPJ', 'Responsável', 'Telefone', 'E-mail', 'Cidade', 'UF', 'Eventos', 'Total faturado'],
      lista.map(({ c, s }) => [
        c.nome,
        c.tipo,
        c.documento,
        c.responsavel,
        c.telefone,
        c.email,
        c.cidade,
        c.uf,
        s.qtd,
        s.faturado,
      ]),
    )
  }

  return (
    <>
      <PageHeader
        titulo="Clientes"
        descricao={`${numero(clientes.length)} ${clientes.length === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}`}
        acoes={
          <>
            <Button icone={<Download className="h-4 w-4" />} onClick={exportar} disabled={!lista.length}>
              Exportar
            </Button>
            <Button variante="primary" icone={<Plus className="h-4 w-4" />} onClick={() => setModal({ aberto: true })}>
              Novo cliente
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
          <SearchInput valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, documento, cidade…" className="md:w-80" />
          <Segmented
            valor={tipo}
            aoMudar={setTipo}
            opcoes={[
              { valor: 'todos', label: 'Todos' },
              { valor: 'PJ', label: 'Empresas' },
              { valor: 'PF', label: 'Pessoas' },
            ]}
          />
          <div className="md:ml-auto md:w-52">
            <Select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar por">
              <option value="nome">Ordenar: nome (A–Z)</option>
              <option value="faturado">Ordenar: maior faturamento</option>
              <option value="recente">Ordenar: evento mais recente</option>
            </Select>
          </div>
        </div>

        {lista.length === 0 ? (
          <EmptyState
            icone={<Users className="h-6 w-6" />}
            titulo={clientes.length ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            descricao={
              clientes.length
                ? 'Tente ajustar a busca ou os filtros.'
                : 'Cadastre seu primeiro cliente para começar a lançar eventos.'
            }
            acao={
              !clientes.length && (
                <Button variante="primary" icone={<Plus className="h-4 w-4" />} onClick={() => setModal({ aberto: true })}>
                  Cadastrar cliente
                </Button>
              )
            }
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th className="max-md:hidden">Contato</Th>
                <Th className="max-lg:hidden">Cidade</Th>
                <Th alinhar="right">Eventos</Th>
                <Th alinhar="right">Faturado</Th>
                <Th className="max-sm:hidden">Último evento</Th>
                <Th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {lista.map(({ c, s }, i) => (
                <Linha key={c.id} indice={i} aoClicar={() => navegar(`/clientes/${c.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar nome={c.nome} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{c.nome}</p>
                        <p className="truncate text-xs text-muted">
                          {c.documento || (c.tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física')}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="max-md:hidden">
                    <p className="truncate text-ink-2">{c.responsavel || '—'}</p>
                    <p className="truncate text-xs text-muted">{c.telefone}</p>
                  </Td>
                  <Td className="max-lg:hidden">{c.cidade ? `${c.cidade}${c.uf ? ` / ${c.uf}` : ''}` : '—'}</Td>
                  <Td alinhar="right">{s.qtd}</Td>
                  <Td alinhar="right" className="font-medium text-ink">
                    {moeda(s.faturado)}
                  </Td>
                  <Td className="tnum max-sm:hidden">{dataCurta(s.ultimo)}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Menu
                      gatilho={(abrir) => (
                        <Button variante="ghost" tamanho="icon-sm" onClick={abrir} aria-label="Ações">
                          <Ellipsis className="h-4 w-4" />
                        </Button>
                      )}
                      itens={[
                        {
                          label: 'Editar',
                          icone: <Pencil className="h-4 w-4" />,
                          aoClicar: () => setModal({ aberto: true, cliente: c }),
                        },
                        {
                          label: 'Novo evento',
                          icone: <CalendarPlus className="h-4 w-4" />,
                          aoClicar: () => navegar(`/eventos/novo?cliente=${c.id}`),
                        },
                        'sep',
                        { label: 'Excluir', icone: <Trash2 className="h-4 w-4" />, aoClicar: () => excluir(c), perigo: true },
                      ]}
                    />
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
        )}
      </Card>

      <ClienteFormModal aberto={modal.aberto} cliente={'cliente' in modal ? modal.cliente : undefined} aoFechar={fecharModal} />
    </>
  )
}
