@echo off
setlocal
cd /d "%~dp0"

start "XuenWu Backend API" cmd /k "npm start"
start "XuenWu Frontend" cmd /k "cd /d frontend && npm run dev -- --host 127.0.0.1 --port 5173"

echo Backend:  http://localhost:8080/api/v1
echo Frontend: http://127.0.0.1:5173/
echo.
echo Keep the opened command windows running while testing.
pause
