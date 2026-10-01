<#
  Remove a inicialização automática e a regra de Firewall do BC Fichas Control.
  Os dados (pasta "dados") NÃO são apagados.
  Execute como Administrador.
#>
param([string]$NomeTarefa = 'BC Fichas Control')

Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*server\iniciar.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName $NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Serviço removido. Os dados continuam na pasta "dados".'
