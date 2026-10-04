@echo off
setlocal

set "BENCH_DIR=%~dp0"

set "NODE_BIN=node"
if exist "%~dp0node.exe" set "NODE_BIN=%~dp0node.exe"

where %NODE_BIN% >nul 2>nul
if %errorlevel% neq 0 goto :no_node

set "RUNNER="
if exist "%~dp0tools\bench-daemon\run.mjs" set "RUNNER=%~dp0tools\bench-daemon\run.mjs"
if not defined RUNNER if exist "%~dp0bench.mjs" set "RUNNER=%~dp0bench.mjs"
if not defined RUNNER if exist "%~dp0run.mjs" set "RUNNER=%~dp0run.mjs"
if not defined RUNNER if exist "%~dp0..\..\tools\bench-daemon\run.mjs" set "RUNNER=%~dp0..\..\tools\bench-daemon\run.mjs"
if not defined RUNNER if exist "%~dp0..\..\..\tools\bench-daemon\run.mjs" set "RUNNER=%~dp0..\..\..\tools\bench-daemon\run.mjs"

if not defined RUNNER goto :no_runner

"%NODE_BIN%" "%RUNNER%" %*
set "CODE=%errorlevel%"
if "%~1"=="" pause
exit /b %CODE%

:no_node
echo ======================================================================
echo  [ERROR] Node.js is not found in system PATH.
echo  Please install Node.js 18+ or place node.exe next to this batch file.
echo ======================================================================
pause
exit /b 1

:no_runner
echo ======================================================================
echo  [ERROR] Benchmark runner script not found!
echo  Make sure tools\bench-daemon\run.mjs or bench.mjs is present.
echo ======================================================================
pause
exit /b 1
