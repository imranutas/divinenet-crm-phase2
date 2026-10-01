@echo off
setlocal
title Divinenet CRM - local database backup
cd /d "%~dp0"
if defined DIVINENET_NODE_EXE (
  if exist "%DIVINENET_NODE_EXE%" goto explicitNode
  echo The DIVINENET_NODE_EXE file does not exist. No backup was started.
  pause
  exit /b 1
)
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\backup-crm.cjs"
  goto finished
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install it separately or set DIVINENET_NODE_EXE.
  echo This backup command does not download or install anything.
  pause
  exit /b 1
)
node.exe "%~dp0scripts\backup-crm.cjs"
goto finished
:explicitNode
"%DIVINENET_NODE_EXE%" "%~dp0scripts\backup-crm.cjs"
:finished
if errorlevel 1 (
  echo.
  echo Backup did not complete successfully. Read the message above.
  pause
  exit /b 1
)
pause
endlocal
