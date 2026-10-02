import type { SVGProps } from 'react'

/**
 * Máquina de fichas: corpo com tela e teclas, e a ficha saindo embaixo com a borda serrilhada.
 * Desenhada no mesmo estilo dos ícones da Lucide (24 × 24, traço 2), para usar no lugar deles.
 */
export function IconeMaquinaFichas({ className, strokeWidth = 2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    >
      <rect x="4" y="2" width="16" height="12" rx="2" />
      <rect x="7" y="5" width="10" height="4" rx="1" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
      <path d="M7 14v7l1.67-1 1.66 1 1.67-1 1.67 1 1.66-1 1.67 1v-7" />
      <path d="M10 17.5h4" />
    </svg>
  )
}
