@echo off
REM Instala o BC Fichas Control neste computador: dois cliques e "Sim" no pedido de permissao.
REM (Roda deploy\windows\instalar-servico.ps1 como Administrador.)
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\instalar-servico.ps1"
echo.
pause
