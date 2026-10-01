<#
  Volta uma cópia do banco de dados (arquivo .db de dados\backups).
  PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\restaurar-copia.ps1 -Arquivo C:\BC-Fichas\dados\backups\bc-fichas_2026-10-01_08-00-00_diario.db

  O banco atual é guardado antes em dados\backups (motivo "antes-restaurar-copia").
#>
param([Parameter(Mandatory = $true)][string]$Arquivo)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Exigir-Node
$Arquivo = (Resolve-Path $Arquivo).Path
$banco = Join-Path (Pasta-Dados) 'bc-fichas.db'

Write-Host 'Parando o servidor...'
Parar-Servidor
$copia = Copiar-Banco 'antes-restaurar-copia'
if ($copia) { Write-Host "Banco atual guardado em: $copia" }

# Os arquivos -wal/-shm pertencem ao banco antigo: se ficarem, o SQLite os aplicaria sobre a cópia
Remove-Item "$banco-wal", "$banco-shm" -Force -ErrorAction SilentlyContinue
$temporario = "$banco.restaurando"
Remove-Item $temporario -Force -ErrorAction SilentlyContinue
Executar 'Preparando a cópia...' { node (Join-Path $script:Raiz 'server\ferramentas\copiar-banco.mjs') $Arquivo $temporario }
Move-Item -Force $temporario $banco

Start-ScheduledTask -TaskName $script:NomeTarefa
Write-Host "Cópia restaurada: $Arquivo" -ForegroundColor Green
