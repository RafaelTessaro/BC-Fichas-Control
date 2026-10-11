// Textos do registro de atividades ("Atividade recente" da página Usuários). Cada gravação chega
// como a chave da rota ('PATCH /api/eventos/:id | pago,dataPagamento'); aqui ela vira uma frase.

import { BLOQUEIO_TROCA_SENHA, GRUPOS_AUDITORIA, ROTULO_ACAO_AUDITORIA } from '#shared/usuarios.ts'
import type { AcaoAuditoria, GrupoAuditoria, RegistroAuditoria } from '#shared/tipos.ts'

type Verbo = readonly [passado: string, infinitivo: string]

const CADASTRAR: Verbo = ['Cadastrou', 'cadastrar']
const ALTERAR: Verbo = ['Alterou', 'alterar']
const EXCLUIR: Verbo = ['Excluiu', 'excluir']
const APAGAR: Verbo = ['Apagou', 'apagar']
const REGISTRAR: Verbo = ['Registrou', 'registrar']
const ENVIAR: Verbo = ['Enviou', 'enviar']
const VER: Verbo = ['Viu', 'ver']

/** Onde a frase leva: a ficha do registro afetado (quando ele ainda existe). */
export type TipoLink = 'evento' | 'cliente' | 'maquina' | 'contrato'

/** Rota → [verbo, complemento, link]. Rotas fora daqui aparecem como a chave. */
const ROTAS: Record<string, readonly [Verbo, string, TipoLink?]> = {
  'POST /api/clientes': [CADASTRAR, 'um cliente'],
  'PUT /api/clientes/:id': [ALTERAR, 'o cadastro do cliente', 'cliente'],
  'DELETE /api/clientes/:id': [EXCLUIR, 'um cliente'],
  'POST /api/eventos': [CADASTRAR, 'um evento'],
  'PUT /api/eventos/:id': [ALTERAR, 'o evento', 'evento'],
  'PATCH /api/eventos/:id': [ALTERAR, 'o evento (pagamento, devolução ou situação)', 'evento'],
  'POST /api/eventos/:id/duplicar': [['Duplicou', 'duplicar'], 'o evento', 'evento'],
  'POST /api/eventos/:id/repetir': [['Repetiu', 'repetir'], 'o evento em outras datas', 'evento'],
  'DELETE /api/eventos/:id': [EXCLUIR, 'um evento'],
  'POST /api/maquinas': [CADASTRAR, 'uma máquina'],
  'POST /api/maquinas/quantidade': [['Ajustou', 'ajustar'], 'a quantidade de máquinas'],
  'PUT /api/maquinas/:id': [ALTERAR, 'a máquina', 'maquina'],
  'DELETE /api/maquinas/:id': [EXCLUIR, 'uma máquina'],
  'POST /api/ordens': [REGISTRAR, 'uma manutenção'],
  'PUT /api/ordens/:id': [ALTERAR, 'uma manutenção'],
  'DELETE /api/ordens/:id': [EXCLUIR, 'uma manutenção'],
  'POST /api/reclamacoes': [REGISTRAR, 'uma reclamação'],
  'PUT /api/reclamacoes/:id': [ALTERAR, 'uma reclamação'],
  'DELETE /api/reclamacoes/:id': [APAGAR, 'uma reclamação'],
  'PUT /api/config': [ALTERAR, 'as configurações'],
  'PUT /api/config/servicos': [ALTERAR, 'a lista de serviços de manutenção'],
  'POST /api/eventos/:id/anexos': [['Anexou', 'anexar'], 'um arquivo ao evento', 'evento'],
  'DELETE /api/anexos/:id': [APAGAR, 'um arquivo anexado ao evento'],
  'POST /api/contratos': [['Gerou', 'gerar'], 'um contrato'],
  'PATCH /api/contratos/:id': [ALTERAR, 'a situação do contrato (assinado, cancelado ou reaberto)', 'contrato'],
  'POST /api/contratos/:id/arquivo': [['Anexou', 'anexar'], 'a cópia assinada do contrato', 'contrato'],
  'DELETE /api/contratos/:id/arquivo': [APAGAR, 'a cópia assinada do contrato', 'contrato'],
  'DELETE /api/contratos/:id': [EXCLUIR, 'um contrato'],
  'POST /api/email/enviar': [ENVIAR, 'um documento por e-mail'],
  'PUT /api/email/config': [ALTERAR, 'a configuração do e-mail'],
  'DELETE /api/email/config': [APAGAR, 'a configuração do e-mail'],
  'POST /api/email/teste': [ENVIAR, 'um e-mail de teste'],
  'GET /api/google/status': [VER, 'a situação do Google Agenda'],
  'PUT /api/google/config': [ALTERAR, 'a configuração do Google Agenda'],
  'POST /api/google/credenciais': [ENVIAR, 'as credenciais do Google Agenda'],
  'DELETE /api/google/credenciais': [['Removeu', 'remover'], 'as credenciais do Google Agenda'],
  'POST /api/google/testar': [['Testou', 'testar'], 'a conexão com o Google Agenda'],
  'POST /api/google/sincronizar': [['Sincronizou', 'sincronizar'], 'o Google Agenda'],
  'GET /api/backup': [['Baixou', 'baixar'], 'uma cópia de segurança'],
  'POST /api/backup/restaurar': [['Restaurou', 'restaurar'], 'uma cópia de segurança'],
  'POST /api/backup/mesclar': [['Juntou', 'juntar'], 'uma cópia de segurança aos dados'],
  'GET /api/backups': [VER, 'as cópias de segurança automáticas'],
  'POST /api/backups': [['Fez', 'fazer'], 'uma cópia de segurança agora'],
  'POST /api/exemplo': [['Carregou', 'carregar'], 'os dados de exemplo'],
  'POST /api/limpar': [APAGAR, 'todos os dados'],
  'GET /api/usuarios': [VER, 'os usuários'],
  'POST /api/usuarios': [CADASTRAR, 'um usuário'],
  'PUT /api/usuarios/:id': [ALTERAR, 'um usuário'],
  'DELETE /api/usuarios/:id': [EXCLUIR, 'um usuário'],
  'POST /api/usuarios/:id/senha': [['Redefiniu', 'redefinir'], 'a senha de um usuário'],
  'DELETE /api/usuarios/:id/sessoes': [['Encerrou', 'encerrar'], 'as sessões de um usuário'],
  'GET /api/auditoria': [VER, 'o registro de atividades'],
}

