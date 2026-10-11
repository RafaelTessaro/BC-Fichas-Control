<#
  Volta uma cópia do banco de dados (arquivo .db de dados\backups).
  PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1

  Sem -Arquivo, a janela lista as cópias mais recentes de dados\backups e pede o número. Também dá para
  informar a cópia: só o nome do arquivo (procurado em dados\backups) ou o caminho completo:
    ... restaurar-copia.ps1 -Arquivo bc-fichas_2026-10-01_08-00-00_diario.db
    ... restaurar-copia.ps1 -Arquivo E:\BC-Fichas-dados\backups\bc-fichas_2026-10-01_08-00-00_diario.db

  O banco atual é guardado antes em dados\backups (motivo "antes-restaurar-copia"; se ele estiver
  corrompido, os arquivos são guardados como estão, com "-bruto" no nome). O servidor volta a
  funcionar no fim, mesmo se algo der errado.

  Os usuários, as senhas e o registro de atividades continuam os de hoje (a cópia antiga não traz de
  volta senhas antigas nem contas excluídas), e todas as sessões são encerradas: quem estava no
  sistema entra de novo. As contas voltam como estavam na cópia quando o banco atual está ilegível,
  quando ele não tem nenhuma conta (computador novo) ou com -ContasDaCopia (trocar o servidor de
  computador). Se a cópia tiver usuários que hoje não existem, a janela pergunta quais manter
  (-SemPerguntas: mantém os de hoje e avisa quais ficaram de fora). No fim, se não houver
  administrador, pede para criar um (-SemPerguntas: só avisa).
#>
param(
  [string]$Arquivo,
  [switch]$ContasDaCopia,
  [switch]$SemPerguntas
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

$interativo = -not $SemPerguntas -and [Environment]::UserInteractive

# Cópia escolhida: o caminho informado, só o nome (procurado em dados\backups) ou, sem -Arquivo, uma
# da lista das mais recentes.
function Escolher-Copia([string]$Informado) {
  $pasta = Join-Path (Pasta-Dados) 'backups'
  if ($Informado) {
    if (Test-Path -LiteralPath $Informado -PathType Leaf) { return (Resolve-Path -LiteralPath $Informado).ProviderPath }
    $naPasta = Join-Path $pasta $Informado
    if (-not [IO.Path]::IsPathRooted($Informado) -and (Test-Path -LiteralPath $naPasta -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $naPasta).ProviderPath
    }
    throw "Cópia não encontrada: $Informado (nem em $pasta)."
  }
  if (-not $interativo) { throw 'Informe a cópia com -Arquivo.' }
  $copias = @(Get-ChildItem -LiteralPath $pasta -Filter 'bc-fichas_*.db' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -eq '.db' } | Sort-Object LastWriteTime -Descending | Select-Object -First 15)
  if ($copias.Count -eq 0) { throw "Nenhuma cópia em $pasta. Informe o arquivo com -Arquivo." }
  Write-Host ''
  Write-Host 'Cópias do banco (a mais recente primeiro):'
  for ($i = 0; $i -lt $copias.Count; $i++) {
    Write-Host ('  {0,2}. {1}  {2}' -f ($i + 1), $copias[$i].LastWriteTime.ToString('dd/MM/yyyy HH:mm'), $copias[$i].Name)
  }
  while ($true) {
    $resposta = Ler-Texto 'Número da cópia que vai voltar (Enter = desistir)'
    if (-not $resposta) {
      Write-Host 'Nada foi restaurado.'
      exit 1
    }
    $n = 0
    if ([int]::TryParse($resposta, [ref]$n) -and $n -ge 1 -and $n -le $copias.Count) { return $copias[$n - 1].FullName }
    Write-Host "Digite um número de 1 a $($copias.Count)." -ForegroundColor Red
  }
}

# "dono, maria, jose e mais 3"
function Resumo-Logins($Logins) {
  $lista = @($Logins)
  if ($lista.Count -eq 0) { return 'nenhum' }
  $texto = ($lista | Select-Object -First 5) -join ', '
  if ($lista.Count -gt 5) { $texto += " e mais $($lista.Count - 5)" }
  return $texto
}

