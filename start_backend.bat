@echo off
cd /d "%~dp0backend"
echo Installing Python dependencies...
pip install -r requirements.txt -q

echo Freeing port 8000 if a previous backend is still running...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo Starting backend...
python main.py
