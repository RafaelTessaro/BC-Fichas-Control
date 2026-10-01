<#
  Volta uma cópia do banco de dados (arquivo .db de dados\backups).
  PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1 -Arquivo C:\BC-Fichas-Control\dados\backups\bc-fichas_2026-10-01_08-00-00_diario.db

  O banco atual é guardado antes em dados\backups (motivo "antes-restaurar-copia"; se ele estiver
  corrompido, os arquivos são guardados como estão, com "-bruto" no nome). O servidor volta a
  funcionar no fim, mesmo se algo der errado.
#>
param([Parameter(Mandatory = $true)][string]$Arquivo)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Exigir-Node
$Arquivo = (Resolve-Path -LiteralPath $Arquivo).ProviderPath
$banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
$temporario = "$banco.restaurando"
$restaurado = $false

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
  Remove-Item $temporario -Force -ErrorAction SilentlyContinue
  Executar 'Preparando a cópia...' { node (Join-Path $script:Ferramentas 'copiar-banco.mjs') $Arquivo $temporario }
  # Os arquivos -wal/-shm pertencem ao banco antigo: se ficarem, o SQLite os aplicaria sobre a cópia
  Remove-Item "$banco-wal", "$banco-shm" -Force -ErrorAction SilentlyContinue
  Move-Item -Force $temporario $banco
  $restaurado = $true
  Write-Host "Cópia restaurada: $Arquivo" -ForegroundColor Green
} catch {
  Remove-Item $temporario -Force -ErrorAction SilentlyContinue
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
