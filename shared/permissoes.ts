// Quem pode o quê: fonte única para o servidor (server/acesso.ts) e para as telas (usePode).
// Mudar uma decisão do dono = mudar uma linha aqui.
import type { NivelUsuario } from './tipos.ts'

export type Permissao =
  | 'verFaturamento'
  | 'exportarPlanilhas'
  | 'excluirCliente'
  | 'excluirEvento'
  | 'excluirContrato'
  | 'apagarCopiaAssinada'
  | 'excluirManutencao'
  | 'excluirReclamacao'
  | 'excluirAnexo'
  | 'gerenciarFrota'
  | 'gerenciarServicos'
  | 'configuracoes'
  | 'dadosEBackup'
  | 'usuarios'

const SO_ADMIN: readonly NivelUsuario[] = ['ADMIN']
const TODOS: readonly NivelUsuario[] = ['ADMIN', 'COMUM']

export const PERMISSOES: Record<Permissao, readonly NivelUsuario[]> = {
  verFaturamento: SO_ADMIN,
  exportarPlanilhas: SO_ADMIN, // a confirmar
  excluirCliente: SO_ADMIN, // a confirmar
  excluirEvento: SO_ADMIN, // a confirmar (o comum usa "Cancelado")
  excluirContrato: SO_ADMIN, // a confirmar
  apagarCopiaAssinada: SO_ADMIN, // a confirmar (trocar a cópia é livre; a anterior é guardada)
  excluirManutencao: SO_ADMIN, // a confirmar
  excluirReclamacao: TODOS, // a confirmar
  excluirAnexo: TODOS, // a confirmar (o arquivo é guardado)
  gerenciarFrota: SO_ADMIN, // a confirmar
  gerenciarServicos: SO_ADMIN, // a confirmar (acrescentar é livre)
  configuracoes: SO_ADMIN,
  dadosEBackup: SO_ADMIN,
  usuarios: SO_ADMIN,
}

/** Lista de todas as permissões, na ordem da tabela acima. */
export const LISTA_PERMISSOES = Object.keys(PERMISSOES) as Permissao[]

/**
 * Permissões que só escondem na tela ("escondido, não secreto"): /api/dados é igual para os dois níveis
 * e os totais e as planilhas saem no navegador. As outras o servidor recusa (server/acesso.ts).
 */
export const SO_NA_TELA: ReadonlySet<Permissao> = new Set<Permissao>(['verFaturamento', 'exportarPlanilhas'])

export const SEM_PERMISSAO: Record<Permissao, string> = {
  verFaturamento: 'Só o administrador vê o faturamento.',
  exportarPlanilhas: 'Só o administrador exporta planilhas.',
  excluirCliente: 'Só o administrador exclui clientes.',
  excluirEvento: 'Só o administrador exclui eventos. Para tirar o evento da agenda, mude a situação para Cancelado.',
  excluirContrato: 'Só o administrador exclui contratos.',
  apagarCopiaAssinada: 'Só o administrador apaga a cópia assinada. Para corrigir, anexe a cópia certa por cima.',
  excluirManutencao: 'Só o administrador exclui manutenções.',
  excluirReclamacao: 'Só o administrador apaga reclamações.',
  excluirAnexo: 'Só o administrador apaga arquivos do evento.',
  gerenciarFrota: 'Só o administrador cadastra, altera, desativa ou exclui máquinas.',
  gerenciarServicos: 'Só o administrador renomeia ou remove serviços da lista.',
  configuracoes: 'Só o administrador altera as configurações.',
  dadosEBackup: 'Só o administrador cuida das cópias de segurança e dos dados.',
  usuarios: 'Só o administrador cuida dos usuários.',
}

export const ROTULO_PERMISSAO: Record<Permissao, string> = {
  verFaturamento: 'Ver faturamento e indicadores (totais em R$, relatórios, quanto cada cliente alugou)',
  exportarPlanilhas: 'Exportar planilhas de eventos e clientes',
  excluirCliente: 'Excluir clientes',
  excluirEvento: 'Excluir eventos',
  excluirContrato: 'Excluir contratos',
  apagarCopiaAssinada: 'Apagar a cópia assinada do contrato',
  excluirManutencao: 'Excluir manutenções',
  excluirReclamacao: 'Apagar reclamações',
  excluirAnexo: 'Apagar arquivos anexados ao evento',
  gerenciarFrota: 'Cadastrar, editar, desativar e excluir máquinas',
  gerenciarServicos: 'Renomear e remover serviços de manutenção',
  configuracoes: 'Configurações, e-mail e Google Agenda',
  dadosEBackup: 'Cópias de segurança, restaurar e apagar dados',
  usuarios: 'Usuários e registro de atividades',
}

export const NOME_NIVEL: Record<NivelUsuario, string> = { ADMIN: 'Administrador', COMUM: 'Comum' }
export const RESUMO_NIVEL: Record<NivelUsuario, string> = {
  ADMIN: 'Acesso a tudo: faturamento, relatórios, configurações, usuários e cópias de segurança.',
  COMUM:
    'Dia a dia: agenda, clientes, eventos, contratos, pagamentos e manutenção. Vê o valor de cada evento, mas não os totais de faturamento.',
}

/** `true` quando o nível tem a permissão. Sem nível (ninguém entrou) ou sem permissão informada: `false`. */
export function pode(nivel: NivelUsuario | null | undefined, p: Permissao | undefined): boolean {
  return !!nivel && !!p && Object.hasOwn(PERMISSOES, p) && PERMISSOES[p].includes(nivel)
}
