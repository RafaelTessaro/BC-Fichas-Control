<#
  Atualiza o BC Fichas Control. A pasta de dados e o .env (porta, pasta dos dados) são mantidos, e
  antes de qualquer mudança é feita uma cópia consistente do banco em dados\backups.

  Pacote completo (recomendado): extraia o pacote novo em qualquer pasta (ex.: C:\BC-Fichas-Control-novo)
  e dê dois cliques em ATUALIZAR.bat dentro dela. O script encontra a instalação atual, troca os
  arquivos do sistema pelos desta pasta e reinicia o servidor. Não precisa de internet. Depois,
  a pasta extraída pode ser apagada.

  Também funciona na própria pasta instalada, depois de copiar os arquivos novos por cima
  (com o código-fonte, roda npm ci e npm run build: precisa de internet). PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\atualizar.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Exigir-Node

$origem = $script:Raiz
$instalada = Pasta-Instalada
if (-not $instalada) { throw 'O BC Fichas Control não está instalado neste computador. Para instalar, use o INSTALAR.bat.' }
if (-not (Test-Path -LiteralPath $instalada)) { throw "A pasta da instalação ($instalada) não existe mais. Instale de novo com o INSTALAR.bat." }
$outraPasta = -not (Mesma-Pasta $instalada $origem)
# Daqui em diante as funções (dados, cópia do banco, permissões) valem para a pasta instalada
$script:Raiz = $instalada

try {
  Write-Host 'Parando o servidor...'
  Parar-Servidor
  $copia = Copiar-Banco 'antes-atualizar'
  if ($copia) { Write-Host "Cópia de segurança: $copia" }

  if ($outraPasta) {
    Write-Host "Copiando a nova versão para $instalada..."
    # Troca cada item do pacote (pastas inteiras, sem sobrar arquivo antigo); dados e .env ficam
    $manter = @('dados', '.env')
    foreach ($item in Get-ChildItem -LiteralPath $origem -Force) {
      if ($manter -contains $item.Name) { continue }
      $alvo = Join-Path $instalada $item.Name
      if (Test-Path -LiteralPath $alvo) { Remove-Item -LiteralPath $alvo -Recurse -Force }
      Copy-Item -LiteralPath $item.FullName -Destination $alvo -Recurse -Force
    }
    # Versão nova sem pacote.json (código-fonte): a marca do pacote antigo não pode ficar
    if (-not (Test-Path (Join-Path $origem 'pacote.json'))) {
      Remove-Item (Join-Path $instalada 'pacote.json') -Force -ErrorAction SilentlyContinue
    }
  }

  Push-Location $instalada
  try {
    if (Test-Path 'pacote.json') {
      Write-Host 'Pacote completo: o Node.js, as dependências e a interface já vêm prontos.'
    } else {
      Executar 'Instalando dependências (npm ci)...' { npm.cmd ci }
      Executar 'Compilando a interface (npm run build)...' { npm.cmd run build }
    }
  } finally { Pop-Location }
  Proteger-Pasta

  Write-Host 'Iniciando o servidor...'
  Start-ScheduledTask -TaskName $script:NomeTarefa
  Start-Sleep -Seconds 4
  $porta = Ler-Porta
  try {
    $saude = Invoke-RestMethod -Uri "http://localhost:$porta/api/saude" -TimeoutSec 5
    Write-Host "Atualização concluída: versão $($saude.versao) no ar." -ForegroundColor Green
  } catch {
    Write-Warning "A atualização terminou, mas o servidor ainda não respondeu em http://localhost:$porta. Veja o registro: $instalada\dados\servidor.log"
  }
  if ($outraPasta) { Write-Host "A pasta $origem já pode ser apagada." }
} catch {
  Write-Host ''
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'O servidor ficou PARADO. Depois de corrigir, rode a atualização de novo (os dados não foram alterados).' -ForegroundColor Red
  exit 1
}
