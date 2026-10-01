@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Select a backup explicitly: RESTORE-CRM.cmd "C:\full path\backup.sqlite"
  echo This validates only. Add --apply after stopping the CRM to restore it.
  pause
  exit /b 1
)
node.exe "%~dp0scripts\restore-crm.cjs" %*
endlocal
