<#
  Atualiza o BC Fichas Control depois de copiar a nova versão dos arquivos por cima da pasta
  (a pasta "dados" é preservada). PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\atualizar.ps1
  Antes de qualquer mudança é feita uma cópia consistente do banco em dados\backups.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Exigir-Node

Push-Location $script:Raiz
try {
  Write-Host 'Parando o servidor...'
  Parar-Servidor
  $copia = Copiar-Banco 'antes-atualizar'
  if ($copia) { Write-Host "Cópia de segurança: $copia" }

  Executar 'Instalando dependências (npm ci)...' { npm.cmd ci }
  Executar 'Compilando a interface (npm run build)...' { npm.cmd run build }
  Proteger-Pasta

  Write-Host 'Iniciando o servidor...'
  Start-ScheduledTask -TaskName $script:NomeTarefa
  Write-Host 'Atualização concluída.' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'O servidor ficou PARADO. Depois de corrigir (ex.: internet para baixar os pacotes), rode este script de novo.' -ForegroundColor Red
  exit 1
} finally { Pop-Location }
