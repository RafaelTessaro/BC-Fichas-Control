// Página Usuários (o "painel de administração"): quem acessa o sistema, o nível de cada um, as
// ações sobre as contas, o que cada nível pode e o registro de atividades. Só o administrador chega
// aqui (a rota e o menu conferem a permissão `usuarios`; o servidor também recusa).

import { format, parseISO } from 'date-fns'
import {
  Info,
  KeyRound,
  MonitorOff,
  Pencil,
  RefreshCw,
  Trash2,
  UserCheck,
  UserPlus,
  Users as IconeUsuarios,
  UserX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NOME_NIVEL } from '#shared/permissoes.ts'
import type { ResultadoSenha, Usuario } from '#shared/tipos.ts'
import { USUARIOS_MAX } from '#shared/usuarios.ts'
import { abrirMinhaSenha } from '../components/sessao/minhaSenha'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { Avatar, PageHeader } from '../components/ui/Misc'
import { Linha, Tabela, Td, Th } from '../components/ui/Table'
import { AtividadeRecente } from '../components/usuarios/AtividadeRecente'
import { EditarUsuarioModal } from '../components/usuarios/EditarUsuarioModal'
import { MenuAcoes, type AcaoMenu } from '../components/usuarios/MenuAcoes'
import { NovoUsuarioModal } from '../components/usuarios/NovoUsuarioModal'
import { PermissoesNiveis } from '../components/usuarios/PermissoesNiveis'
import { RedefinirSenhaModal } from '../components/usuarios/RedefinirSenhaModal'
import { SenhaTemporariaModal } from '../components/usuarios/SenhaTemporariaModal'
import { api, ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { useSessao, useUsuarioAtual } from '../store/sessao'
import { avisarErro, toast } from '../store/ui'

/** Administradores primeiro e depois por nome (a mesma ordem do servidor). */
const ordenar = (lista: Usuario[]) =>
  [...lista].sort((a, b) =>
    a.nivel !== b.nivel ? (a.nivel === 'ADMIN' ? -1 : 1) : a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }),
  )

