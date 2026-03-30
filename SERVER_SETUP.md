# 🍢 MANSUR SHASHLIK - Server Setup Guide

## Server bilan ishlash uchun ko'rsatmalar

### 📋 Kerakli ma'lumotlar:
- Node.js (v14 yoki yanada yuqori) - [nodejs.org](https://nodejs.org/) dan yuklab oling
- npm (Node.js bilan birga keladi)

---

## 🚀 Serverni boshlash (Windows)

### 1️⃣ TERMINAL OCHING
Windows Start menusida `cmd` yoki `PowerShell` yozing va oching.

### 2️⃣ PAPKAGA BORING
```
cd Desktop\oybek\MANSUR SHASHLIK
```

### 3️⃣ NPM PAKETLARINI INSTALL QILING
```
npm install
```

Buni birinchi marta bajarishingiz kerak. Uning natijasida `node_modules` papkasi yaratiladi.

### 4️⃣ SERVERNI BOSHLANG
```
npm start
```

yoki

```
node server.js
```

### ✅ MUVAFFAQIYAT!
Agar quyidagi xabar chiqsa, server ishlamoqda:
```
🚀 Server 3000 portda ishlamoqda!
📍 Sayt: http://localhost:3000
📊 API: http://localhost:3000/api/foods
```

---

## 🌐 Saytni BRAUZER'DA OCHING
1. Chrome, Firefox yoki boshqa brauzer oching
2. Manzil (URL) qatoriga yozing: `http://localhost:3000`
3. ENTER bosing

---

## 🛠️ Admin Panel orqali Ishlash

### Admin Paneliga kirish:
1. Saitning yuqori o'ng burchagida "Menu" tugmasini bosing
2. Admin paroli: **123** (yozing va ENTER bosing)

### Faol qoshish:
1. "Taom qo'shish" tugmasini bosing
2. Taom nomini kiriting
3. Narxini kiriting (raqamda)
4. Rasm URL'ini kiriting (ixtiyoriy, default: 8.jpg)
5. Kategoriyani tanlang
6. "Saqlash" tugmasini bosing

✅ Taom serverda saqlanadi va barcha foydalanuvchilar ko'radi!

### Taomni tahrirlash:
1. "Tahrirlash" tugmasini bosing
2. Taom nomini yozing va "Qidirish" bosing
3. Kerakli ma'lumotlarni o'zgartiring
4. "Yangilash" bosing

✅ O'zgarishlar darhol saytda ko'rinadi!

### Taomni o'chirish:
1. "Tahrirlash" tugmasini bosing
2. Taom nomini yozing va "Qidirish" bosing
3. Status bo'limida "O'chirish" tanlang
4. "Yangilash" bosing

✅ Taom o'chiriladi!

---

## 📂 Fayllar Tuzilishi

```
MANSUR SHASHLIK/
├── index.html          ← Asosiy sayt fayli
├── java.js             ← JavaScript (SERVER API bilan ishlaydi)
├── style.css           ← CSS (uslub)
├── server.js           ← 🆕 SERVER FAYLI
├── package.json        ← 🆕 NPM KONFIGURATSIYA
├── foods_db.json       ← 🆕 DATABASE (taomlar saqlanadi)
├── node_modules/       ← Avtomatik yaratiladi (npm install)
└── saqlash.txt         ← Shunga o'xshash fayllar
```

---

## 🔄 API Endpoints (Dasturchilar uchun)

```
GET  /api/foods         ← Barcha taomlarni olish
POST /api/foods         ← Yangi taom qo'shish
PUT  /api/foods/:id     ← Taomni yangilash
DELETE /api/foods/:id   ← Taomni o'chirish
```

---

## ❌ Muammolar va Yechimlar

### "npm: bulunamadi" xatosi
👉 [nodejs.org](https://nodejs.org/) dan Node.js yuklab o'rnating

### "Server bilan ulanib bo'lalmadi" xatosi
👉 Serverni boshlanganligi ishonchli qiling (npm start)
👉 `http://localhost:3000` manzilni tekshiring

### Faollar ko'rinmayapti
👉 Browser cache'i o'chiring (Ctrl+Shift+Delete)
👉 Sahifani yangilang (F5 yoki Ctrl+R)

---

## 📞 Yordam?
Agar muammo bo'lsa, terminal'da xato xabarini oling va Google'da qidiring!

Omad! 🍢✨
