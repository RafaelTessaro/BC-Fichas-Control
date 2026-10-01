@echo off
REM Atualiza o BC Fichas Control instalado para a versao DESTA pasta: extraia o pacote novo
REM em qualquer pasta e de dois cliques aqui. Os dados e as configuracoes sao mantidos.
REM (Roda deploy\windows\atualizar.ps1 como Administrador.)
setlocal
fltmc >nul 2>&1
if errorlevel 1 (
  if /i "%~1"=="elevado" (
    echo Nao foi possivel obter permissao de administrador.
    pause
    exit /b 1
  )
  echo Pedindo permissao de administrador...
  set "BC_BAT=%~f0"
  powershell -NoProfile -Command "Start-Process -FilePath $env:BC_BAT -ArgumentList 'elevado' -Verb RunAs"
  if errorlevel 1 pause
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\atualizar.ps1"
echo.
pause
