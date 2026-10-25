@echo off
echo.
echo  Starting Carbon Credit Platform...
echo.
cd /d "%~dp0backend"
if not exist node_modules (
    echo  Installing dependencies...
    npm install
)
echo  Launching server at http://localhost:3001
npm start
pause
