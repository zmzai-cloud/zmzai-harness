@echo off
REM ============================================================================
REM  Lectern Windows Diagnostic Script
REM  Usage: double-click this file -> it writes Desktop\lectern-diag.txt
REM  Send that file back to us. It contains NO password / NO token.
REM  NOTE: all text below is ASCII-only on purpose (Windows console
REM        codepage issues with non-ASCII .bat files).
REM ============================================================================
setlocal EnableDelayedExpansion

set "OUT=%USERPROFILE%\Desktop\lectern-diag.txt"
set "DIAGPORT=3199"

echo === Lectern Diagnostic Report === > "%OUT%"
echo Generated: %DATE% %TIME% >> "%OUT%"
echo. >> "%OUT%"

echo [0] Collecting... This takes about 20 seconds. A black window will stay open.
echo     When it says "DONE" you can close it.
echo     Report will be on your Desktop: lectern-diag.txt

REM ---------------------------------------------------------------- 1. locate
echo --- [1] Install location --- >> "%OUT%"
set "EXE="
for %%P in (
  "%LOCALAPPDATA%\Programs\Lectern\Lectern.exe"
  "%ProgramFiles%\Lectern\Lectern.exe"
  "%USERPROFILE%\AppData\Local\Programs\Lectern\Lectern.exe"
  "%~dp0Lectern.exe"
) do (
  if exist %%P if not defined EXE set "EXE=%%~P"
)
if not defined EXE (
  echo NOT FOUND: Lectern.exe in any known location. >> "%OUT%"
  echo Searched: >> "%OUT%"
  echo   %LOCALAPPDATA%\Programs\Lectern\Lectern.exe >> "%OUT%"
  echo   %ProgramFiles%\Lectern\Lectern.exe >> "%OUT%"
  echo   %~dp0Lectern.exe >> "%OUT%"
  goto :collected
)
echo EXE: %EXE% >> "%OUT%"
for %%F in ("%EXE%") do echo EXE date: %%~tF >> "%OUT%"
echo APPDIR: %~dp0 >> "%OUT%"

for %%P in ("%EXE%") do set "INSTDIR=%%~dpP"
set "STANDALONE=%INSTDIR%resources\app\.next\standalone\server.js"
echo STANDALONE: %STANDALONE% >> "%OUT%"
if not exist "%STANDALONE%" (
  echo !! standalone server.js MISSING - installation is broken >> "%OUT%"
) else (
  echo standalone server.js: OK >> "%OUT%"
)

REM ------------------------------------------------------------ 2. data dir
echo. >> "%OUT%"
echo --- [2] Data directory --- >> "%OUT%"
echo APPDATA: %APPDATA% >> "%OUT%"
echo USERNAME: %USERNAME% >> "%OUT%"
echo USERPROFILE: %USERPROFILE% >> "%OUT%"
echo. >> "%OUT%"
echo NOTE: v0.4.2 and earlier write data to ^<userData^>\data\data
echo       (LECTERN_DATA_DIR was treated as a root, then another "data"
echo        level was appended). v0.4.3+ uses ^<userData^>\data, but keeps
echo        using data\data when that is where existing data lives.
echo        Both levels are listed below. >> "%OUT%"
echo. >> "%OUT%"

echo --- dir: %APPDATA%\Lectern ^(level 1^) --- >> "%OUT%"
if exist "%APPDATA%\Lectern" (
  dir "%APPDATA%\Lectern" >> "%OUT%" 2>&1
) else (
  echo exists: NO >> "%OUT%"
)

echo. >> "%OUT%"
echo --- dir: %APPDATA%\Lectern\data ^(level 2^) --- >> "%OUT%"
if exist "%APPDATA%\Lectern\data" (
  dir "%APPDATA%\Lectern\data" >> "%OUT%" 2>&1
) else (
  echo exists: NO >> "%OUT%"
)

echo. >> "%OUT%"
echo --- dir: %APPDATA%\Lectern\data\data ^(level 3 - real one for packaged app^) --- >> "%OUT%"
if exist "%APPDATA%\Lectern\data\data" (
  dir "%APPDATA%\Lectern\data\data" >> "%OUT%" 2>&1
) else (
  echo exists: NO >> "%OUT%"
)

echo. >> "%OUT%"
echo --- projects.json files found --- >> "%OUT%"
for %%D in (
  "%APPDATA%\Lectern\data\data\projects.json"
  "%APPDATA%\Lectern\data\projects.json"
) do (
  if exist %%D (
    echo FOUND %%D >> "%OUT%"
    type %%D >> "%OUT%" 2>&1
    echo. >> "%OUT%"
  )
)

echo. >> "%OUT%"
echo --- write test on %APPDATA%\Lectern\data\data --- >> "%OUT%"
if not exist "%APPDATA%\Lectern\data\data" mkdir "%APPDATA%\Lectern\data\data" >nul 2>&1
echo ok > "%APPDATA%\Lectern\data\data\_write_test.tmp" 2>&1
if exist "%APPDATA%\Lectern\data\data\_write_test.tmp" (
  echo writable: YES >> "%OUT%"
  del "%APPDATA%\Lectern\data\data\_write_test.tmp" >nul 2>&1
) else (
  echo writable: NO  ^(this is a problem^) >> "%OUT%"
)

