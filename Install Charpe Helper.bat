@echo off
title Install Charpe Helper
cd /d "%~dp0"
echo.
echo  CHARPE HELPER - one-time install on this PC
echo  -------------------------------------------
echo.
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto nopython

echo  1/4  Installing the connection library ...
%PY% -m pip install --user --upgrade --quiet curl_cffi
if errorlevel 1 echo       (could not install it - the helper will still work with the basic library)
%PY% -c "import requests" 2>nul || %PY% -m pip install --user --quiet requests

%PY% install_helper.py
if errorlevel 1 goto failed
echo.
echo  Done. A browser tab should say "Charpe helper is running".
echo  It now starts by itself every time Windows starts.
echo.
pause
exit /b 0

:failed
echo.
echo  Something went wrong above. Take a photo of this window and send it to Claude.
pause
exit /b 1

:nopython
echo  Python is not installed on this PC.
echo  Install it from https://www.python.org/downloads/ and on the first
echo  screen TICK "Add python.exe to PATH". Then double-click this file again.
echo.
pause
exit /b 1
