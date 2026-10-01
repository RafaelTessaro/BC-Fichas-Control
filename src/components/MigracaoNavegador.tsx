import { UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { comoBackup, lerDadosLocaisAntigos, marcarDadosLocaisComoEnviados } from '../lib/migracaoLocal'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

/** Oferece enviar ao servidor os dados que a versão anterior guardou neste navegador. */
export function MigracaoNavegador() {
  const mesclarDadosAntigos = useDados((s) => s.mesclarDadosAntigos)
  const [locais, setLocais] = useState(lerDadosLocaisAntigos)
  const [enviando, setEnviando] = useState(false)
  if (!locais) return null

  const enviar = async () => {
    setEnviando(true)
    try {
      // Acrescenta aos dados do servidor (nunca apaga): cada computador pode enviar os seus
      const r = await mesclarDadosAntigos(comoBackup(locais))
      marcarDadosLocaisComoEnviados()
      setLocais(null)
      toast.sucesso(
        'Dados enviados ao servidor',
        `${r.clientes} clientes e ${r.eventos} eventos acrescentados${r.ignorados ? ` (${r.ignorados} já estavam no servidor)` : ''}.`,
      )
    } catch (e) {
      avisarErro('Não foi possível enviar os dados', e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="mb-6 flex flex-col gap-4 border-info/30 p-5 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Encontramos dados da versão anterior neste navegador</p>
          <p className="mt-0.5 text-sm text-muted">
            {locais.clientes.length} clientes e {locais.eventos.length} eventos. Envie para o servidor para usá-los em todos os
            computadores — eles serão acrescentados aos que já estão lá, sem apagar nada.
          </p>
        </div>
        <Button variante="primary" onClick={enviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar para o servidor'}
        </Button>
      </Card>
    </motion.div>
  )
}
