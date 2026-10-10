<#
  Remove a inicialização automática, a regra de Firewall e o atalho do Menu Iniciar do BC Fichas Control.
  Os dados (pasta "dados") NÃO são apagados. PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\desinstalar-servico.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Parar-Servidor
Unregister-ScheduledTask -TaskName $script:NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName $script:NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Remover-AtalhoRedefinirSenha
Write-Host 'Serviço removido. Os dados continuam na pasta "dados".'