# A cópia tem usuários que hoje não existem (ex.: o servidor mudou de computador e o INSTALAR criou só o
# administrador)? Pergunta quais contas manter. Sem perguntas, ou sem como ler os bancos: as de hoje.
function Perguntar-ContasDaCopia([string]$Atual, [string]$Copia) {
  if (-not $interativo) { return $false }
  try {
    $hoje = @((Ferramenta-Usuarios 'situacao' @($Atual)).lista | ForEach-Object { $_.login })
    $daCopia = @((Ferramenta-Usuarios 'situacao' @($Copia)).lista | ForEach-Object { $_.login })
  } catch {
    # Banco atual ilegível: a ferramenta já deixa as contas da cópia
    return $false
  }
  # Sem nenhuma conta hoje, as da cópia voltam sozinhas
  if ($hoje.Count -eq 0) { return $false }
  $novos = @($daCopia | Where-Object { $hoje -notcontains $_ })
  if ($novos.Count -eq 0) { return $false }
  Write-Host ''
  Write-Host ('A cópia tem {0} usuário(s) ({1}); hoje há {2} ({3}).' -f $daCopia.Count, (Resumo-Logins $daCopia), $hoje.Count, (Resumo-Logins $hoje)) -ForegroundColor Yellow
  Write-Host 'Para voltar uma cópia antiga neste mesmo servidor, mantenha os de HOJE (as senhas antigas não voltam).' -ForegroundColor Yellow
  Write-Host 'Ao trocar o servidor de computador, escolha os da CÓPIA (as contas e senhas voltam como estavam nela).' -ForegroundColor Yellow
  while ($true) {
    $r = Ler-Texto 'Manter os usuários de HOJE [H] (Enter) ou os da CÓPIA [C]?'
    if (-not $r -or $r -match '^h') { return $false }
    if ($r -match '^c') { return $true }
    Write-Host 'Responda H (hoje) ou C (cópia).' -ForegroundColor Red
  }
}

Confirmar-Administrador
Exigir-Node
$Arquivo = Escolher-Copia $Arquivo
$banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
$temporario = "$banco.restaurando"
$restaurado = $false

Write-Host "Cópia que vai voltar: $Arquivo"
Write-Host 'Parando o servidor...'
Parar-Servidor
try {
  try { $copia = Copiar-Banco 'antes-restaurar-copia' }
  catch {
    # Banco atual corrompido (um dos motivos para restaurar): guarda os arquivos como estão
    Write-Warning "A cópia normal do banco atual falhou ($($_.Exception.Message)). Guardando os arquivos como estão."
    $copia = Copiar-Bruto 'antes-restaurar-copia'
  }
  if ($copia) { Write-Host "Banco atual guardado em: $copia" }

  # Prepara a cópia escolhida antes de mexer no banco atual
  Remove-Item $temporario, "$temporario-wal", "$temporario-shm" -Force -ErrorAction SilentlyContinue
  Executar 'Preparando a cópia...' { node (Join-Path $script:Ferramentas 'copiar-banco.mjs') $Arquivo $temporario }
  # A cópia recebe os usuários e o registro de atividades de hoje (ou fica com os dela), sem nenhuma sessão aberta
  $usarContasDaCopia = $ContasDaCopia -or (Perguntar-ContasDaCopia $banco $temporario)
  $argumentos = @($banco, $temporario)
  if ($usarContasDaCopia) {
    Write-Host 'Mantendo os usuários e as senhas da cópia...'
    $argumentos += '--contas-da-copia'
  } else {
    Write-Host 'Conferindo os usuários e as senhas...'
  }
  $transplante = Ferramenta-Usuarios 'transplantar' $argumentos
  if ($transplante.transplantado) {
    $foraDaCopia = @(@($transplante.loginsCopia) | Where-Object { @($transplante.loginsAtuais) -notcontains $_ })
    if ($foraDaCopia.Count -gt 0) {
      Write-Warning ("Ficaram os usuários e as senhas de hoje ({0}). Os da cópia que hoje não existem ficaram de fora: {1}. Se o servidor mudou de computador e você queria as contas da cópia, rode de novo com -ContasDaCopia (ou responda C)." -f $transplante.usuarios, ($foraDaCopia -join ', '))
    } else {
      Write-Host "Ficaram os usuários e as senhas de hoje ($($transplante.usuarios)); as senhas da cópia foram descartadas."
    }
  } elseif ($usarContasDaCopia) {
    Write-Host "As contas e as senhas voltaram como estavam na cópia ($(Resumo-Logins $transplante.loginsCopia))."
  } else {
    Write-Warning $transplante.aviso
  }
  Remove-Item "$temporario-wal", "$temporario-shm" -Force -ErrorAction SilentlyContinue
  # Os arquivos -wal/-shm pertencem ao banco antigo: se ficarem, o SQLite os aplicaria sobre a cópia
  Remove-Item "$banco-wal", "$banco-shm" -Force -ErrorAction SilentlyContinue
  Move-Item -Force $temporario $banco
  $restaurado = $true
  Write-Host "Cópia restaurada: $Arquivo" -ForegroundColor Green
} catch {
  Remove-Item $temporario, "$temporario-wal", "$temporario-shm" -Force -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Nada foi restaurado: o banco atual continua o mesmo.' -ForegroundColor Red
} finally {
  Write-Host 'Iniciando o servidor...'
  Start-ScheduledTask -TaskName $script:NomeTarefa
  $porta = Ler-Porta
  if (Esperar-Servidor $porta) { Write-Host 'Servidor no ar.' -ForegroundColor Green }
  else { Write-Warning "O servidor ainda não respondeu em http://localhost:$porta. Veja o registro: $($script:Raiz)\dados\servidor.log" }
}
if (-not $restaurado) { exit 1 }
Garantir-Administrador -SemPerguntas:$SemPerguntas
