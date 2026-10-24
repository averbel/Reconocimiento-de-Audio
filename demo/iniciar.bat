@echo off
chcp 65001 >nul
title Demo - Iniciando
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Descargalo en https://nodejs.org ^(version LTS^) y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias ^(solo la primera vez, requiere internet^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo No se pudieron instalar las dependencias. Revisa tu conexion a internet y vuelve a intentarlo.
    pause
    exit /b 1
  )
)

rem Busca un puerto libre a partir del 3000
for /f %%p in ('powershell -NoProfile -Command "$p=3000; while (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { $p++ }; $p"') do set PORT=%%p
if not defined PORT set PORT=3000

echo Iniciando el servidor en el puerto %PORT%...
start "Servidor de la demo (cierra esta ventana para detenerlo)" cmd /k "npm start"

rem Espera a que el servidor responda antes de abrir el navegador (hasta 60 s)
powershell -NoProfile -Command "for ($i=0; $i -lt 120; $i++) { try { Invoke-WebRequest http://localhost:%PORT%/ -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo.
  echo El servidor no respondio. Revisa los mensajes de la ventana "Servidor de la demo".
  pause
  exit /b 1
)

echo Listo: http://localhost:%PORT%
if not defined NO_BROWSER start "" http://localhost:%PORT%
exit /b 0