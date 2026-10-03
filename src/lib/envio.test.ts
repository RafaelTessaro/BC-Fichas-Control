import { describe, expect, it } from 'vitest'
import { montarDadosContrato } from '#shared/contrato.ts'
import { CLIENTE_VAZIO, CONFIG_PADRAO } from '#shared/dominio.ts'
import type { Cliente, Evento, NovoContrato } from '#shared/tipos.ts'
import {
  assuntoEmail,
  datasDoEvento,
  linhasContrato,
  linhasResumo,
  linkWhatsApp,
  listaEmails,
  paraBase64,
  primeiroNome,
  primeiroNomeDe,
  telefoneLegivel,
  telefoneWhatsApp,
  textoEmail,
  textoWhatsApp,
} from './envio'

const cliente = (extra: Partial<Cliente> = {}): Cliente => ({
  ...CLIENTE_VAZIO,
  id: 'c1',
  versao: 1,
  criadoEm: '',
  atualizadoEm: '',
  tipo: 'PF',
  nome: 'Juliana Martins',
  ...extra,
})

const evento = (extra: Partial<Evento> = {}): Evento => ({
  id: 'e1',
  versao: 1,
  codigo: 31,
  clienteId: 'c1',
  nome: 'Baile da Cidade',
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'CONCLUIDA',
  dias: [
    { id: 'd1', data: '2026-10-11', maquinas: 3, reservas: 0, reservasUsadas: 0 },
    { id: 'd2', data: '2026-10-12', maquinas: 3, reservas: 0, reservasUsadas: 0 },
  ],
  maquinasIds: [],
  reservasIds: [],
  grupoId: '',
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 0,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'PIX',
  dataPagamento: '2026-10-02',
  status: 'FINALIZADO',
  rodape: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

describe('telefone para o WhatsApp', () => {
  it('acrescenta o 55 nos números com DDD (fixo e celular)', () => {
    expect(telefoneWhatsApp('(19) 98100-1000')).toBe('5519981001000')
    expect(telefoneWhatsApp('19 3524-1234')).toBe('551935241234')
    // DDD 55 (Santa Maria/RS) também é só um DDD
    expect(telefoneWhatsApp('(55) 99123-4567')).toBe('5555991234567')
  })

  it('mantém quem já tem o 55, com ou sem o +', () => {
    expect(telefoneWhatsApp('+55 19 98100-1000')).toBe('5519981001000')
    expect(telefoneWhatsApp('55 (19) 3524-1234')).toBe('551935241234')
  })

  it('ignora o zero de discagem na frente', () => {
    expect(telefoneWhatsApp('019 98100-1000')).toBe('5519981001000')
    expect(telefoneWhatsApp('0055 19 98100-1000')).toBe('5519981001000')
  })

  it('sem DDD, vazio ou com dígitos demais não dá para usar', () => {
    expect(telefoneWhatsApp('')).toBeNull()
    expect(telefoneWhatsApp('98100-1000')).toBeNull()
    expect(telefoneWhatsApp('(19) 9810')).toBeNull()
    expect(telefoneWhatsApp('12 3456 7890 1234')).toBeNull()
    // 12 dígitos sem o 55 na frente não é um número brasileiro
    expect(telefoneWhatsApp('441234567890')).toBeNull()
  })

  it('mostra o número de forma legível', () => {
    expect(telefoneLegivel('5519981001000')).toBe('+55 (19) 98100-1000')
    expect(telefoneLegivel('551935241234')).toBe('+55 (19) 3524-1234')
  })

  it('monta o link com a mensagem; sem número, abre para escolher o contato', () => {
    expect(linkWhatsApp('5519981001000', 'Olá! Total: R$ 480,00 & obrigado')).toBe(
      'https://wa.me/5519981001000?text=Ol%C3%A1!%20Total%3A%20R%24%20480%2C00%20%26%20obrigado',
    )
    expect(linkWhatsApp(null, 'a\nb')).toBe('https://wa.me/?text=a%0Ab')
  })
})

describe('e-mail', () => {
  it('separa os e-mails válidos dos inválidos, sem repetir', () => {
    expect(listaEmails('ana@x.com, bia@y.com.br; ana@x.com')).toEqual({ validos: ['ana@x.com', 'bia@y.com.br'], invalidos: [] })
    expect(listaEmails(' ana@x.com  joao@ ')).toEqual({ validos: ['ana@x.com'], invalidos: ['joao@'] })
    expect(listaEmails('')).toEqual({ validos: [], invalidos: [] })
  })

  it('converte o PDF para base64 (inclusive arquivos grandes, em blocos)', () => {
    expect(paraBase64(new TextEncoder().encode('Man'))).toBe('TWFu')
    expect(paraBase64(new TextEncoder().encode('ção'))).toBe('w6fDo28=')
    expect(paraBase64(new Uint8Array())).toBe('')
    // Maior que um bloco: volta exatamente aos mesmos bytes
    const grande = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
    const volta = Uint8Array.from(atob(paraBase64(grande.buffer)), (c) => c.charCodeAt(0))
    expect(volta).toEqual(grande)
  })
})

describe('textos prontos', () => {
  it('chama pelo primeiro nome: responsável ou pessoa física; empresa sem responsável e avulso, sem nome', () => {
    expect(primeiroNome(cliente())).toBe('Juliana')
    expect(primeiroNome(cliente({ nome: 'JULIANA MARTINS' }))).toBe('Juliana')
    expect(primeiroNome(cliente({ tipo: 'PJ', nome: 'Padaria Ideal', responsavel: 'carlos eduardo' }))).toBe('Carlos')
    expect(primeiroNome(cliente({ nome: 'McArthur Silva' }))).toBe('McArthur')
    expect(primeiroNome(cliente({ tipo: 'PJ', nome: 'Padaria Ideal' }))).toBe('')
    expect(primeiroNome(cliente({ tipo: 'AVULSO', nome: 'Barraca do Seu Zé' }))).toBe('')
    expect(primeiroNome(cliente({ tipo: 'AVULSO', nome: 'Barraca', responsavel: 'Zé' }))).toBe('Zé')
    expect(primeiroNome(undefined)).toBe('')
  })

  it('mantém o tratamento junto com o nome ("Pe. Antônio", "Dona Maria")', () => {
    expect(primeiroNome(cliente({ tipo: 'PJ', nome: 'Paróquia São José', responsavel: 'Pe. Antônio Carlos' }))).toBe(
      'Pe. Antônio',
    )
    expect(primeiroNome(cliente({ nome: 'dona maria aparecida' }))).toBe('Dona Maria')
    expect(primeiroNome(cliente({ nome: 'DRA. ANA LÚCIA' }))).toBe('Dra. Ana')
    expect(primeiroNome(cliente({ tipo: 'PJ', nome: 'Escola', responsavel: 'Prof Marcos' }))).toBe('Prof Marcos')
    expect(primeiroNome(cliente({ tipo: 'PJ', nome: 'Escola', responsavel: 'Padre' }))).toBe('Padre')
    expect(primeiroNome(cliente({ nome: 'Doralice Souza' }))).toBe('Doralice')
  })

  it('escreve as datas sem a preposição do recibo', () => {
    expect(datasDoEvento(['2026-10-11'])).toBe('11/10/2026')
    expect(datasDoEvento(['2026-10-11', '2026-10-12', '2026-10-13'])).toBe('11 a 13/10/2026')
    expect(datasDoEvento(['2026-10-11', '2026-10-12', '2026-10-18'])).toBe('11, 12 e 18/10/2026')
    expect(datasDoEvento(['2026-09-27', '2026-10-04'])).toBe('27/09 e 04/10/2026')
    const soltos = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-11-25']
    expect(datasDoEvento(soltos)).toBe('6 dias, de 01/10 a 25/11/2026')
    expect(datasDoEvento([])).toBe('')
  })

  it('resume evento, datas, total e pagamento', () => {
    expect(linhasResumo({ evento: evento() })).toEqual([
      ['Evento', 'Baile da Cidade (#0031)'],
      ['Datas', '11 a 12/10/2026'],
      ['Valor total', 'R$ 480,00'],
      ['Pagamento', 'PIX, pago em 02/10/2026'],
    ])
    // Não pago, com bobinas ainda não conferidas e um dia só
    expect(
      linhasResumo({
        evento: evento({
          formaPagamento: 'NAO_PAGO',
          dataPagamento: '',
          bobinasConsignadas: 40,
          dias: [{ id: 'd1', data: '2026-10-11', maquinas: 2, reservas: 0, reservasUsadas: 0 }],
        }),
      }),
    ).toEqual([
      ['Evento', 'Baile da Cidade (#0031)'],
      ['Data', '11/10/2026'],
      ['Valor total', 'R$ 160,00 (sem as bobinas, ainda a conferir)'],
      ['Pagamento', 'em aberto'],
    ])
  })

  it('com período corrido, diz até quando as máquinas ficam com o cliente', () => {
    const corrido = evento({
      periodoCorrido: true,
      dias: ['2026-10-03', '2026-10-10', '2026-10-17'].map((data, i) => ({
        id: `d${i}`,
        data,
        maquinas: 4,
        reservas: 0,
        reservasUsadas: 0,
      })),
    })
    expect(linhasResumo({ evento: corrido })).toContainEqual(['Máquinas com vocês', 'de 03/10/2026 a 17/10/2026'])
    // Sem período corrido, a linha não aparece
    expect(linhasResumo({ evento: { ...corrido, periodoCorrido: false } }).map(([r]) => r)).not.toContain('Máquinas com vocês')
  })

  it('assunto do e-mail conforme o anexo', () => {
    const base = { evento: evento(), cliente: cliente(), config: CONFIG_PADRAO }
    expect(assuntoEmail({ ...base, documento: 'recibo' })).toBe('Recibo nº 0031 – Baile da Cidade – Balanças.com')
    expect(assuntoEmail({ ...base, documento: 'resumo' })).toBe('Resumo da locação – Baile da Cidade – Balanças.com')
    expect(assuntoEmail({ ...base, documento: 'nenhum', config: { empresaNome: '', empresaRazaoSocial: '' } })).toBe(
      'Resumo da locação – Baile da Cidade',
    )
  })

  it('e-mail com o recibo em anexo', () => {
    expect(textoEmail({ evento: evento(), cliente: cliente(), config: CONFIG_PADRAO, documento: 'recibo' })).toBe(
      [
        'Olá, Juliana!',
        '',
        'Segue em anexo o recibo do pagamento da locação das máquinas de fichas.',
        '',
        'Evento: Baile da Cidade (#0031)',
        'Datas: 11 a 12/10/2026',
        'Valor total: R$ 480,00',
        'Pagamento: PIX, pago em 02/10/2026',
        '',
        'Qualquer dúvida, estamos à disposição.',
        '',
        'Atenciosamente,',
        'Balanças.com',
      ].join('\n'),
    )
  })

  it('e-mail sem anexo e sem nome de quem recebe', () => {
    const texto = textoEmail({
      evento: evento(),
      cliente: cliente({ tipo: 'PJ', nome: 'Padaria Ideal' }),
      config: CONFIG_PADRAO,
      documento: 'nenhum',
    })
    expect(texto.startsWith('Olá!\n\nSegue o resumo da locação das máquinas de fichas.\n')).toBe(true)
  })

  it('mensagem do WhatsApp com negrito e o aviso do PDF', () => {
    expect(textoWhatsApp({ evento: evento(), cliente: cliente(), config: CONFIG_PADRAO, documento: 'recibo' })).toBe(
      [
        'Olá, Juliana! Tudo bem?',
        '',
        'Segue o recibo do pagamento da locação das máquinas de fichas:',
        '',
        '*Evento:* Baile da Cidade (#0031)',
        '*Datas:* 11 a 12/10/2026',
        '*Valor total:* R$ 480,00',
        '*Pagamento:* PIX, pago em 02/10/2026',
        '',
        'O recibo em PDF vai logo abaixo.',
        'Qualquer dúvida, estamos à disposição.',
        'Balanças.com',
      ].join('\n'),
    )
    const soTexto = textoWhatsApp({ evento: evento(), cliente: undefined, config: CONFIG_PADRAO, documento: 'nenhum' })
    expect(soTexto.startsWith('Olá! Tudo bem?\n\nSegue o resumo da locação das máquinas de fichas:')).toBe(true)
    expect(soTexto).not.toContain('PDF')
  })
})

describe('contrato de locação', () => {
  const entrada = (extra: Partial<Omit<NovoContrato, 'eventoId'>> = {}): Omit<NovoContrato, 'eventoId'> => ({
    local: 'Salão paroquial',
    retirada: { data: '2026-10-10', hora: '09:00' },
    devolucao: { data: '2026-10-13', hora: '' },
    assinante: { nome: 'Juliana Martins', cpf: '' },
    condicoes: '',
    ...extra,
  })
  const contrato = (
    c: Cliente | undefined = cliente(),
    e: Evento = evento(),
    extra?: Partial<Omit<NovoContrato, 'eventoId'>>,
  ) => ({
    numero: 7,
    dados: montarDadosContrato({
      evento: e,
      cliente: c,
      maquinas: [],
      config: CONFIG_PADRAO,
      entrada: entrada(extra),
      hoje: '2026-10-01',
    }),
  })
  const base = { evento: evento(), cliente: cliente(), config: CONFIG_PADRAO, documento: 'contrato' as const }

  it('assunto com o número do contrato e o nome do evento como saiu nele', () => {
    expect(assuntoEmail({ ...base, contrato: contrato() })).toBe('Contrato de locação nº 0007 – Baile da Cidade – Balanças.com')
    // O evento foi renomeado depois: vale o nome que está no contrato
    expect(assuntoEmail({ ...base, evento: evento({ nome: 'Outro nome' }), contrato: contrato() })).toContain('Baile da Cidade')
    expect(assuntoEmail({ ...base, config: { empresaNome: '', empresaRazaoSocial: '' }, contrato: contrato() })).toBe(
      'Contrato de locação nº 0007 – Baile da Cidade',
    )
  })

  it('linhas: evento, datas de uso, retirada, devolução (sem hora, só a data) e valor das diárias', () => {
    expect(linhasContrato(contrato())).toEqual([
      ['Evento', 'Baile da Cidade (#0031) - Salão paroquial'],
      ['Datas de uso', '11 a 12/10/2026'],
      ['Retirada', '10/10/2026, às 09h00'],
      ['Devolução', '13/10/2026'],
      ['Valor das diárias', 'R$ 480,00'],
    ])
    // Sem datas combinadas e um dia só; período corrido mostra até quando as máquinas ficam
    const corrido = evento({
      periodoCorrido: true,
      dias: ['2026-10-03', '2026-10-10'].map((data, i) => ({ id: `d${i}`, data, maquinas: 2, reservas: 0, reservasUsadas: 0 })),
    })
    const linhas = linhasContrato(
      contrato(cliente(), corrido, { local: '', retirada: { data: '', hora: '' }, devolucao: { data: '', hora: '' } }),
    )
    expect(linhas).toContainEqual(['Máquinas com vocês', 'de 03/10/2026 a 10/10/2026'])
    expect(linhas).toContainEqual(['Retirada', 'a combinar'])
    expect(linhas[0]).toEqual(['Evento', 'Baile da Cidade (#0031)'])
  })

  it('e-mail pede para ler antes da retirada e explica as duas formas de assinar', () => {
    const texto = textoEmail({ ...base, contrato: contrato() })
    expect(texto.split('\n').slice(0, 3)).toEqual([
      'Olá, Juliana!',
      '',
      'Segue em anexo o contrato de locação nº 0007 das máquinas de fichas. Por favor, leia com calma antes da retirada.',
    ])
    expect(texto).toContain('Valor das diárias: R$ 480,00')
    expect(texto).toContain('imprimir, assinar e trazer na retirada')
    expect(texto).toContain('https://assinador.iti.br')
    expect(texto.endsWith('Atenciosamente,\nBalanças.com')).toBe(true)
    // O recibo continua sem as instruções de assinatura
    expect(textoEmail({ ...base, documento: 'recibo' })).not.toContain('assinador')
  })

  it('WhatsApp com negrito, o aviso do PDF e o gov.br', () => {
    const texto = textoWhatsApp({ ...base, contrato: contrato() })
    expect(texto).toContain('Olá, Juliana! Tudo bem?\n\nSegue o contrato de locação nº 0007 das máquinas de fichas.')
    expect(texto).toContain('*Retirada:* 10/10/2026, às 09h00')
    expect(texto).toContain('O contrato em PDF vai logo abaixo.')
    expect(texto).toContain('assinador.iti.br')
  })

  it('empresa sem responsável no cadastro: chama quem assina pelo cliente', () => {
    const empresa = cliente({ tipo: 'PJ', nome: 'Padaria Ideal' })
    const c = contrato(empresa, evento(), { assinante: { nome: 'carlos eduardo', cpf: '' } })
    expect(textoWhatsApp({ ...base, cliente: empresa, contrato: c }).startsWith('Olá, Carlos! Tudo bem?')).toBe(true)
    // No recibo continua sem nome (o assinante é só do contrato)
    expect(textoEmail({ ...base, cliente: empresa, documento: 'recibo' }).startsWith('Olá!')).toBe(true)
  })

  it('primeiro nome a partir de um nome completo', () => {
    expect(primeiroNomeDe('  maria aparecida souza ')).toBe('Maria')
    expect(primeiroNomeDe('Pe. Antônio Carlos')).toBe('Pe. Antônio')
    expect(primeiroNomeDe('')).toBe('')
    expect(primeiroNomeDe('123')).toBe('')
  })
})
