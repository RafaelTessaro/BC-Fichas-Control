import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Input } from '../ui/Form'

/**
 * Campo de senha com o botão de mostrar/ocultar. `autoComplete` diz ao navegador o que guardar:
 * "current-password" ao entrar, "new-password" ao criar (o navegador pode sugerir uma senha forte).
 */
export const CampoSenha = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { autoComplete: 'current-password' | 'new-password' }
>(function CampoSenha({ className, ...props }, ref) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visivel ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className={cn('pr-11', className)}
        {...props}
      />
      <button
        type="button"
        // Não tira o foco do campo (dá para continuar digitando)
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? 'Ocultar a senha' : 'Mostrar a senha'}
        aria-pressed={visivel}
        title={visivel ? 'Ocultar a senha' : 'Mostrar a senha'}
        className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {visivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
})