const GRUPO_DA_ACAO = new Map<AcaoAuditoria, GrupoAuditoria>(
  (Object.entries(GRUPOS_AUDITORIA) as Array<[GrupoAuditoria, readonly AcaoAuditoria[]]>).flatMap(([grupo, acoes]) =>
    acoes.map((a) => [a, grupo] as const),
  ),
)

/** Grupo de cada ação (cor e ícone na lista). */
export const grupoDaAcao = (acao: AcaoAuditoria): GrupoAuditoria => GRUPO_DA_ACAO.get(acao) ?? 'alteracoes'

/** Campos do PATCH do evento, como a pessoa os conhece. */
const CAMPOS_EVENTO: Record<string, string> = {
  status: 'situação',
  formaPagamento: 'forma de pagamento',
  dataPagamento: 'pagamento',
  pago: 'pagamento',
  bobinasDevolvidas: 'bobinas devolvidas',
  observacoes: 'observações',
  programacao: 'programação',
}

export interface DescricaoRegistro {
  titulo: string
  /** Segunda linha (ex.: "nível: Comum → Administrador"), ou ''. */
  detalhe: string
  /** Ficha do registro afetado (a tela confere se ele ainda existe). */
  link?: { tipo: TipoLink; id: string }
}

/** Frase de uma gravação ('PATCH /api/eventos/:id | status,dataPagamento' → "Alterou o evento (situação, pagamento)"). */
function frasePassada(detalhe: string): { frase: string; tipo?: TipoLink } {
  const [chave, campos = ''] = detalhe.split(' | ')
  const rota = ROTAS[chave]
  if (!rota) return { frase: chave || ROTULO_ACAO_AUDITORIA.ALTERACAO }
  const [[passado], complemento, tipo] = rota
  if (chave === 'PATCH /api/eventos/:id' && campos) {
    const nomes = [...new Set(campos.split(',').map((c) => CAMPOS_EVENTO[c.trim()] ?? c.trim()))].filter(Boolean)
    if (nomes.length) return { frase: `${passado} o evento (${nomes.join(', ')})`, tipo }
  }
  return { frase: `${passado} ${complemento}`, tipo }
}

