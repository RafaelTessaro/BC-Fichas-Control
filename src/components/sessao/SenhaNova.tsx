// Campos "Nova senha" e "Repetir a nova senha", com a política de senha conferida enquanto a
// pessoa digita (a mesma regra do servidor, em shared/usuarios.ts).

import { CircleCheck, Lightbulb } from 'lucide-react'
import { SENHA_MIN } from '#shared/usuarios.ts'
import { Field } from '../ui/Form'
import { problemasSenhaNova, type Dono } from './auxiliares'
import { CampoSenha } from './CampoSenha'

export function SenhaNova({
  nova,
  repetir,
  aoMudarNova,
  aoMudarRepetir,
  dono,
  tentou,
  erroNova,
  idBase,
  focarNova,
}: {
  nova: string
  repetir: string
  aoMudarNova: (v: string) => void
  aoMudarRepetir: (v: string) => void
  dono: Dono
  /** Já tentou salvar: mostra também os campos vazios. */
  tentou: boolean
  /** Recusa do servidor para a senha nova (ex.: igual à atual). */
  erroNova?: string
  idBase: string
  /** Começa com o cursor na nova senha (quando não há campo antes dela). */
  focarNova?: boolean
}) {
  const problemas = problemasSenhaNova(nova, repetir, dono)
  const mostrarNova = erroNova || ((tentou || nova) && problemas.nova)
  // A repetição só reclama quando já tem o tamanho da nova (ou ao tentar salvar)
  const mostrarRepetir = !problemas.nova && problemas.repetir && (tentou || repetir.length >= nova.length)
  const aceita = !!nova && !problemas.nova && !erroNova
  return (
    <>
      <Field
        label="Nova senha"
        htmlFor={`${idBase}-nova`}
        erro={mostrarNova ? erroNova || problemas.nova : null}
        hint={
          aceita ? (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <CircleCheck className="h-3.5 w-3.5" /> Senha aceita.
            </span>
          ) : (
            `Pelo menos ${SENHA_MIN} caracteres. Letras, números e símbolos são livres.`
          )
        }
      >
        <CampoSenha
          id={`${idBase}-nova`}
          autoComplete="new-password"
          autoFocus={focarNova}
          value={nova}
          onChange={(e) => aoMudarNova(e.target.value)}
          aria-invalid={!!mostrarNova}
        />
      </Field>
      <Field label="Repita a nova senha" htmlFor={`${idBase}-repetir`} erro={mostrarRepetir ? problemas.repetir : null}>
        <CampoSenha
          id={`${idBase}-repetir`}
          autoComplete="new-password"
          value={repetir}
          onChange={(e) => aoMudarRepetir(e.target.value)}
          aria-invalid={!!mostrarRepetir}
        />
      </Field>
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>
          Dica: use uma frase de 3 ou 4 palavras, fácil de lembrar e difícil de adivinhar. Não use o seu nome, datas nem
          sequências.
        </span>
      </p>
    </>
  )
}
