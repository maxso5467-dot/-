@echo off
setlocal
cd /d "%~dp0"

echo Building frontend...
call npm run build
if errorlevel 1 (
  echo Frontend build failed.
  pause
  exit /b 1
)

echo Starting integrated server...
echo Open http://localhost:8080/ after the server starts.
call npm start
