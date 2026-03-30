@echo off
REM Windows Batch fayli - serverni setup qilish uchun

echo.
echo ========================================
echo   MANSUR SHASHLIK - SERVER SETUP
echo ========================================
echo.

REM Node.js o'rnatilganligini tekshirish
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js o'rnatilmagan!
    echo https://nodejs.org/ dan yuklab o'rnating
    pause
    exit /b 1
)

echo ✅ Node.js topildi!
echo.

REM npm packages o'rnatish
echo 📦 npm paketlarini o'rnatmoqda...
call npm install

echo.
echo ✅ Tayyorlik yakunlandi!
echo.
echo 🚀 Serverni boshlash uchun quyidagini bajaring:
echo.
echo    npm start
echo.
echo Yoki
echo.
echo    node server.js
echo.
pause
