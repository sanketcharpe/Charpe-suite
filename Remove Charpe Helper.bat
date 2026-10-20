@echo off
title Remove Charpe Helper
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Charpe Helper.vbs" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*charpe-helper*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
rmdir /s /q "%APPDATA%\CharpeHelper" 2>nul
echo Charpe Helper removed from this PC.
pause
