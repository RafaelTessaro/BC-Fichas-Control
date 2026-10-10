import { ChevronsUpDown, KeyRound, LogOut } from 'lucide-react'
import { NOME_NIVEL } from '#shared/permissoes.ts'
import { cn } from '../../lib/cn'
import { useSessao } from '../../store/sessao'
import { Avatar, Menu } from '../ui/Misc'
import { abrirMinhaSenha } from './minhaSenha'

/**
 * Quem está usando o sistema, com "Trocar minha senha" e "Sair". No rodapé do menu lateral
 * (recolhido: só as iniciais) e, no celular, compacto no cabeçalho.
 */
export function MenuUsuario({ recolhido, compacto }: { recolhido?: boolean; compacto?: boolean }) {
  const usuario = useSessao((s) => s.usuario)
  const sair = useSessao((s) => s.sair)
  if (!usuario) return null
  const nivel = NOME_NIVEL[usuario.nivel]
  const descricao = `${usuario.nome} (${usuario.login}) · ${nivel}`
  const soIniciais = recolhido || compacto

  return (
    // Aberto, o botão ocupa a largura toda do rodapé (a âncora do Menu é inline-flex)
    <div className={soIniciais ? 'flex' : 'flex flex-col'}>
      <Menu
        alinhar={compacto ? 'right' : 'left'}
        gatilho={(abrir, aberto) => (
          <button
            type="button"
            onClick={abrir}
            aria-haspopup="menu"
            aria-expanded={aberto}
            aria-label={soIniciais ? `${descricao}. Abrir o menu do usuário` : undefined}
            title={soIniciais ? descricao : undefined}
            className={cn(
              'group flex cursor-pointer items-center rounded-xl text-left transition-colors',
              soIniciais ? 'justify-center' : 'w-full gap-2.5 px-2 py-1.5',
              compacto ? 'h-9 w-9' : recolhido ? 'h-10 w-10' : '',
              aberto ? 'bg-surface-3/70' : 'hover:bg-surface-3/60',
            )}
          >
            <Avatar nome={usuario.nome} className={cn('text-[12px]', compacto ? 'h-8 w-8 rounded-full' : 'h-8 w-8 rounded-lg')} />
            {!soIniciais && (
              <>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-ink">{usuario.nome}</span>
                  <span className="block truncate text-[11.5px] text-muted">{nivel}</span>
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-ink-2" />
              </>
            )}
          </button>
        )}
        itens={[
          { label: 'Trocar minha senha', icone: <KeyRound className="h-4 w-4" />, aoClicar: abrirMinhaSenha },
          'sep',
          { label: 'Sair', icone: <LogOut className="h-4 w-4" />, aoClicar: () => void sair() },
        ]}
      />
    </div>
  )
}
