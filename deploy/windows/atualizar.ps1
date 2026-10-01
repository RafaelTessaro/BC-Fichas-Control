<#
  Atualiza o BC Fichas Control depois de copiar a nova versão dos arquivos para a pasta
  (ou de rodar "git pull"). Execute como Administrador.
  Antes de atualizar, o servidor faz uma cópia do banco em dados\backups.
#>
param([string]$NomeTarefa = 'BC Fichas Control')

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $raiz

Write-Host 'Parando o servidor...'
Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*server\iniciar.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path 'dados\bc-fichas.db') {
  New-Item -ItemType Directory -Force -Path 'dados\backups' | Out-Null
  $carimbo = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  Copy-Item 'dados\bc-fichas.db' "dados\backups\bc-fichas_${carimbo}_antes-atualizar.db"
}

Write-Host 'Instalando dependências e compilando...'
npm ci
npm run build

Write-Host 'Iniciando o servidor...'
Start-ScheduledTask -TaskName $NomeTarefa
Pop-Location
Write-Host 'Atualização concluída.' -ForegroundColor Green
