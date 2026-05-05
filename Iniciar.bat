@echo off
title CaixaLivre
cd /d "%~dp0"

echo Iniciando backend...
start "CaixaLivre - Backend" cmd /k "cd /d \"%~dp0backend\" && node src/server.js"

echo Iniciando frontend...
start "CaixaLivre - Frontend" cmd /k "cd /d \"%~dp0\" && npm run dev"

echo Aguardando servidores subirem...
timeout /t 5 /nobreak >nul

echo Abrindo navegador...
start "" "http://localhost:5173"
