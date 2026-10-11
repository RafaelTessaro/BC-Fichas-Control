<#
  Cria o administrador ou redefine a senha de qualquer usuário do BC Fichas Control, no computador do
  servidor: esqueceu a senha, perdeu o administrador ou a conta ficou bloqueada por tentativas erradas.

  Use o atalho: no Iniciar, digite BC Fichas e abra "Redefinir senha do BC Fichas" (ou procure em Todos
  os aplicativos > BC Fichas Control); ele pede a permissão de administrador. Sem o atalho, dê dois
  cliques no REDEFINIR-SENHA.bat de um pacote do sistema.
  Nunca abra a pasta instalada pelo Explorer para isso: o Windows gravaria a sua conta nas permissões dela.

  Usa sempre a instalação (a ferramenta, o .env e o banco de lá), mesmo quando roda de um pacote novo.
  Não precisa parar o servidor: a senha nova vale na hora, o bloqueio daquele usuário acaba e as
  sessões abertas daquela conta caem em até 1 minuto. O bloqueio de um computador que errou muitas
  vezes, com usuários diferentes, não acaba: dura até 15 minutos.

  PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\redefinir-senha.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

try {
  Confirmar-Administrador
  # Ferramenta e .env da instalação: o código de um pacote mais novo nunca migra o banco antes da atualização
  $instalada = Pasta-Instalada
  if (-not $instalada -or -not (Test-Path -LiteralPath $instalada)) {
    throw 'O BC Fichas Control não está instalado neste computador.'
  }
  $script:Raiz = $instalada
  $script:Ferramentas = Join-Path $instalada 'server\ferramentas'
  if (-not (Test-Path -LiteralPath (Join-Path $script:Ferramentas 'redefinir-senha.mjs'))) {
    throw "A versão instalada em $instalada ainda não tem usuários e senhas. Atualize primeiro com o ATUALIZAR.bat do pacote novo."
  }
  Exigir-Node
  $banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
  if (-not (Test-Path -LiteralPath $banco)) {
    throw "O banco de dados ($banco) ainda não existe: o servidor ainda não foi iniciado. Confira se o sistema abre no navegador e rode de novo."
  }

  Write-Host ''
  Write-Host 'BC Fichas Control: criar o administrador ou redefinir uma senha' -ForegroundColor Cyan
  for ($tentativa = 1; $tentativa -le 20; $tentativa++) {
    $situacao = Ferramenta-Usuarios 'situacao' @($banco)
    $lista = @($situacao.lista)
    Write-Host ''
    if ($lista.Count -eq 0) {
      Write-Host 'Nenhum usuário cadastrado ainda. Vamos criar o ADMINISTRADOR (acesso a tudo).' -ForegroundColor Yellow
      $login = Ler-Texto 'Usuário para entrar no sistema (sem acentos nem espaços, ex.: fabio; Enter = admin)'
      if (-not $login) { $login = 'admin' }
    } else {
      Write-Host 'Usuários cadastrados:'
      Mostrar-Usuarios $lista
      if ($situacao.administradoresAtivos -eq 0) {
        Write-Host 'Nenhum administrador ativo: escolha uma conta para tornar administrador ou digite um usuário novo.' -ForegroundColor Yellow
      }
      Write-Host ''
      $login = Ler-Texto 'Usuário que vai receber a senha nova (ou um usuário novo, sem acentos nem espaços, para criar outro administrador)'
      if (-not $login) { continue }
    }
    # Usuário inválido: avisa já, antes de perguntar mais nada
    $erroLogin = Erro-Usuario $login
    if ($erroLogin) {
      Write-Host $erroLogin -ForegroundColor Red
      continue
    }

    $entrada = @{ login = $login }
    $conta = $lista | Where-Object { $_.login -eq $login } | Select-Object -First 1
    if ($conta) {
      if (-not $conta.ativo) { Write-Host 'Esta conta está desativada: com a senha nova, ela volta a ficar ativa.' -ForegroundColor Yellow }
      if ($conta.nivel -ne 'ADMIN') { $entrada.tornarAdmin = Perguntar-SimNao "Tornar $($conta.nome) administrador? (S/N)" }
    } else {
      if ($lista.Count -gt 0 -and -not (Perguntar-SimNao "Não existe o usuário '$login'. Criar um ADMINISTRADOR novo com ele? (S/N)")) {
        continue
      }
      $entrada.nome = Ler-Nome 'Nome de quem vai usar a conta (ex.: Fabio Souza)'
      $entrada.tornarAdmin = $true
    }
    # Senha recusada: pede só a senha de novo
    $resultado = Definir-ComSenha $banco $entrada
    if (-not $resultado) {
      Write-Host 'Vamos tentar de novo (para desistir, feche esta janela).'
      continue
    }
    Mostrar-ContaDefinida $resultado
    if (-not $resultado.criado) {
      Write-Host '  O bloqueio deste usuário por senha errada acabou e as sessões abertas dele foram encerradas.'
      Write-Host '  Se a tela de entrada ainda disser "Muitas tentativas erradas neste computador" (muitas senhas'
      Write-Host '  erradas no mesmo computador), espere o tempo que ela mostra (no máximo 15 minutos) ou entre por outro computador.'
    }
    Write-Host ''
    Write-Host 'Pronto. Não precisa reiniciar o servidor.' -ForegroundColor Green
    exit 0
  }
  throw 'Muitas tentativas. Rode o atalho de novo.'
} catch {
  Write-Host ''
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
