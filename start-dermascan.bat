@echo off
title DermaScan v2 Launcher
cd /d %~dp0
echo DermaScan v2 ki teeno services khul rahi hain...
start "DermaScan ML (8000)" cmd /k "cd ml-service && call venv\Scripts\activate.bat && uvicorn app:app --port 8000"
start "DermaScan Backend (5000)" cmd /k "cd backend && npm start"
start "DermaScan Frontend (5173)" cmd /k "cd frontend && npm run dev"
timeout /t 10 >nul
start http://localhost:5173
echo Ho gaya - browser khul gaya hoga. Agar page na khule to 10 second ruk ke refresh kar lena.
pause
