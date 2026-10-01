import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErroInesperado } from './components/ErroInesperado'
import './index.css'

// Depois de uma atualização do servidor, os arquivos antigos (ex.: o gerador de PDF, carregado
// sob demanda) deixam de existir: recarrega a página uma vez para pegar a versão nova.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const ultima = Number(sessionStorage.getItem('bc-fichas:recarregou') ?? 0)
    if (Date.now() - ultima < 30_000) return
    sessionStorage.setItem('bc-fichas:recarregou', String(Date.now()))
  } catch {
    /* sem sessionStorage */
  }
  e.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErroInesperado>
      <App />
    </ErroInesperado>
  </StrictMode>,
)
