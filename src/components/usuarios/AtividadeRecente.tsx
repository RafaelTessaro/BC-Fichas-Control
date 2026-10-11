import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowUpRight,
  Ban,
  DatabaseBackup,
  History,
  KeyRound,
  LogIn,
  LogOut,
  MonitorOff,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldX,
  Terminal,
  Trash2,
  UserPen,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AcaoAuditoria, GrupoAuditoria, RegistroAuditoria, Usuario } from '#shared/tipos.ts'
import { ROTULO_GRUPO_AUDITORIA } from '#shared/usuarios.ts'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { cap } from '../../lib/format'
import { useDados } from '../../store/dados'
import { Button } from '../ui/Button'
import { Card, CardHeader } from '../ui/Card'
import { Select } from '../ui/Form'
import { Segmented } from '../ui/Misc'
import { autorDoRegistro, descreverRegistro, enderecoDoLink, grupoDaAcao, metodoDoRegistro, type TipoLink } from './auditoria'

const POR_PAGINA = 50
const NENHUM: RegistroAuditoria[] = []

const ICONE_ACAO: Partial<Record<AcaoAuditoria, LucideIcon>> = {
  LOGIN: LogIn,
  LOGIN_FALHOU: ShieldAlert,
  BLOQUEIO: ShieldX,
  LOGOUT: LogOut,
  ACESSO_NEGADO: Ban,
  SENHA_TROCADA: KeyRound,
  SENHA_REDEFINIDA: KeyRound,
  USUARIO_CRIADO: UserPlus,
  USUARIO_ALTERADO: UserPen,
  USUARIO_EXCLUIDO: UserX,
  SESSOES_ENCERRADAS: MonitorOff,
  FERRAMENTA_LOCAL: Terminal,
}

/** Cor do ícone: alertas em vermelho/amarelo; o resto pelo grupo. */
function tomDoRegistro(r: RegistroAuditoria): string {
  if (r.acao === 'BLOQUEIO' || r.acao === 'ACESSO_NEGADO' || r.acao === 'DADOS_APAGADOS') return 'bg-danger-soft text-danger'
  if (r.acao === 'LOGIN_FALHOU') return 'bg-warning-soft text-warning'
  const grupo = grupoDaAcao(r.acao)
  if (grupo === 'acessos') return 'bg-success-soft text-success'
  if (grupo === 'usuarios') return 'bg-brand-soft text-brand-ink'
  if (grupo === 'dados') return 'bg-warning-soft text-warning'
  return 'bg-info-soft text-info'
}

function iconeDoRegistro(r: RegistroAuditoria): LucideIcon {
  const icone = ICONE_ACAO[r.acao]
  if (icone) return icone
  if (grupoDaAcao(r.acao) === 'dados') return r.acao === 'DADOS_APAGADOS' ? Trash2 : DatabaseBackup
  const metodo = metodoDoRegistro(r)
  return metodo === 'DELETE' ? Trash2 : metodo === 'POST' ? Plus : Pencil
}

function rotuloDia(iso: string) {
  const d = parseISO(iso)
  if (isToday(d)) return 'Hoje'
  if (isYesterday(d)) return 'Ontem'
  return cap(format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR }))
}

/**
 * "Atividade recente": o registro de acessos e alterações (`GET /api/auditoria`), do mais novo para o
 * mais antigo, 50 por vez, com filtros por grupo e por usuário.
 */
