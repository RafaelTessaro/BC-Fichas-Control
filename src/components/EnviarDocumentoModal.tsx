// Envio do recibo (ou do resumo do evento) para o cliente, por WhatsApp ou e-mail.
// WhatsApp: abre a conversa com a mensagem pronta; o link não leva arquivo, então o PDF é baixado
// para anexar na conversa. E-mail: o PDF é gerado aqui no navegador e enviado pelo servidor de
// e-mail da empresa (configurado em Configurações → E-mail).

import {
  AlignLeft,
  CircleAlert,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Mail,
  MailX,
  MessageCircle,
  ReceiptText,
  RotateCcw,
  Send,
  Settings,
  TriangleAlert,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import type { Cliente, Configuracoes, Evento, Maquina } from '#shared/tipos.ts'
import { api, ErroApi, type ConfigEmail } from '../lib/api'
import { cn } from '../lib/cn'
import {
  assuntoEmail,
  linkWhatsApp,
  listaEmails,
  paraBase64,
  telefoneLegivel,
  telefoneWhatsApp,
  textoEmail,
  textoWhatsApp,
  type DocumentoEnvio,
} from '../lib/envio'
import { mascaraTelefone, moeda } from '../lib/format'
import { podeGerarRecibo } from '../lib/recibo'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { Field, Input, Textarea } from './ui/Form'
import { Segmented } from './ui/Misc'
import { Modal } from './ui/Modal'

export type CanalEnvio = 'whatsapp' | 'email'

export interface EnviarDocumentoModalProps {
  aberto: boolean
  aoFechar: () => void
  evento: Evento
  cliente: Cliente | undefined
  /** Por onde enviar ao abrir (dá para trocar dentro da janela). */
  canal: CanalEnvio
}

/** Situação da configuração do e-mail no servidor. */
type EstadoEmail = { tipo: 'carregando' } | { tipo: 'pronto'; config: ConfigEmail } | { tipo: 'erro'; mensagem: string }

/** Gera o PDF escolhido (o jsPDF só é carregado aqui, quando precisa). */
async function gerarPdf(
  documento: Exclude<DocumentoEnvio, 'nenhum'>,
  evento: Evento,
  cliente: Cliente | undefined,
  config: Configuracoes,
  maquinas: Maquina[],
) {
  if (documento === 'recibo') {
    const { gerarReciboPDF } = await import('../lib/pdfRecibo')
    return gerarReciboPDF(evento, cliente, config)
  }
  const { gerarResumoPDF } = await import('../lib/pdf')
  return gerarResumoPDF(evento, cliente, config, maquinas)
}

export function EnviarDocumentoModal({ aberto, aoFechar, evento, cliente, canal: canalInicial }: EnviarDocumentoModalProps) {
  const config = useDados((s) => s.config)
  const maquinas = useDados((s) => s.maquinas)
  const navegar = useNavigate()
  const ids = useId()
  const r = calcularEvento(evento)
  // Recibo: pago em PIX ou dinheiro, com valor
  const temRecibo = podeGerarRecibo(evento) && r.total > 0
  const bobinasAConferir = evento.bobinasConsignadas > 0 && r.conferencia !== 'CONFERIDO'

  const [canal, setCanal] = useState<CanalEnvio>(canalInicial)
  const [documentoEscolhido, setDocumento] = useState<DocumentoEnvio>(temRecibo ? 'recibo' : 'resumo')
  // O pagamento mudou com a janela aberta (ex.: outro computador) e o recibo deixou de valer
  const documento = documentoEscolhido === 'recibo' && !temRecibo ? 'resumo' : documentoEscolhido
  const [para, setPara] = useState('')
  const [telefone, setTelefone] = useState('')
  // `null` = texto sugerido (acompanha o anexo escolhido); ao editar, passa a valer o digitado
  const [assunto, setAssunto] = useState<string | null>(null)
  const [mensagemEmail, setMensagemEmail] = useState<string | null>(null)
  const [mensagemZap, setMensagemZap] = useState<string | null>(null)
  const [email, setEmail] = useState<EstadoEmail>({ tipo: 'carregando' })
  const [ocupado, setOcupado] = useState<'ver' | 'baixar' | 'enviar' | null>(null)
  const [tentou, setTentou] = useState(false)
  const [recarga, setRecarga] = useState(0)

  // Cada vez que abre, começa de novo com os dados atuais do evento e do cliente
  const [abertoAntes, setAbertoAntes] = useState(false)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      setCanal(canalInicial)
      setDocumento(temRecibo ? 'recibo' : 'resumo')
      setPara(cliente?.email ?? '')
      setTelefone(cliente?.telefone ?? '')
      setAssunto(null)
      setMensagemEmail(null)
      setMensagemZap(null)
      setEmail({ tipo: 'carregando' })
      setTentou(false)
    }
  }

  // A configuração do e-mail fica só no servidor: confere a cada vez que a janela abre
  useEffect(() => {
    if (!aberto) return
    let ativo = true
    api
      .configEmail()
      .then((c) => ativo && setEmail({ tipo: 'pronto', config: c }))
      .catch((e: Error) => ativo && setEmail({ tipo: 'erro', mensagem: e.message }))
    return () => {
      ativo = false
    }
  }, [aberto, recarga])

  const dados = { evento, cliente, config, documento }
  const assuntoFinal = assunto ?? assuntoEmail(dados)
  const textoEmailFinal = mensagemEmail ?? textoEmail(dados)
  const textoZapFinal = mensagemZap ?? textoWhatsApp(dados)
  const numero = telefoneWhatsApp(telefone)
  const emails = listaEmails(para)
  const erroPara = !tentou
    ? null
    : !emails.validos.length && !emails.invalidos.length
      ? 'Informe o e-mail de quem vai receber.'
      : emails.invalidos.length
        ? `E-mail inválido: ${emails.invalidos.join(', ')}`
        : null
  const erroAssunto = tentou && !assuntoFinal.trim() ? 'Informe o assunto.' : null
  const emailPronto = email.tipo === 'pronto' && email.config.configurado

  const pdf = async (acao: 'ver' | 'baixar') => {
    if (documento === 'nenhum') return
    // A aba da prévia abre já no clique: aberta depois de gerar o PDF, o navegador poderia bloquear
    const aba = acao === 'ver' ? window.open('', '_blank') : null
    setOcupado(acao)
    try {
      const { doc, nome } = await gerarPdf(documento, evento, cliente, config, maquinas)
      if (acao === 'baixar') {
        doc.save(nome)
        toast.sucesso('PDF baixado', canal === 'whatsapp' ? `${nome}. Agora é só anexar na conversa.` : nome)
      } else if (aba) {
        aba.location.href = String(doc.output('bloburl'))
      } else {
        window.open(doc.output('bloburl'), '_blank')
      }
    } catch (e) {
      aba?.close()
      avisarErro('Não foi possível gerar o PDF', e)
    } finally {
      setOcupado(null)
    }
  }

  const abrirWhatsApp = () => {
    window.open(linkWhatsApp(numero, textoZapFinal.trim()), '_blank', 'noopener')
  }

  const enviarEmail = async () => {
    setTentou(true)
    if (!emails.validos.length || emails.invalidos.length) {
      document.getElementById(`${ids}-para`)?.focus()
      return
    }
    if (!assuntoFinal.trim()) {
      document.getElementById(`${ids}-assunto`)?.focus()
      return
    }
    setOcupado('enviar')
    try {
      let anexos: Array<{ nome: string; tipo: string; conteudo: string }> = []
      if (documento !== 'nenhum') {
        const { doc, nome } = await gerarPdf(documento, evento, cliente, config, maquinas)
        anexos = [{ nome, tipo: 'application/pdf', conteudo: paraBase64(doc.output('arraybuffer')) }]
      }
      const resposta = await api.enviarEmail({
        para: emails.validos.join(', '),
        assunto: assuntoFinal.trim(),
        texto: textoEmailFinal.trim(),
        anexos,
      })
      toast.sucesso('E-mail enviado', `Para ${resposta.para.join(', ')}${anexos.length ? ` • ${anexos[0].nome}` : ''}`)
      aoFechar()
    } catch (e) {
      // Alguém apagou a configuração enquanto a janela estava aberta: mostra o aviso de configurar
      if (e instanceof ErroApi && e.status === 409) setRecarga((n) => n + 1)
      avisarErro('Não foi possível enviar o e-mail', e)
    } finally {
      setOcupado(null)
    }
  }

  const irParaConfiguracoes = () => {
    aoFechar()
    navegar('/configuracoes?secao=email')
  }

  const nomeDocumento = documento === 'recibo' ? 'recibo' : 'resumo'

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-2xl"
      icone={canal === 'whatsapp' ? <MessageCircle className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
      titulo="Enviar para o cliente"
      descricao={`${evento.nome} • ${cliente?.nome ?? 'Cliente removido'} • ${moeda(r.total)}`}
      rodape={
        canal === 'whatsapp' ? (
          <>
            <Button onClick={aoFechar} className="max-sm:hidden">
              Cancelar
            </Button>
            {documento !== 'nenhum' && (
              <Button
                icone={
                  ocupado === 'baixar' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />
                }
                onClick={() => void pdf('baixar')}
                disabled={!!ocupado}
                className="max-sm:flex-1"
              >
                Baixar {nomeDocumento}
              </Button>
            )}
            <Button
              variante="primary"
              icone={<MessageCircle className="h-4 w-4" />}
              onClick={abrirWhatsApp}
              disabled={!textoZapFinal.trim()}
              className="max-sm:flex-1"
            >
              Abrir WhatsApp
            </Button>
          </>
        ) : emailPronto ? (
          <>
            <Button onClick={aoFechar}>Cancelar</Button>
            <Button
              variante="primary"
              icone={ocupado === 'enviar' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void enviarEmail()}
              disabled={!!ocupado}
            >
              {ocupado === 'enviar' ? 'Enviando…' : 'Enviar e-mail'}
            </Button>
          </>
        ) : (
          <Button onClick={aoFechar}>Fechar</Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <Segmented
          valor={canal}
          aoMudar={setCanal}
          className="self-start"
          opcoes={[
            {
              valor: 'whatsapp',
              label: (
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </span>
              ),
            },
            {
              valor: 'email',
              label: (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-4 w-4" />
                  E-mail
                </span>
              ),
            },
          ]}
        />

        {canal === 'email' && !emailPronto ? (
          <AvisoEmail
            estado={email}
            aoConfigurar={irParaConfiguracoes}
            aoTentarDeNovo={() => {
              setEmail({ tipo: 'carregando' })
              setRecarga((n) => n + 1)
            }}
            aoUsarWhatsApp={() => setCanal('whatsapp')}
          />
        ) : (
          <>
            {/* O que vai junto */}
            <div className="flex min-w-0 flex-col gap-2">
              <p id={`${ids}-doc`} className="text-[13px] font-medium text-ink-2">
                {canal === 'whatsapp' ? 'PDF para mandar na conversa' : 'Anexo'}
              </p>
              <div
                role="radiogroup"
                aria-labelledby={`${ids}-doc`}
                className={cn('grid grid-cols-1 gap-2', temRecibo ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}
              >
                {temRecibo && (
                  <OpcaoDocumento
                    ativo={documento === 'recibo'}
                    aoEscolher={() => setDocumento('recibo')}
                    icone={<ReceiptText className="h-4 w-4" />}
                    titulo="Recibo em PDF"
                    detalhe={`${FORMAS_PAGAMENTO[evento.formaPagamento].label} • ${moeda(r.total)}`}
                  />
                )}
                <OpcaoDocumento
                  ativo={documento === 'resumo'}
                  aoEscolher={() => setDocumento('resumo')}
                  icone={<FileText className="h-4 w-4" />}
                  titulo="Resumo do evento"
                  detalhe="PDF: datas, máquinas e valores"
                />
                <OpcaoDocumento
                  ativo={documento === 'nenhum'}
                  aoEscolher={() => setDocumento('nenhum')}
                  icone={<AlignLeft className="h-4 w-4" />}
                  titulo={canal === 'whatsapp' ? 'Só a mensagem' : 'Sem anexo'}
                  detalhe="O resumo vai no texto"
                />
              </div>
              <AnimatePresence initial={false}>
                {documento === 'recibo' && bobinasAConferir && (
                  <Aviso key="bobinas" tom="warning" icone={<TriangleAlert className="h-4 w-4" />}>
                    As bobinas ainda não foram conferidas: o recibo sai só com o que já está calculado ({moeda(r.total)}). Para
                    incluí-las, use “Registrar devolução” antes.
                  </Aviso>
                )}
              </AnimatePresence>
              {documento !== 'nenhum' && (
                <button
                  type="button"
                  onClick={() => void pdf('ver')}
                  disabled={!!ocupado}
                  className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-md text-[13px] font-medium text-brand-ink hover:underline disabled:cursor-wait disabled:opacity-60"
                >
                  {ocupado === 'ver' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  Conferir o {nomeDocumento} antes de enviar
                </button>
              )}
            </div>

            {canal === 'whatsapp' ? (
              <>
                <Field
                  label="Telefone do cliente"
                  htmlFor={`${ids}-tel`}
                  hint={
                    numero ? (
                      <>
                        Abre a conversa com <b className="tnum font-medium text-ink-2">{telefoneLegivel(numero)}</b>.
                      </>
                    ) : telefone.trim() ? (
                      <span className="text-warning">
                        Número incompleto: informe com o DDD, ex.: (19) 99999-9999. Assim, o WhatsApp abre para você escolher o
                        contato.
                      </span>
                    ) : (
                      'Em branco, o WhatsApp abre para você escolher o contato.'
                    )
                  }
                >
                  <Input
                    id={`${ids}-tel`}
                    type="tel"
                    inputMode="tel"
                    value={telefone}
                    onChange={(e) => {
                      // Com + ou com DDI (55...) a máscara cortaria o número: fica só com os dígitos
                      const v = e.target.value
                      const digitos = v.replace(/\D/g, '')
                      setTelefone(v.startsWith('+') ? v : digitos.length > 11 ? digitos : mascaraTelefone(v))
                    }}
                    placeholder="(19) 99999-9999"
                    className="tnum"
                  />
                </Field>
                <CampoMensagem
                  id={`${ids}-zap`}
                  valor={textoZapFinal}
                  editado={mensagemZap !== null}
                  aoMudar={setMensagemZap}
                  dica="Os trechos entre *asteriscos* aparecem em negrito no WhatsApp."
                  linhas={11}
                />
                {documento !== 'nenhum' && (
                  <ol className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
                    <PassoZap n={1}>
                      <b className="font-medium text-ink">Baixe o {nomeDocumento}</b> no botão “Baixar {nomeDocumento}”, aqui
                      embaixo.
                    </PassoZap>
                    <PassoZap n={2}>
                      <b className="font-medium text-ink">Abra o WhatsApp</b> e envie a mensagem (ela já vai escrita).
                    </PassoZap>
                    <PassoZap n={3}>
                      Na conversa, toque no <b className="font-medium text-ink">clipe</b> (ou no{' '}
                      <b className="font-medium text-ink">+</b>), escolha <b className="font-medium text-ink">Documento</b> e
                      anexe o PDF baixado. O link do WhatsApp não leva o arquivo sozinho.
                    </PassoZap>
                  </ol>
                )}
              </>
            ) : (
              <>
                <Field
                  label="Para"
                  htmlFor={`${ids}-para`}
                  erro={erroPara}
                  hint={
                    cliente?.email
                      ? 'E-mail do cadastro do cliente. Para mais de um, separe com vírgula.'
                      : 'Este cliente não tem e-mail no cadastro: digite aqui. Para mais de um, separe com vírgula.'
                  }
                >
                  <Input
                    id={`${ids}-para`}
                    type="email"
                    multiple
                    inputMode="email"
                    autoComplete="email"
                    value={para}
                    onChange={(e) => setPara(e.target.value)}
                    placeholder="cliente@email.com"
                    aria-invalid={!!erroPara}
                    autoFocus={!cliente?.email}
                    className={cn(erroPara && 'border-danger! focus:ring-danger/20!')}
                  />
                </Field>
                <Field
                  label="Assunto"
                  htmlFor={`${ids}-assunto`}
                  erro={erroAssunto}
                  extra={
                    assunto !== null && <BotaoRestaurar aoClicar={() => setAssunto(null)} rotulo="Restaurar o assunto sugerido" />
                  }
                >
                  <Input id={`${ids}-assunto`} value={assuntoFinal} onChange={(e) => setAssunto(e.target.value)} />
                </Field>
                <CampoMensagem
                  id={`${ids}-msg`}
                  valor={textoEmailFinal}
                  editado={mensagemEmail !== null}
                  aoMudar={setMensagemEmail}
                  linhas={12}
                />
                {email.tipo === 'pronto' && (
                  <p className="-mt-2 text-xs text-muted">
                    Sai de{' '}
                    <b className="font-medium text-ink-2">
                      {email.config.remetenteNome
                        ? `${email.config.remetenteNome} <${email.config.remetenteEmail}>`
                        : email.config.remetenteEmail}
                    </b>
                    , o e-mail configurado em Configurações.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function OpcaoDocumento({
  ativo,
  aoEscolher,
  icone,
  titulo,
  detalhe,
}: {
  ativo: boolean
  aoEscolher: () => void
  icone: ReactNode
  titulo: string
  detalhe: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoEscolher}
      className={cn(
        'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo ? 'border-brand/60 bg-brand-soft' : 'border-line-strong/80 hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          ativo ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2',
        )}
      >
        {icone}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[13px] font-semibold', ativo ? 'text-brand-ink' : 'text-ink')}>{titulo}</span>
        <span className="tnum block text-xs text-muted">{detalhe}</span>
      </span>
    </button>
  )
}

function CampoMensagem({
  id,
  valor,
  editado,
  aoMudar,
  dica,
  linhas,
}: {
  id: string
  valor: string
  editado: boolean
  aoMudar: (v: string | null) => void
  dica?: string
  linhas: number
}) {
  return (
    <Field
      label="Mensagem"
      htmlFor={id}
      hint={editado ? 'Mensagem alterada por você.' : (dica ?? 'Texto pronto: altere à vontade antes de enviar.')}
      extra={editado && <BotaoRestaurar aoClicar={() => aoMudar(null)} rotulo="Voltar ao texto sugerido" />}
    >
      <Textarea id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} rows={linhas} className="leading-relaxed" />
    </Field>
  )
}

function BotaoRestaurar({ aoClicar, rotulo }: { aoClicar: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-brand-ink hover:underline"
    >
      <RotateCcw className="h-3 w-3" />
      {rotulo}
    </button>
  )
}

function PassoZap({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <span className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

function Aviso({ tom, icone, children }: { tom: 'warning' | 'danger' | 'info'; icone: ReactNode; children: ReactNode }) {
  const cores = {
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  }
  return (
    <motion.p
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="overflow-hidden"
    >
      <span className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]', cores[tom])}>
        <span className="mt-0.5 shrink-0">{icone}</span>
        <span>{children}</span>
      </span>
    </motion.p>
  )
}

/** E-mail ainda não configurado (ou servidor fora do ar): explica e leva para as Configurações. */
function AvisoEmail({
  estado,
  aoConfigurar,
  aoTentarDeNovo,
  aoUsarWhatsApp,
}: {
  estado: EstadoEmail
  aoConfigurar: () => void
  aoTentarDeNovo: () => void
  aoUsarWhatsApp: () => void
}) {
  if (estado.tipo === 'carregando') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-6 text-[13px] text-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Conferindo a configuração do e-mail…
      </p>
    )
  }
  if (estado.tipo === 'erro') {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-4">
        <p className="flex items-start gap-2 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.mensagem}
        </p>
        <Button tamanho="sm" icone={<RotateCcw className="h-4 w-4" />} onClick={aoTentarDeNovo}>
          Tentar de novo
        </Button>
      </div>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center"
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
        <MailX className="h-6 w-6" />
      </span>
      <p className="text-[15px] font-semibold text-ink">O envio por e-mail ainda não foi configurado</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
        Para o sistema enviar o recibo pelo e-mail da empresa, informe uma vez em{' '}
        <b className="font-medium text-ink-2">Configurações → E-mail para envio de recibos</b> o e-mail (Gmail, Outlook…) e a
        senha de app. Depois é só voltar aqui.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variante="primary" icone={<Settings className="h-4 w-4" />} onClick={aoConfigurar}>
          Configurar e-mail
        </Button>
        <Button icone={<MessageCircle className="h-4 w-4" />} onClick={aoUsarWhatsApp}>
          Enviar pelo WhatsApp
        </Button>
      </div>
    </motion.div>
  )
}
