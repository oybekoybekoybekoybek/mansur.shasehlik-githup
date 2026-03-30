# 🍢 MANSUR SHASHLIK RESTAURANT - Server & Admin Panel

Xush kelibsiz! Bu loyiha Node.js server bilan ishlaydi.

---

## 📋 Ichida nima bor?

✅ **Admin Panel** - Taomlarni qo'shish, o'zgartirish, o'chirish
✅ **Real-time Updates** - Admin o'zgartirsa, saytda darhol ko'rinadi
✅ **Database** - Barcha taomlar server'da saqlanadi
✅ **User-friendly Web UI** - Buyurtma berish, savatga qo'shish

---

## 🚀 TEZKOR START (5 daqiqada)

### 1⃣ Node.js o'rnating (birinchi marta)
**Agar bu qilgan bo'lsangiz, 2-qadamga oching**

👉 [nodejs.org](https://nodejs.org/) saytiga boring
- **LTS** versiyasini tanlang
- Windows Installer'ni yuklab oling
- O'rnating va kompyuterni RESTART qiling

### 2⃣ SETUP Scriptini ishga tushiring

**VARIANT A: Batch fayli (Oson)**
- Finder'da `setup.bat` faylini topging
- Uni double-click qiling
- Kutib turing... (npm packages o'rnatiladi)

**VARIANT B: PowerShell**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\setup.ps1
```

**VARIANT C: Manual**
```bash
cd Desktop\oybek\MANSUR SHASHLIK
npm install
```

### 3⃣ Serverni boshlang
```bash
npm start
```

Agar bu chiqsa, MUVAFFAQIYAT! ✅
```
🚀 Server 3000 portda ishlamoqda!
📍 Sayt: http://localhost:3000
```

### 4⃣ Brauzer'da oching
```
http://localhost:3000
```

---

## 🛠️ Admin Panel - Qanday Ishlash?

### Admin Paneliga Kirish
1. Sayt yuqori o'ng burchagida **Menu** tugmasini bosing
2. Paroli so'rab chiqadi: **123** yozing
3. Admin panel ochiladi!

### 🍖 Taom Qo'shish
1. **"Taom qo'shish"** tugmasini bosing
2. Malumotlarni to'ldirig:
   - **Taom Nomi**: Qoʻy Shashlik
   - **Narx**: 45000  
   - **Rasm URL**: https://example.com/photo.jpg (ixtiyoriy)
   - **Kategoriya**: Shashlik / Salat / Garnir / Ichimliklar / Non / Farsh
3. **Saqlash** bosing

✅ **Taom darhol saytda ko'rinadi va serverda saqlanadi!**

### ✏️ Taom Tahrirlash
1. **"Tahrirlash"** tugmasini bosing
2. Taom nomini yozing va **"Qidirish"** bosing
3. Ma'lumotlarni o'zgartigung
4. **"Yangilash"** bosing

✅ **O'zgarishlar barcha foydalanuvchilarga ko'rinadi!**

### 🗑️ Taom O'chirish
1. **"Tahrirlash"** tugmasini bosing
2. Taom nomini yozing va **"Qidirish"** bosing
3. **Status** bo'limida **"O'chirish"** tanlang
4. **"Yangilash"** bosing

✅ **Taom o'chib ketadi!**

### 📋 Buyurtmalarni Ko'rish
- **"Buyurtmalar"** tugmasini bosing
- Barcha kelgan buyurtmalarni ko'rib olasiz (check raqami, telefon, manzil, taomlar)
- Agar kerak bo'lsa, **"O'CHIRISH"** tugmasini bosing

---

## 📁 Fayllar Tuzilishi

```
MANSUR SHASHLIK/
├── 📄 index.html                 ← Asosiy sayt
├── 📄 java.js                    ← JavaScript (Server bilan ishlaydi)
├── 📄 style.css                  ← Uslublar
│
├── 🆕 server.js                  ← SERVER FAYLI (Express.js)
├── 🆕 package.json               ← NPM Konfiguratsiya
├── 🆕 foods_db.json              ← DATABASE (Taomlar saqlanadi)
│
├── 📖 SERVER_SETUP.md            ← Batafsil ko'rsatmalar
├── 📖 NODE_INSTALL.md            ← Node.js o'rnatish
├── 📖 README.md                 ← Bu fayl
│
├── 🔧 setup.bat                  ← Setup scriptí (Windows)
├── 🔧 setup.ps1                  ← Setup scriptí (PowerShell)
│
└── 📁 node_modules/              ← npm paketlari (avtomátik yaratiladi)
```

---

## 🔌 API Endpoints (Dasturchilar uchun)

```
GET    /api/foods              ← Barcha taomlarni olish
POST   /api/foods              ← Yangi taom qo'shish
PUT    /api/foods/:id          ← Taomni yangilash
DELETE /api/foods/:id          ← Taomni o'chirish
```

**Curl Misollari:**

```bash
# Barcha taomlar
curl http://localhost:3000/api/foods

# Yangi taom qo'shish
curl -X POST http://localhost:3000/api/foods \
  -H "Content-Type: application/json" \
  -d '{"name":"Taom","price":50000,"category":"Shashlik"}'

# Taomni yangilash
curl -X PUT http://localhost:3000/api/foods/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"O\'zgartirilgan","price":55000}'

# Taomni o'chirish
curl -X DELETE http://localhost:3000/api/foods/1
```

---

## ❌ Muammolar va Yechimlar

### ❌ "Node.js topilmadi" xatosi
**Yechim:** 
- [nodejs.org](https://nodejs.org/) saytidan yuklab o'rnating
- Kompyuterni RESTART qiling
- Terminal'ni o'chirib qayta oching

### ❌ "npm install" xatosi
**Yechim:**
- Administrator sifatida CMD/PowerShell oching
- `npm cache clean --force` yozing
- `npm install` ni qayta bajaring

### ❌ "Server bilan ulanib bo'lalmadi"
**Yechim:**
- Serverni boshlanganligi tekshiring (`npm start`)
- `http://localhost:3000` mavjudligini tekshiring
- Firewall qaydlari tekshiring

### ❌ "Admin paneliga kirib bo'lalmadi"
**Yechim:**
- Paroli: `123` (boshi katta emas)
- Console'ni oching (F12) va xatolarni ko'ring

### ❌ "Taomlar ko'rinmayapti"
**Yechim:**
- Browser cache'i o'chiring (Ctrl+Shift+Delete)
- Sahifani yangilang (F5)
- Console'da xatolarni tekshiring

---

## 📊 Mahusuliklar

### ✅ Tugallangan
- ✅ Admin panel bilan taom qo'shish/tahrirlash/o'chirish
- ✅ Server API'si
- ✅ Database (JSON fayli)
- ✅ Real-time taomlar yangilanishi
- ✅ Buyurtma berish sistemi
- ✅ Savat funksionalari

### 🔜 Kelajakda qo'shiladigan narsalar (umuman)
- 🔜 Rasm upload qilish (lokalda)
- 🔜 Buyurtmalatrni email'da yuborish
- 🔜 Parol hashirlash
- 🔜 Foydalanuvchi profil
- 🔜 To'lov integratsiyasi
- 🔜 SMS bildirishnomalar

---

## 🎓 Qanday Ishlaydi?

1. **Brauzer** saytni server'dan yuklaydi
2. **JavaScript**, `loadFoodsFromServer()` chaqiradi
3. **Server** `/api/foods` endpoint'iga `GET` so'rovni jo'natadi
4. **Database** taomlar ro'yxatini qaytaradi
5. **Sayt** taomlarni ekranda ko'rsatadi

**Admin qo'shsa:**
1. Admin form'ni to'ldiradi
2. `addFoodToMenu()` **POST** so'rovi jo'natadi
3. Server ma'lumotni database'ga saqlaydi
4. `loadFoodsFromServer()` qayta chaqiriladi
5. Sayt avtomatik yangilanadi ✅

---

## 📞 Yordam & Support

- **Terminal'da xato chiqsa**: Xato xabarini google'da qidiring
- **Node.js masalasi**: [nodejs.org/help](https://nodejs.org/)
- **Express.js**: [expressjs.com](https://expressjs.com/)

---

## 📝 Litsenziya

Bu loyiha siz uchun bepul. Xohlaganingizcha ishlatafingiz mumkin! 🍢✨

---

**OMAD! BOSHLANG! 🚀**

Biron savol bo'lsa, `SERVER_SETUP.md` va `NODE_INSTALL.md` fayllarini o'qing.