export function AtividadeRecente({ usuarios, atualizar }: { usuarios: Usuario[]; atualizar: number }) {
  const [grupo, setGrupo] = useState<GrupoAuditoria | 'todos'>('todos')
  const [usuarioId, setUsuarioId] = useState('')
  /** Busca manual ou volta para a janela: mais uma rodada com os mesmos filtros. */
  const [rodada, setRodada] = useState(0)
  /** O que está na tela vale para esta chave (filtros + rodada + ações na página). */
  const filtros = `${grupo}|${usuarioId}`
  const chave = `${filtros}|${atualizar}|${rodada}`
  const [lista, setLista] = useState<{
    chave: string
    filtros: string
    registros: RegistroAuditoria[]
    maisAntigos: boolean
    erro: string
    paginas: number
  } | null>(null)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erroMais, setErroMais] = useState('')
  const carregando = lista?.chave !== chave
  const registros = lista?.registros ?? NENHUM
  const maisAntigos = !!lista?.maisAntigos
  const erro = lista?.erro ?? ''
  const filtro = useMemo(
    () => ({ grupo: grupo === 'todos' ? undefined : grupo, usuarioId: usuarioId || undefined, limite: POR_PAGINA }),
    [grupo, usuarioId],
  )

  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const maquinas = useDados((s) => s.maquinas)
  const contratos = useDados((s) => s.contratos)
  const existe = useMemo(() => {
    const ids: Record<TipoLink, Set<string>> = {
      evento: new Set(eventos.map((e) => e.id)),
      cliente: new Set(clientes.map((c) => c.id)),
      maquina: new Set(maquinas.map((m) => m.id)),
      contrato: new Set(contratos.map((c) => c.id)),
    }
    return (tipo: TipoLink, id: string) => ids[tipo].has(id)
  }, [eventos, clientes, maquinas, contratos])
  const nomes = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome])), [usuarios])

  // Primeira página: ao abrir, ao trocar o filtro, depois de cada ação na página e a cada rodada
  useEffect(() => {
    let valendo = true
    api.auditoria(filtro).then(
      (r) => {
        if (!valendo) return
        setLista({ chave, filtros, registros: r.registros, maisAntigos: r.registros.length === POR_PAGINA, erro: '', paginas: 1 })
        setErroMais('')
      },
      (e: unknown) => {
        if (!valendo) return
        const erro = e instanceof Error ? e.message : 'Erro inesperado.'
        // Com os mesmos filtros, o que já estava na tela continua (o erro aparece embaixo)
        setLista((l) =>
          l && l.filtros === filtros
            ? { ...l, chave, erro }
            : { chave, filtros, registros: [], maisAntigos: false, erro, paginas: 1 },
        )
      },
    )
    return () => {
      valendo = false
    }
  }, [chave, filtros, filtro])

  const atualizarLista = useCallback(() => setRodada((r) => r + 1), [])

  // Volta para a janela: mostra o que aconteceu enquanto isso (se a pessoa não estiver lendo páginas antigas)
  const lendoAntigos = (lista?.paginas ?? 1) > 1
  useEffect(() => {
    if (lendoAntigos) return
    window.addEventListener('focus', atualizarLista)
    return () => window.removeEventListener('focus', atualizarLista)
  }, [lendoAntigos, atualizarLista])

  const carregarMais = async () => {
    const ultimo = registros[registros.length - 1]
    if (!ultimo || carregandoMais) return
    const chaveAtual = chave
    setCarregandoMais(true)
    setErroMais('')
    try {
      const r = await api.auditoria({ ...filtro, antes: ultimo.id })
      setLista((l) =>
        l && l.chave === chaveAtual
          ? {
              ...l,
              registros: [...l.registros, ...r.registros],
              maisAntigos: r.registros.length === POR_PAGINA,
              paginas: l.paginas + 1,
            }
          : l,
      )
    } catch (e) {
      setErroMais(e instanceof Error ? e.message : 'Erro inesperado.')
    } finally {
      setCarregandoMais(false)
    }
  }

  const dias = useMemo(() => {
    const out: Array<{ dia: string; itens: RegistroAuditoria[] }> = []
    for (const r of registros) {
      const dia = format(parseISO(r.em), 'yyyy-MM-dd')
      const ultimo = out[out.length - 1]
      if (ultimo?.dia === dia) ultimo.itens.push(r)
      else out.push({ dia, itens: [r] })
    }
    return out
  }, [registros])

  const usuariosOrdenados = useMemo(() => [...usuarios].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [usuarios])

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icone={<History className="h-4 w-4" />}
        titulo="Atividade recente"
        descricao="Entradas no sistema, mudanças de usuários, cópias de segurança e cada gravação, com quem fez. Guardado por 12 meses."
        acoes={
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={atualizarLista}
            disabled={carregando}
            aria-label="Atualizar"
            title="Atualizar"
          >
            <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
          </Button>
        }
      />
      <div className="flex flex-col gap-3 border-b border-line px-5 pb-4 md:flex-row md:items-center">
        <Segmented
          tamanho="sm"
          valor={grupo}
          aoMudar={setGrupo}
          opcoes={[
            { valor: 'todos', label: 'Tudo' },
            ...(Object.keys(ROTULO_GRUPO_AUDITORIA) as GrupoAuditoria[]).map((g) => ({
              valor: g,
              label: ROTULO_GRUPO_AUDITORIA[g],
            })),
          ]}
        />
        <div className="md:ml-auto md:w-56">
          <Select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} aria-label="Filtrar por usuário">
            <option value="">Todos os usuários</option>
            {usuariosOrdenados.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} ({u.login})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {erro && !registros.length ? (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-danger">{erro}</p>
          <Button tamanho="sm" icone={<RefreshCw className="h-3.5 w-3.5" />} onClick={atualizarLista}>
            Tentar de novo
          </Button>
        </div>
      ) : !registros.length ? (
        <p className="px-5 py-12 text-center text-sm text-muted">
          {carregando ? 'Carregando…' : 'Nenhuma atividade registrada com esses filtros.'}
        </p>
      ) : (
        <div className={cn('transition-opacity', carregando && 'opacity-60')}>
          {dias.map(({ dia, itens }) => (
            <section key={dia}>
              <h4 className="border-b border-line bg-surface-2/70 px-5 py-1.5 text-[11.5px] font-semibold tracking-[0.04em] text-muted uppercase">
                {rotuloDia(itens[0].em)}
              </h4>
              <ul>
                {itens.map((r) => (
                  <ItemRegistro key={r.id} r={r} nomes={nomes} existe={existe} />
                ))}
              </ul>
            </section>
          ))}
          <div className="flex items-center justify-center border-t border-line px-5 py-3">
            {erro || erroMais ? (
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-danger">
                {erro || erroMais}
                <Button
                  tamanho="sm"
                  variante="ghost"
                  onClick={erro ? atualizarLista : () => void carregarMais()}
                  disabled={carregando || carregandoMais}
                >
                  Tentar de novo
                </Button>
              </p>
            ) : maisAntigos ? (
              <Button tamanho="sm" variante="ghost" disabled={carregando || carregandoMais} onClick={() => void carregarMais()}>
                {carregandoMais ? 'Carregando…' : 'Carregar mais'}
              </Button>
            ) : (
              <p className="text-xs text-muted">Fim do registro.</p>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function ItemRegistro({
  r,
  nomes,
  existe,
}: {
  r: RegistroAuditoria
  nomes: ReadonlyMap<string, string>
  existe: (tipo: TipoLink, id: string) => boolean
}) {
  const d = descreverRegistro(r, nomes)
  const autor = autorDoRegistro(r, nomes)
  const link = d.link && existe(d.link.tipo, d.link.id) ? enderecoDoLink(d.link) : null
  return (
    <li className="flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tomDoRegistro(r))}>
        {createElement(iconeDoRegistro(r), { className: 'h-4 w-4' })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">
          {link ? (
            <Link to={link} className="group underline-offset-2 hover:text-brand-ink hover:underline">
              {d.titulo}
              <ArrowUpRight className="ml-1 inline-block h-3.5 w-3.5 align-[-2px] text-muted transition-colors group-hover:text-brand-ink" />
            </Link>
          ) : (
            d.titulo
          )}
        </p>
        {d.detalhe && <p className="mt-0.5 text-[12.5px] break-words text-ink-2">{d.detalhe}</p>}
        <p className="mt-0.5 text-xs text-muted">
          {autor.texto}
          {autor.login && (
            <>
              {autor.texto && ' '}
              <span className="font-mono text-[11.5px]">{autor.entreParenteses ? `(${autor.login})` : autor.login}</span>
            </>
          )}
          {r.ip && <> · {r.ip}</>}
        </p>
      </div>
      <time
        dateTime={r.em}
        className="tnum shrink-0 pt-0.5 text-xs text-muted"
        title={format(parseISO(r.em), 'dd/MM/yyyy HH:mm:ss')}
      >
        {format(parseISO(r.em), 'HH:mm')}
      </time>
    </li>
  )
}