function situacao(u: Usuario): { rotulo: string; tom: 'success' | 'warning' | 'neutral' } {
  if (!u.ativo) return { rotulo: 'Desativado', tom: 'neutral' }
  if (u.trocarSenha) return { rotulo: 'Troca de senha pendente', tom: 'warning' }
  return { rotulo: 'Ativo', tom: 'success' }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const PROPRIA_CONTA = {
  desativar: 'Você não pode desativar a própria conta. Peça a outro administrador.',
  excluir: 'Você não pode excluir a própria conta. Peça a outro administrador.',
  nivel: 'Você não pode mudar o nível da própria conta. Peça a outro administrador.',
}
const ULTIMO_ADMIN = 'É o único administrador ativo. Cadastre ou promova outro antes.'

export function Usuarios() {
  const eu = useUsuarioAtual()
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null)
  const [erro, setErro] = useState('')
  /** Cada busca da lista é uma rodada; enquanto a última não chega, a página está carregando. */
  const [rodada, setRodada] = useState(0)
  const [rodadaCarregada, setRodadaCarregada] = useState(-1)
  const carregando = rodadaCarregada !== rodada
  /** Muda a cada ação na página: a "Atividade recente" busca de novo. */
  const [versaoAtividade, setVersaoAtividade] = useState(0)
  const [novo, setNovo] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [redefinindo, setRedefinindo] = useState<Usuario | null>(null)
  const [senhaGerada, setSenhaGerada] = useState<{ usuario: Usuario; senha: string; nova: boolean } | null>(null)

  const carregar = useCallback(() => setRodada((r) => r + 1), [])

  useEffect(() => {
    let valendo = true
    api.usuarios().then(
      (r) => {
        if (!valendo) return
        setUsuarios(ordenar(r.usuarios))
        setErro('')
        setRodadaCarregada(rodada)
      },
      (e: unknown) => {
        if (!valendo) return
        setErro(e instanceof Error ? e.message : 'Erro inesperado.')
        setRodadaCarregada(rodada)
      },
    )
    return () => {
      valendo = false
    }
  }, [rodada])

  // Usuários não passam pelo tempo real: busca de novo quando a janela volta a ter foco
  useEffect(() => {
    window.addEventListener('focus', carregar)
    return () => window.removeEventListener('focus', carregar)
  }, [carregar])

  const lista = useMemo(() => usuarios ?? [], [usuarios])
  const adminsAtivos = lista.filter((u) => u.nivel === 'ADMIN' && u.ativo).length
  const ehUltimoAdmin = (u: Usuario) => u.nivel === 'ADMIN' && u.ativo && adminsAtivos <= 1
  const conectados = lista.filter((u) => u.sessoesAtivas > 0).length

  const registrarAcao = () => setVersaoAtividade((v) => v + 1)

  const atualizar = (u: Usuario) => {
    setUsuarios((atual) => ordenar([...(atual ?? []).filter((x) => x.id !== u.id), u]))
    registrarAcao()
    // A própria conta mudou de nome: o menu do usuário acompanha
    if (u.id === eu?.id) void useSessao.getState().conferir()
  }

  /** Erro de uma ação: avisa e, se a lista ficou velha (outra pessoa mexeu), busca de novo. */
  const falhou = (titulo: string, e: unknown) => {
    avisarErro(titulo, e)
    if (e instanceof ErroApi && (e.status === 404 || e.status === 409)) carregar()
  }

  const alternarAtivo = async (u: Usuario) => {
    if (u.ativo) {
      const ok = await confirmar({
        titulo: `Desativar ${u.nome}?`,
        descricao:
          'A pessoa sai do sistema na hora, em todos os computadores, e não consegue mais entrar. O nome continua no registro de atividades, e dá para reativar depois.',
        confirmar: 'Desativar',
        perigo: true,
      })
      if (!ok) return
    }
    try {
      const r = await api.alterarUsuario(u.id, { ativo: !u.ativo, versao: u.versao })
      atualizar(r.usuario)
      toast.sucesso(
        u.ativo ? 'Usuário desativado' : 'Usuário reativado',
        u.ativo ? undefined : `${u.nome} já pode entrar de novo.`,
      )
    } catch (e) {
      falhou(u.ativo ? 'Não foi possível desativar' : 'Não foi possível reativar', e)
    }
  }

  const encerrarSessoes = async (u: Usuario) => {
    const minha = u.id === eu?.id
    const ok = await confirmar({
      titulo: minha ? 'Encerrar as suas outras sessões?' : `Encerrar as sessões de ${u.nome}?`,
      descricao: minha
        ? 'Nos outros computadores onde você entrou, o sistema vai pedir para entrar de novo. Este continua conectado.'
        : 'Nos computadores onde a pessoa está conectada, o sistema vai pedir para ela entrar de novo. O que ela estiver digitando continua na tela.',
      confirmar: 'Encerrar sessões',
    })
    if (!ok) return
    try {
      const r = await api.encerrarSessoes(u.id)
      atualizar(r.usuario)
      toast.sucesso('Sessões encerradas')
    } catch (e) {
      falhou('Não foi possível encerrar as sessões', e)
    }
  }

  const excluir = async (u: Usuario) => {
    const ok = await confirmar({
      titulo: `Excluir ${u.nome}?`,
      descricao:
        'Para quem saiu da empresa, prefira desativar. Excluir apaga a conta de vez; o registro de atividades continua mostrando o login. Não dá para desfazer.',
      confirmar: 'Excluir usuário',
      perigo: true,
      digitar: u.login,
    })
    if (!ok) return
    try {
      await api.excluirUsuario(u.id)
      setUsuarios((atual) => (atual ?? []).filter((x) => x.id !== u.id))
      registrarAcao()
      toast.sucesso('Usuário excluído')
    } catch (e) {
      falhou('Não foi possível excluir', e)
    }
  }

  const aoCriar = (r: ResultadoSenha) => {
    setNovo(false)
    atualizar(r.usuario)
    if (r.senhaTemporaria) setSenhaGerada({ usuario: r.usuario, senha: r.senhaTemporaria, nova: true })
    else
      toast.sucesso(
        'Usuário cadastrado',
        'Entregue a senha que você digitou. No primeiro acesso o sistema pede para a pessoa criar a própria senha.',
      )
  }

  const aoRedefinir = (r: ResultadoSenha) => {
    setRedefinindo(null)
    atualizar(r.usuario)
    if (r.senhaTemporaria) setSenhaGerada({ usuario: r.usuario, senha: r.senhaTemporaria, nova: false })
    else toast.sucesso('Senha redefinida', 'Entregue a senha que você digitou. No próximo acesso a pessoa cria a própria senha.')
  }

  const acoes = (u: Usuario): Array<AcaoMenu | 'sep'> => {
    const minha = u.id === eu?.id
    const ultimo = ehUltimoAdmin(u)
    return [
      { label: 'Editar', icone: <Pencil className="h-4 w-4" />, aoClicar: () => setEditando(u) },
      minha
        ? { label: 'Trocar minha senha', icone: <KeyRound className="h-4 w-4" />, aoClicar: abrirMinhaSenha }
        : { label: 'Redefinir senha', icone: <KeyRound className="h-4 w-4" />, aoClicar: () => setRedefinindo(u) },
      u.ativo
        ? {
            label: 'Desativar',
            icone: <UserX className="h-4 w-4" />,
            aoClicar: () => void alternarAtivo(u),
            motivo: minha ? PROPRIA_CONTA.desativar : ultimo ? ULTIMO_ADMIN : undefined,
          }
        : { label: 'Reativar', icone: <UserCheck className="h-4 w-4" />, aoClicar: () => void alternarAtivo(u) },
      {
        label: minha ? 'Encerrar minhas outras sessões' : 'Encerrar sessões',
        icone: <MonitorOff className="h-4 w-4" />,
        aoClicar: () => void encerrarSessoes(u),
        motivo: minha
          ? u.sessoesAtivas <= 1
            ? 'Você não está conectado em outro computador.'
            : undefined
          : u.sessoesAtivas === 0
            ? 'Não há sessão aberta.'
            : undefined,
      },
      'sep',
      {
        label: 'Excluir',
        icone: <Trash2 className="h-4 w-4" />,
        aoClicar: () => void excluir(u),
        perigo: true,
        motivo: minha ? PROPRIA_CONTA.excluir : ultimo ? ULTIMO_ADMIN : undefined,
      },
    ]
  }

  const motivoNivel = editando
    ? editando.id === eu?.id
      ? PROPRIA_CONTA.nivel
      : ehUltimoAdmin(editando)
        ? ULTIMO_ADMIN
        : undefined
    : undefined
  const noLimite = lista.length >= USUARIOS_MAX

  return (
    <>
      <PageHeader
        titulo="Usuários"
        descricao="Quem acessa o sistema e o que cada um pode fazer"
        acoes={
          <Button
            variante="primary"
            icone={<UserPlus className="h-4 w-4" />}
            onClick={() => setNovo(true)}
            disabled={!usuarios || noLimite}
            title={noLimite ? `O limite é de ${USUARIOS_MAX} usuários.` : undefined}
          >
            Novo usuário
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        {usuarios && adminsAtivos === 1 && lista.length > 1 && (
          <p className="flex items-start gap-2.5 rounded-2xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] text-info">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Recomendação: tenha pelo menos <b className="font-semibold">dois administradores</b>, cada um com o seu usuário.
              Assim, se um esquecer a senha, o outro redefine pela tela.
            </span>
          </p>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            icone={<IconeUsuarios className="h-4 w-4" />}
            titulo="Pessoas com acesso"
            descricao={
              usuarios
                ? [
                    plural(lista.length, 'usuário', 'usuários'),
                    plural(adminsAtivos, 'administrador ativo', 'administradores ativos'),
                    plural(conectados, 'com sessão aberta agora', 'com sessão aberta agora'),
                  ].join(' · ')
                : 'Carregando…'
            }
            acoes={
              <Button
                variante="ghost"
                tamanho="icon-sm"
                onClick={() => carregar()}
                disabled={carregando}
                aria-label="Atualizar"
                title="Atualizar"
              >
                <RefreshCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
              </Button>
            }
          />
          {!usuarios ? (
            erro ? (
              <div className="flex flex-col items-center gap-3 border-t border-line px-5 py-10 text-center">
                <p className="text-sm text-danger">{erro}</p>
                <Button tamanho="sm" icone={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => carregar()}>
                  Tentar de novo
                </Button>
              </div>
            ) : (
              <EsqueletoLinhas />
            )
          ) : (
            <Tabela className="border-t border-line">
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th className="max-md:hidden">Usuário</Th>
                  <Th className="max-sm:hidden">Nível</Th>
                  <Th className="max-sm:hidden">Situação</Th>
                  <Th className="max-lg:hidden">Último acesso</Th>
                  <Th alinhar="center" className="max-xl:hidden">
                    Sessões abertas
                  </Th>
                  <Th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {lista.map((u, i) => {
                  const sit = situacao(u)
                  const minha = u.id === eu?.id
                  return (
                    <Linha key={u.id} indice={i} aoClicar={() => setEditando(u)} className={cn(!u.ativo && 'opacity-70')}>
                      <Td>
                        {/* No celular só esta coluna e a das ações aparecem: o nome é encurtado para caber */}
                        <div className="flex items-center gap-3 max-sm:max-w-[calc(100vw-140px)]">
                          <Avatar nome={u.nome} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate font-medium text-ink">{u.nome}</p>
                              {minha && (
                                <Badge tom="brand" ponto={false} className="h-5 px-2 text-[11px]">
                                  Você
                                </Badge>
                              )}
                            </div>
                            {/* Colunas que somem em telas menores: o que elas mostram vem para cá */}
                            <p className="truncate text-xs text-muted md:hidden">
                              <span className="font-mono">{u.login}</span>
                              <span className="sm:hidden">
                                {' '}
                                · {NOME_NIVEL[u.nivel]}
                                {sit.tom !== 'success' && <> · {sit.rotulo}</>}
                              </span>
                            </p>
                            <p className="truncate text-xs text-muted max-md:hidden lg:hidden">
                              {u.ultimoAcessoEm ? `Último acesso: ${dataHora(u.ultimoAcessoEm)}` : 'Nunca entrou'}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="font-mono text-[13px] max-md:hidden">{u.login}</Td>
                      <Td className="max-sm:hidden">
                        <Badge tom={u.nivel === 'ADMIN' ? 'brand' : 'neutral'}>{NOME_NIVEL[u.nivel]}</Badge>
                      </Td>
                      <Td className="max-sm:hidden">
                        <Badge tom={sit.tom}>{sit.rotulo}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap max-lg:hidden">
                        {u.ultimoAcessoEm ? (
                          <>
                            <p className="tnum text-ink-2">{dataHora(u.ultimoAcessoEm)}</p>
                            {u.ultimoAcessoIp && <p className="tnum text-xs text-muted">{u.ultimoAcessoIp}</p>}
                          </>
                        ) : (
                          <span className="text-muted">Nunca entrou</span>
                        )}
                      </Td>
                      <Td alinhar="center" className="max-xl:hidden">
                        <span
                          className={cn(
                            'tnum inline-flex items-center gap-1.5',
                            u.sessoesAtivas ? 'font-medium text-ink' : 'text-muted',
                          )}
                        >
                          {u.sessoesAtivas > 0 && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                          {u.sessoesAtivas}
                        </span>
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <MenuAcoes rotulo={`Ações de ${u.nome}`} itens={acoes(u)} />
                      </Td>
                    </Linha>
                  )
                })}
              </tbody>
            </Tabela>
          )}
        </Card>

        <AtividadeRecente usuarios={lista} atualizar={versaoAtividade} />

        <PermissoesNiveis />
      </div>

      <NovoUsuarioModal aberto={novo} aoFechar={() => setNovo(false)} usuarios={lista} aoCriar={aoCriar} />
      <EditarUsuarioModal
        usuario={editando}
        motivoNivel={motivoNivel}
        aoFechar={() => setEditando(null)}
        aoSalvar={(u) => {
          setEditando(null)
          if (u !== editando) {
            atualizar(u)
            toast.sucesso('Usuário salvo')
          }
        }}
        aoDesatualizado={() => {
          setEditando(null)
          carregar()
        }}
      />
      <RedefinirSenhaModal
        usuario={redefinindo}
        aoFechar={() => setRedefinindo(null)}
        aoRedefinir={aoRedefinir}
        aoDesatualizado={() => {
          setRedefinindo(null)
          carregar()
        }}
      />
      <SenhaTemporariaModal dados={senhaGerada} aoFechar={() => setSenhaGerada(null)} />
    </>
  )
}

const dataHora = (iso: string) => format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm")

function EsqueletoLinhas() {
  return (
    <div className="border-t border-line" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-surface-3" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-surface-3" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  )
}