echo. >> "%OUT%"
echo --- existing web.log (only present on newer builds) --- >> "%OUT%"
for %%F in (
  "%APPDATA%\Lectern\logs\web.log"
  "%APPDATA%\Lectern\data\logs\web.log"
) do (
  if exist %%F (
    echo FOUND %%F >> "%OUT%"
    type %%F >> "%OUT%" 2>&1
  )
)

REM ------------------------------------------------------- 3. port / process
echo. >> "%OUT%"
echo --- [3] Port 3100 (the port Lectern uses) --- >> "%OUT%"
netstat -ano | findstr ":3100" >> "%OUT%" 2>&1
echo --- Lectern processes running --- >> "%OUT%"
tasklist /FI "IMAGENAME eq Lectern.exe" >> "%OUT%" 2>&1

REM ------------------------------------------- 4. run server in foreground
echo. >> "%OUT%"
echo --- [4] Starting bundled server directly (see errors below) --- >> "%OUT%"
if not exist "%STANDALONE%" goto :collected

set ELECTRON_RUN_AS_NODE=1
set PORT=%DIAGPORT%
set HOSTNAME=127.0.0.1
set NODE_ENV=production
set LECTERN_WORKSPACE=%APPDATA%\Lectern\workspace
set LECTERN_LOG_DIR=%APPDATA%\Lectern\logs
REM Mirror electron/main.cjs resolveDataDir(): keep the legacy data\data layout
REM when that is where the existing database lives, so this diagnostic reads
REM the very same database the installed app uses.
set DIAGDATADIR=%APPDATA%\Lectern\data
if not exist "%DIAGDATADIR%\zmzai.db" (
  if exist "%DIAGDATADIR%\data\zmzai.db" set DIAGDATADIR=%DIAGDATADIR%\data
)
set LECTERN_DATA_DIR=%DIAGDATADIR%

start "LECTERN-DIAG-SERVER" /b cmd /c ""%EXE%" "%STANDALONE%" > "%TEMP%\lectern-diag-server.log" 2>&1"

echo (waiting 15s for server to boot)
timeout /t 15 /nobreak >nul

echo. >> "%OUT%"
echo --- [5] server stdout/stderr --- >> "%OUT%"
type "%TEMP%\lectern-diag-server.log" >> "%OUT%" 2>&1

echo. >> "%OUT%"
echo --- [6] HTTP probe on 127.0.0.1:%DIAGPORT% --- >> "%OUT%"
echo --- GET /api/projects --- >> "%OUT%"
curl -s -m 10 -o "%TEMP%\lectern-diag-api.txt" -w "HTTP_CODE=%%{http_code}\n" "http://127.0.0.1:%DIAGPORT%/api/projects" >> "%OUT%" 2>&1
type "%TEMP%\lectern-diag-api.txt" >> "%OUT%" 2>&1
echo. >> "%OUT%"
echo --- GET /api/sessions --- >> "%OUT%"
curl -s -m 10 -o "%TEMP%\lectern-diag-api2.txt" -w "HTTP_CODE=%%{http_code}\n" "http://127.0.0.1:%DIAGPORT%/api/sessions" >> "%OUT%" 2>&1
type "%TEMP%\lectern-diag-api2.txt" >> "%OUT%" 2>&1

REM -------------------------------------------------- 5. stop server first
REM IMPORTANT: must stop the server BEFORE probing the sqlite file.
REM Two processes opening the same sqlite db at once throws "disk I/O error",
REM which would show up here as a false positive.
echo. >> "%OUT%"
echo --- [7] Stopping diagnostic server --- >> "%OUT%"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%DIAGPORT%" ^| findstr LISTENING') do (
  echo killing PID %%a >> "%OUT%"
  taskkill /PID %%a /F >> "%OUT%" 2>&1
)
timeout /t 2 /nobreak >nul

REM --------------------------------------------------- 6. database probe
echo. >> "%OUT%"
echo --- [8] node:sqlite probe (single process, server stopped) --- >> "%OUT%"
set ELECTRON_RUN_AS_NODE=1
"%EXE%" -e "const fs=require('fs'),p=require('path');console.log('node',process.versions.node);let s;try{s=require('node:sqlite')}catch(e){console.log('node:sqlite MISSING:',e.code);process.exit(0)}console.log('node:sqlite OK',Object.keys(s).join(','));for(const d of [p.join(process.env.LECTERN_DATA_DIR,'data'),process.env.LECTERN_DATA_DIR]){let files=[];try{files=fs.readdirSync(d).filter(f=>/\.db$/.test(f))}catch(e){console.log('dir',d,'->',e.code);continue}console.log('dir',d,'db files:',files.join(',')||'(none)');for(const f of files){const fp=p.join(d,f);try{const db=new s.DatabaseSync(fp);db.close();console.log('  OPEN OK  ',fp)}catch(e){console.log('  OPEN FAIL',fp,'code='+e.code,'|',e.message)}}}try{const fp=p.join(process.env.LECTERN_DATA_DIR,'data','_probe.sqlite');const db=new s.DatabaseSync(fp);db.close();console.log('create-new OK',fp);fs.unlinkSync(fp)}catch(e){console.log('create-new FAIL code='+e.code,'|',e.message)}" >> "%OUT%" 2>&1

:collected
echo. >> "%OUT%"
echo === END === >> "%OUT%"
echo.
echo DONE. Report saved to your Desktop: lectern-diag.txt
echo Please send that file to us.
echo.
pause
endlocal
