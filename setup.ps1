# PowerShell Setup Script

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "   MANSUR SHASHLIK - SERVER SETUP" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# Node.js o'rnatilganligini tekshirish
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js topildi: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js o'rnatilmagan!" -ForegroundColor Red
    Write-Host "https://nodejs.org/ dan yuklab o'rnating" -ForegroundColor Yellow
    Read-Host "Davom etish uchun Enter bosing"
    exit
}

Write-Host ""
Write-Host "📦 npm paketlarini o'rnatmoqda..." -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "✅ Tayyorlik yakunlandi!" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Serverni boshlash uchun quyidagini bajaring:" -ForegroundColor Yellow
Write-Host ""
Write-Host "    npm start" -ForegroundColor White
Write-Host ""

Read-Host "Davom etish uchun Enter bosing"