/**
 * Título, detalhe e link de um registro. `nomes` (id → nome) mostra quem foi o usuário afetado
 * nas ações sobre usuários.
 */
export function descreverRegistro(r: RegistroAuditoria, nomes?: ReadonlyMap<string, string>): DescricaoRegistro {
  if (r.acao === 'ALTERACAO') {
    const { frase, tipo } = frasePassada(r.detalhe)
    return { titulo: frase, detalhe: '', ...(tipo && r.alvo ? { link: { tipo, id: r.alvo } } : {}) }
  }
  const titulo = ROTULO_ACAO_AUDITORIA[r.acao] ?? r.acao
  if (r.acao === 'ACESSO_NEGADO') {
    const rota = ROTAS[r.detalhe.split(' | ')[0]]
    return { titulo, detalhe: rota ? `Tentou ${rota[0][1]} ${rota[1]}.` : r.detalhe }
  }
  // Na própria conta (trocar a própria senha) quem fez já aparece na linha de baixo. Na ferramenta do
  // servidor, a linha de baixo diz "No computador do servidor": a conta ajustada vem aqui
  const afetado =
    r.alvo && (r.alvo !== r.usuarioId || r.acao === 'FERRAMENTA_LOCAL') && grupoDaAcao(r.acao) === 'usuarios'
      ? nomes?.get(r.alvo)
      : undefined
  const partes = [afetado, r.detalhe].filter(Boolean)
  return { titulo, detalhe: partes.join(' · ') }
}

export interface AutorRegistro {
  texto: string
  /** Vai em fonte de código depois do texto; entre parênteses quando o texto termina com o nome. */
  login?: string
  entreParenteses?: boolean
}

/**
 * Linha de baixo de um registro: quem fez. Numa entrada recusada, o usuário é só o que alguém digitou
 * naquele computador (pode não ter sido a própria pessoa); na ferramenta do servidor, quem fez foi quem
 * estava nele (a conta ajustada vai no detalhe).
 */
export function autorDoRegistro(r: RegistroAuditoria, nomes: ReadonlyMap<string, string>): AutorRegistro {
  if (r.acao === 'FERRAMENTA_LOCAL' || r.acao === 'COPIA_RESTAURADA') return { texto: 'No computador do servidor' }
  const nome = nomes.get(r.usuarioId)
  if (r.acao === 'LOGIN_FALHOU' || (r.acao === 'BLOQUEIO' && r.detalhe !== BLOQUEIO_TROCA_SENHA)) {
    if (!r.login) return { texto: 'Usuário inexistente' }
    return nome
      ? { texto: `Tentativa com o usuário ${nome}`, login: r.login, entreParenteses: true }
      : { texto: 'Tentativa com o usuário', login: r.login }
  }
  if (nome) return { texto: nome, login: r.login, entreParenteses: true }
  if (r.login) return { texto: '', login: r.login }
  return { texto: '—' }
}

/** A linha de baixo como texto corrido (o que a tela mostra, sem o IP). */
export function textoDoAutor(a: AutorRegistro): string {
  if (!a.login) return a.texto
  return [a.texto, a.entreParenteses ? `(${a.login})` : a.login].filter(Boolean).join(' ')
}

/** Método da gravação ('DELETE', 'POST'…), para o ícone. */
export const metodoDoRegistro = (r: RegistroAuditoria) => (r.acao === 'ALTERACAO' ? r.detalhe.split(' ')[0] : '')

/** Endereço da ficha no sistema. */
export function enderecoDoLink(link: { tipo: TipoLink; id: string }): string {
  const id = encodeURIComponent(link.id)
  if (link.tipo === 'evento') return `/eventos/${id}`
  if (link.tipo === 'cliente') return `/clientes/${id}`
  if (link.tipo === 'maquina') return `/manutencao/${id}`
  return `/contratos?contrato=${id}`
}
