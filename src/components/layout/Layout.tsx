import { Menu, Plus, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Modal'
import { SeletorTema, Sidebar } from './Sidebar'
import { CommandPalette, usePaleta } from './CommandPalette'
import { TODAS_PAGINAS } from './nav'

function tituloSecao(pathname: string) {
  const p = [...TODAS_PAGINAS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((x) => (x.to === '/' ? pathname === '/' : pathname.startsWith(x.to)))
  return p?.label ?? ''
}

export function Layout({ children }: { children: ReactNode }) {
  const [menuMobile, setMenuMobile] = useState(false)
  const abrirPaleta = usePaleta((s) => s.abrir)
  const navegar = useNavigate()
  const location = useLocation()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    document.getElementById('conteudo')?.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>
      <Drawer aberto={menuMobile} aoFechar={() => setMenuMobile(false)} lado="left" largura="w-[272px]">
        <Sidebar mobile aoNavegar={() => setMenuMobile(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMenuMobile(true)}
            className="-ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <AnimatePresence mode="wait">
            <motion.p
              key={tituloSecao(location.pathname)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="text-sm font-medium text-ink-2 lg:hidden"
            >
              {tituloSecao(location.pathname)}
            </motion.p>
          </AnimatePresence>

          <button
            onClick={abrirPaleta}
            className="group ml-auto flex h-10 w-10 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-muted shadow-xs transition-colors hover:border-line-strong hover:text-ink-2 sm:w-72 lg:mr-auto lg:ml-0"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden flex-1 text-left sm:block">Buscar clientes, eventos…</span>
            <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium sm:block">
              {mac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>

          <div className="hidden w-[120px] md:block lg:hidden">
            <SeletorTema />
          </div>
          <Button
            variante="primary"
            icone={<Plus className="h-4 w-4" />}
            onClick={() => navegar('/eventos/novo')}
            className="max-sm:w-10 max-sm:px-0"
          >
            <span className="max-sm:hidden">Novo evento</span>
          </Button>
        </header>

        <main id="conteudo" className="scroll-fino flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}
