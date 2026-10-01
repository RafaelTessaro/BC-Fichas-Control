<#
  Remove a inicialização automática e a regra de Firewall do BC Fichas Control.
  Os dados (pasta "dados") NÃO são apagados. PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\desinstalar-servico.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Parar-Servidor
Unregister-ScheduledTask -TaskName $script:NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName $script:NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Serviço removido. Os dados continuam na pasta "dados".'
