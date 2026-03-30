﻿
// --- Kategoriya boshqaruvi va Gemini AI ---
// Ensure the admin page opens from the local server for correct API and session behavior.
(function enforceLocalOrigin() {
    if (document.getElementById('adminEmbedOverlay')) {
        return;
    }
    const { protocol, hostname, port, pathname, search, hash } = window.location;
    const isFile = protocol === 'file:';
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    const needsRedirect = isFile || (isLocalHost && port !== '3000');
    if (!needsRedirect) return;

    let targetPath = `${pathname || ''}${search || ''}${hash || ''}`;
    if (isFile) {
        const lower = String(pathname || '').toLowerCase();
        if (lower.endsWith('admin.html') || lower.includes('admin')) {
            targetPath = '/admin';
        } else {
            targetPath = '/';
        }
    }

    if (!targetPath.startsWith('/')) {
        targetPath = `/${targetPath}`;
    }

    const target = `http://localhost:3000${targetPath}`;
    if (window.location.href !== target) {
        window.location.replace(target);
    }
})();

function renderCategoryList() {
    const listBlock = document.getElementById('categoryList');
    const emptyBlock = document.getElementById('categoryEmpty');
    if (!listBlock) return;
    const categories = uniqueStrings(state.siteSettings?.categories || []);
    listBlock.innerHTML = '';
    if (categories.length === 0) {
        emptyBlock.style.display = '';
        listBlock.style.display = 'none';
    } else {
        emptyBlock.style.display = 'none';
        listBlock.style.display = 'flex';
        categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'category-name';
            nameSpan.textContent = cat;
            item.appendChild(nameSpan);
            // O'zgartirish tugmasi
            const editBtn = document.createElement('button');
            editBtn.className = 'category-btn edit';
            editBtn.title = 'O\'zgartirish';
            editBtn.innerHTML = '<i class="fas fa-pen"></i>';
            editBtn.onclick = () => editCategoryPrompt(cat);
            // O'chirish tugmasi
            const delBtn = document.createElement('button');
            delBtn.className = 'category-btn delete';
            delBtn.title = 'O\'chirish';
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.onclick = () => deleteCategory(cat);
            const actions = document.createElement('div');
            actions.className = 'category-actions';
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            item.appendChild(actions);
            listBlock.appendChild(item);
        });
    }
}

async function editCategoryPrompt(oldName) {
    const newNameRaw = prompt('Yangi kategoriya nomini kiriting:', oldName);
    const newName = normalizeCategoryName(newNameRaw);
    if (!newName || isSameCategoryName(newName, oldName)) return;

    const hasConflict = (state.siteSettings?.categories || []).some(
        (c) => !isSameCategoryName(c, oldName) && isSameCategoryName(c, newName)
    );
    if (hasConflict) {
        alert("Bunday kategoriya allaqachon bor.");
        return;
    }

    const categories = uniqueStrings(
        (state.siteSettings?.categories || []).map((c) => isSameCategoryName(c, oldName) ? newName : c)
    );

    try {
        await saveSiteSettings({ ...state.siteSettings, categories });
        // Taomlar ichida ham kategoriya nomini yangilash kerak
        await updateFoodsCategoryName(oldName, newName);
        alert('Kategoriya nomi yangilandi.');
        renderCategoryList();
        renderFoodCategoryOptions();
    } catch (err) {
        alert(`Kategoriya nomini yangilashda xato: ${err.message}`);
    }
}

async function updateFoodsCategoryName(oldCat, newCat) {
    // Barcha taomlarni yuklab, eski kategoriya nomini yangisiga o'zgartirish
    const foods = state.foods.filter((f) => isSameCategoryName(f.category, oldCat));
    for (const food of foods) {
        await fetchJson(`${ADMIN_API_URL}/foods/${food.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...food, category: newCat })
        });
    }
    await refreshAllData();
}

async function deleteCategory(cat) {
    if (!confirm(`Kategoriya va ichidagi barcha taomlar o'chiriladi. Davom etasizmi?`)) return;
    // Kategoriyani olib tashlash
    const categories = (state.siteSettings?.categories || []).filter((c) => !isSameCategoryName(c, cat));
    try {
        await saveSiteSettings({ ...state.siteSettings, categories });
        // Kategoriya ichidagi taomlarni ham o'chirish
        const foods = state.foods.filter((f) => isSameCategoryName(f.category, cat));
        for (const food of foods) {
            await fetchJson(`${ADMIN_API_URL}/foods/${food.id}`, { method: 'DELETE' });
        }
        await refreshAllData();
        alert('Kategoriya va ichidagi taomlar o\'chirildi.');
        renderCategoryList();
        renderFoodCategoryOptions();
    } catch (err) {
        alert(`Kategoriyani o'chirishda xato: ${err.message}`);
    }
}

// Kategoriya bo'sh bo'lsa, kulrang effekt va sichqoncha effekti
document.addEventListener('DOMContentLoaded', () => {
    bindAdminLoginClick();
    renderCategoryList();

    if (document.body && document.body.classList.contains('admin-page')) {
        initAdminPanel();
    }
});
// YANGI: Dashboard hisobotlari - kategoriya jadval
function renderDashboardReports() {
    const listDiv = document.getElementById('dynamicReportsContent');
    if (!listDiv) return;
    
    // Sessiya bo'yicha filtrlash (Sayt qayta ishga tushsa yangilanadi)
    const currentSessionId = state.site?.currentSessionId || "";

    const orders = (state.orders || []).filter(order => {
        // Agar sessiya ID bo'lsa, faqat shu sessiyaga tegishli buyurtmalar
        if (currentSessionId && String(order.sessionId) !== currentSessionId) return false;
        // Agar sessiya bo'lmasa, bugungi sanani olamiz (fallback)
        if (!currentSessionId) {
            const dt = parseOrderDate(order.date || order.id);
            if (!dt) return false;
            const today = new Date();
            return dt.getDate() === today.getDate() && dt.getMonth() === today.getMonth();
        }
        return true;
    });

    if (!orders.length) {
        listDiv.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">рџ“Љ Bu sessiyada buyurtma yo\'q</div>';
        return;
    }

    const cats = {};
    let revenue = 0, totalItemsCount = 0;
    let cancelledCount = 0;
    let pendingCount = 0; // Jarayondagi buyurtmalar
    let completedCount = 0;
    let courierStats = {}; // { courierId: { total: N, delivered: M, late: K } }
    let deliveryProblems = 0; // Placeholder for future logic

    for (const order of orders) {
        const status = normalizeStatus(order.status);
        
        if (status === 'bekor') {
            cancelledCount++;
            continue;
        } else if (status === 'yakunlandi') {
            completedCount++;
            revenue += Number(order.total || 0);
        } else {
            pendingCount++;
        }

        // Kuryer statistikasi (hozircha faqat buyurtmalar soni)
        if (order.courierId) {
            if (!courierStats[order.courierId]) {
                courierStats[order.courierId] = { total: 0, delivered: 0, late: 0, name: `Kuryer #${order.courierId}` };
            }
            courierStats[order.courierId].total++;
            if (status === 'yakunlandi') courierStats[order.courierId].delivered++;
            // "Kech qoldi" logikasi serverdan kelishi kerak, hozircha mavjud emas
            // if (order.isLate) courierStats[order.courierId].late++;
        }

        // Taomlar hisobi
        const itemsMap = order.items || {};
        for (const [name, item] of Object.entries(itemsMap)) {
            // Kategoriya nomini topish (foods arrayidan)
            const foodInfo = state.foods.find(f => f.name === name);
            const c = foodInfo?.category || 'Boshqa';
            const n = name || 'Noma\'lum';
            const q = Number(item.quantity || 0);
            if (!cats[c]) cats[c] = {items: {}, total: 0};
            cats[c].items[n] = (cats[c].items[n] || 0) + q;
            cats[c].total += q;
            totalItemsCount += q;
        }
    }

    let html = `<div class="report-container">`;
    
    // 1. Umumiy statistika
    html += `<div class="report-stats-grid">
                <div class="stat-box green"><b>Yakunlangan:</b> ${completedCount}</div>
                <div class="stat-box red"><b>Bekor qilingan:</b> ${cancelledCount}</div>
                <div class="stat-box blue"><b>Jarayonda:</b> ${pendingCount}</div>
                <div class="stat-box violet"><b>Yetkazishdagi muammolar:</b> ${deliveryProblems}</div>
             </div>`;

    // 2. Taomlar jadvali
    html += `<div class="profit-table-wrap">
                <div class="profit-summary">
                    <span>Sotilgan mahsulotlar:</span>
                    <strong>Jami ${totalItemsCount} dona</strong>
                </div>
                <table class="profit-table"><thead><tr><th>Kategoriya</th><th>Mahsulotlar</th><th class="text-right">Jami</th></tr></thead><tbody>`;
    
    for (const [cat, data] of Object.entries(cats)) {
        const itemBreakdown = Object.entries(data.items).map(([nm, qt]) => 
            `<div class="report-item-row"><span>${escapeHtml(nm)}</span> <b>${qt} ta</b></div>`
        ).join('');
        
        html += `<tr>
                    <td style="font-weight:bold; color:#2c3e50;">${escapeHtml(cat)}</td>
                    <td>${itemBreakdown}</td>
                    <td class="text-right" style="font-weight:bold; font-size:1.1em;">${data.total}</td>
                 </tr>`;
    }
    html += '</tbody></table></div>';

    // 3. Kuryerlar statistikasi
    let courierHtml = ``;
    if (Object.keys(courierStats).length > 0) {
        courierHtml += `<div class="courier-report-section">
                            <h4>Kuryerlar hisoboti</h4>
                            <div class="courier-report-grid">`;
        for (const [cid, stats] of Object.entries(courierStats)) {
            courierHtml += `<div class="courier-report-card">
                                <strong>${escapeHtml(stats.name)}</strong>
                                <span>Jami buyurtma: ${stats.total}</span>
                                <span>Yetkazilgan: ${stats.delivered}</span>
                                <span>Kech qolgan: ${stats.late} (mavjud emas)</span>
                            </div>`;
        }
        courierHtml += `</div></div>`;
    } else {
        courierHtml = `<div class="courier-report-section"><div class="empty-box">Kuryerlar haqida ma'lumot yo'q.</div></div>`;
    }
    html += courierHtml;

    // 4. Moliya hisoboti
    html += `<div class="report-footer">
                <div class="report-finance-box">
                    <div class="report-total-money">Jami Foyda: ${formatMoney(revenue)}</div>
                </div>
             </div>`;

    listDiv.innerHTML = html;

    // Print functionality for the report
    const printBtn = document.getElementById('printReportsBtn');
    if (printBtn) {
        printBtn.onclick = () => {
            const now = new Date();
            const d = now.getDate() + '.' + (now.getMonth()+1) + '.' + now.getFullYear() + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0');
            let printContent = `
                <style>
                    body { font-family: monospace; font-size: 12px; margin: 0; padding: 10px; }
                    pre { white-space: pre-wrap; word-wrap: break-word; }
                    .report-header { text-align: center; margin-bottom: 15px; }
                    .report-header h2 { margin: 0; font-size: 16px; }
                    .report-header p { margin: 5px 0; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                    th, td { border: 1px solid #ccc; padding: 5px; text-align: left; }
                    .text-right { text-align: right; }
                    .summary-line { font-weight: bold; margin-top: 5px; }
                    .stat-box { border: 1px solid #eee; padding: 8px; margin-bottom: 5px; }
                </style>
                <div class="report-header">
                    <h2>MANSUR SHASHLIK Hisobot</h2>
                    <p>Sana: ${d}</p>
                </div>
                <pre>
UMUMIY STATISTIKA:
  Yakunlangan buyurtmalar: ${completedCount}
  Bekor qilingan buyurtmalar: ${cancelledCount}
  Jarayondagi buyurtmalar: ${pendingCount}
  Yetkazishdagi muammolar: ${deliveryProblems} (ma'lumot mavjud emas)

SOTILGAN MAHSULOTLAR:
`;
            for (const [cat, data] of Object.entries(cats)) {
                printContent += `  [ ${cat.toUpperCase()} ]\n`;
                for (const [nm, qt] of Object.entries(data.items)) {
                    printContent += `    ${nm.padEnd(25)} : ${qt} ta\n`;
                }
                printContent += `    JAMI: ${data.total} ta\n\n`;
            }

            printContent += `
KURYERLAR HISOBOTI:
`;
            if (Object.keys(courierStats).length > 0) {
                for (const [cid, stats] of Object.entries(courierStats)) {
                    printContent += `  ${stats.name}:
    Jami buyurtma: ${stats.total}
    Yetkazilgan: ${stats.delivered}
    Kech qolgan: ${stats.late} (ma'lumot mavjud emas)
`;
                }
            } else {
                printContent += `  Kuryerlar haqida ma'lumot yo'q.\n`;
            }

            printContent += `
MOLIYA HISOBOTI:
  Jami Foyda: ${formatMoney(revenue)}
----------------------------------------------------------
            </pre>`;
            
            const w = window.open('','','width=800, height=600');
            w.document.write(printContent);
            w.document.close(); // Important for some browsers
            w.focus(); // Important for some browsers
            w.print();
        };
    }
}

// Har safar ma'lumot yangilanganda ham render qilish
const origRenderAll = renderAll;
renderAll = function() {
    origRenderAll();
    renderCategoryList();
    renderDashboardReports(); // Add this line to render the new reports
};
const LOCAL_API_FALLBACK = "http://localhost:3000";
const ADMIN_API_BASE_URL = (() => {
    const origin = window.location.origin || "";
    if (!origin || origin === "null" || window.location.protocol === "file:") {
        return LOCAL_API_FALLBACK;
    }
    try {
        const url = new URL(origin);
        const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        if (isLocal && url.port !== "3000") {
            return LOCAL_API_FALLBACK;
        }
    } catch (e) {
        return LOCAL_API_FALLBACK;
    }
    return origin;
})();
const ADMIN_API_URL = `${ADMIN_API_BASE_URL}/api`;
const EMBED_LOCAL_ADMIN_MODE = Boolean(document.getElementById("adminEmbedOverlay"));
const LOCAL_ADMIN_STORAGE_PREFIX = "ms_local_admin_v1";
const LOCAL_ADMIN_KEYS = {
    foods: `${LOCAL_ADMIN_STORAGE_PREFIX}_foods`,
    orders: `${LOCAL_ADMIN_STORAGE_PREFIX}_orders`,
    users: `${LOCAL_ADMIN_STORAGE_PREFIX}_users`,
    siteSettings: `${LOCAL_ADMIN_STORAGE_PREFIX}_site_settings`,
    siteState: `${LOCAL_ADMIN_STORAGE_PREFIX}_site_state`,
    telegram: `${LOCAL_ADMIN_STORAGE_PREFIX}_telegram`,
    couriers: `${LOCAL_ADMIN_STORAGE_PREFIX}_couriers`
};
let localAdminInitDone = false;

function readLocalBucket(key, fallbackValue) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallbackValue;
        const parsed = JSON.parse(raw);
        return parsed ?? fallbackValue;
    } catch (_err) {
        return fallbackValue;
    }
}

function writeLocalBucket(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
}

function nowIso() {
    return new Date().toISOString();
}

function createLocalSiteState() {
    const iso = nowIso();
    return {
        orderingEnabled: true,
        currentSessionId: `session-${Date.now()}`,
        sessionStartedAt: iso,
        sessionStoppedAt: "",
        totalRevenueCarry: 0,
        totalRevenueOffset: 0,
        totalRevenueResetAt: "",
        lastSessionReport: null,
        updatedAt: iso
    };
}

function normalizeLocalFood(input = {}, fallbackId = 0) {
    const id = Number(input?.id || fallbackId || Date.now());
    const price = Number(input?.price || 0);
    const prep = Number(input?.prepMinutes || 0);
    return {
        id: Number.isFinite(id) ? id : Date.now(),
        name: String(input?.name || "").trim(),
        price: Number.isFinite(price) ? Math.max(0, price) : 0,
        img: String(input?.img || "8.jpg").trim() || "8.jpg",
        category: String(input?.category || "").trim(),
        prepMinutes: Number.isFinite(prep) && prep > 0 ? Math.round(prep) : null,
        status: String(input?.status || "active").trim() || "active"
    };
}

function readLocalFoods() {
    const list = readLocalBucket(LOCAL_ADMIN_KEYS.foods, []);
    return Array.isArray(list) ? list.map((f, idx) => normalizeLocalFood(f, idx + 1)) : [];
}

function saveLocalFoods(list) {
    const foods = Array.isArray(list) ? list.map((f, idx) => normalizeLocalFood(f, idx + 1)) : [];
    return writeLocalBucket(LOCAL_ADMIN_KEYS.foods, foods);
}

function readLocalOrders() {
    const list = readLocalBucket(LOCAL_ADMIN_KEYS.orders, []);
    if (!Array.isArray(list)) return [];
    return list.map((order, idx) => ({
        ...order,
        id: Number(order?.id || idx + 1),
        status: normalizeStatus(order?.status || "yangi"),
        total: Number(order?.total || 0) || 0,
        delivery: Number(order?.delivery || 0) || 0,
        date: String(order?.date || formatNowForOrder()),
        sessionId: String(order?.sessionId || ""),
        paymentCollected: Boolean(order?.paymentCollected)
    }));
}

function saveLocalOrders(list) {
    const orders = Array.isArray(list) ? list.map((order, idx) => ({
        ...order,
        id: Number(order?.id || idx + 1),
        status: normalizeStatus(order?.status || "yangi"),
        total: Number(order?.total || 0) || 0,
        delivery: Number(order?.delivery || 0) || 0,
        date: String(order?.date || formatNowForOrder()),
        sessionId: String(order?.sessionId || ""),
        paymentCollected: Boolean(order?.paymentCollected)
    })) : [];
    return writeLocalBucket(LOCAL_ADMIN_KEYS.orders, orders);
}

function readLocalUsers() {
    const list = readLocalBucket(LOCAL_ADMIN_KEYS.users, []);
    return Array.isArray(list) ? list : [];
}

function saveLocalUsers(list) {
    return writeLocalBucket(LOCAL_ADMIN_KEYS.users, Array.isArray(list) ? list : []);
}

function readLocalSiteSettings() {
    return normalizeAdminSiteSettings(readLocalBucket(LOCAL_ADMIN_KEYS.siteSettings, null));
}

function saveLocalSiteSettings(nextSettings) {
    const normalized = normalizeAdminSiteSettings(nextSettings);
    writeLocalBucket(LOCAL_ADMIN_KEYS.siteSettings, normalized);
    return normalized;
}

function readLocalSiteState() {
    const fallback = createLocalSiteState();
    const parsed = readLocalBucket(LOCAL_ADMIN_KEYS.siteState, fallback);
    return {
        ...fallback,
        ...parsed,
        orderingEnabled: parsed?.orderingEnabled !== false,
        currentSessionId: String(parsed?.currentSessionId || fallback.currentSessionId),
        sessionStartedAt: String(parsed?.sessionStartedAt || fallback.sessionStartedAt),
        sessionStoppedAt: String(parsed?.sessionStoppedAt || ""),
        totalRevenueCarry: Math.max(0, Number(parsed?.totalRevenueCarry || 0) || 0),
        totalRevenueOffset: Math.max(0, Number(parsed?.totalRevenueOffset || 0) || 0),
        totalRevenueResetAt: String(parsed?.totalRevenueResetAt || ""),
        lastSessionReport: parsed?.lastSessionReport && typeof parsed.lastSessionReport === "object"
            ? parsed.lastSessionReport
            : null
    };
}

function saveLocalSiteState(nextState) {
    const fallback = createLocalSiteState();
    const payload = {
        ...fallback,
        ...nextState,
        orderingEnabled: nextState?.orderingEnabled !== false,
        currentSessionId: String(nextState?.currentSessionId || fallback.currentSessionId),
        sessionStartedAt: String(nextState?.sessionStartedAt || fallback.sessionStartedAt),
        sessionStoppedAt: String(nextState?.sessionStoppedAt || ""),
        totalRevenueCarry: Math.max(0, Number(nextState?.totalRevenueCarry || 0) || 0),
        totalRevenueOffset: Math.max(0, Number(nextState?.totalRevenueOffset || 0) || 0),
        totalRevenueResetAt: String(nextState?.totalRevenueResetAt || ""),
        lastSessionReport: nextState?.lastSessionReport && typeof nextState.lastSessionReport === "object"
            ? nextState.lastSessionReport
            : null,
        updatedAt: nowIso()
    };
    writeLocalBucket(LOCAL_ADMIN_KEYS.siteState, payload);
    return payload;
}

function readLocalTelegramSettings() {
    const fallback = {
        enabled: false,
        botConfigured: false,
        botConnected: false,
        telegramAdminPassword: "",
        token: ""
    };
    const parsed = readLocalBucket(LOCAL_ADMIN_KEYS.telegram, fallback);
    return { ...fallback, ...parsed };
}

function saveLocalTelegramSettings(nextSettings) {
    const current = readLocalTelegramSettings();
    const payload = {
        ...current,
        ...nextSettings,
        enabled: Boolean(nextSettings?.enabled ?? current.enabled),
        botConfigured: Boolean(nextSettings?.botConfigured ?? current.botConfigured),
        botConnected: Boolean(nextSettings?.botConnected ?? current.botConnected),
        telegramAdminPassword: String(nextSettings?.telegramAdminPassword ?? (current.telegramAdminPassword || "")),
        token: String(nextSettings?.token ?? (current.token || ""))
    };
    writeLocalBucket(LOCAL_ADMIN_KEYS.telegram, payload);
    return payload;
}

function readLocalCouriers() {
    const list = readLocalBucket(LOCAL_ADMIN_KEYS.couriers, []);
    if (!Array.isArray(list)) return [];
    return list.map((courier, idx) => ({
        id: Number(courier?.id || idx + 1),
        label: String(courier?.label || courier?.id || idx + 1),
        password: String(courier?.password || "").trim(),
        chatId: String(courier?.chatId || ""),
        connected: Boolean(courier?.connected) || Boolean(courier?.chatId)
    }));
}

function saveLocalCouriers(list) {
    const couriers = Array.isArray(list) ? list.map((courier, idx) => ({
        id: Number(courier?.id || idx + 1),
        label: String(courier?.label || courier?.id || idx + 1),
        password: String(courier?.password || "").trim(),
        chatId: String(courier?.chatId || ""),
        connected: Boolean(courier?.connected) || Boolean(courier?.chatId)
    })) : [];
    return writeLocalBucket(LOCAL_ADMIN_KEYS.couriers, couriers);
}

function buildLocalSiteSnapshot(siteState, orders) {
    const stateValue = siteState || readLocalSiteState();
    const list = Array.isArray(orders) ? orders : readLocalOrders();
    const currentSessionOrders = list
        .filter((order) => String(order?.sessionId || "").trim() === String(stateValue?.currentSessionId || "").trim())
        .filter((order) => normalizeStatus(order?.status) !== "bekor");
    const rawTotalRevenue = list.reduce((sum, order) => {
        return sum + (isOrderRevenueEligible(order) ? Number(order?.total || 0) : 0);
    }, 0);
    const carry = Math.max(0, Number(stateValue?.totalRevenueCarry || 0) || 0);
    const offset = Math.max(0, Number(stateValue?.totalRevenueOffset || 0) || 0);
    const totalRevenue = Math.max(0, carry + rawTotalRevenue - offset);

    return {
        orderingEnabled: Boolean(stateValue?.orderingEnabled),
        currentSessionId: String(stateValue?.currentSessionId || ""),
        sessionStartedAt: String(stateValue?.sessionStartedAt || ""),
        sessionStoppedAt: String(stateValue?.sessionStoppedAt || ""),
        lastSessionReport: stateValue?.lastSessionReport || null,
        totalRevenue,
        totalRevenueCarry: carry,
        totalRevenueOffset: offset,
        totalRevenueResetAt: String(stateValue?.totalRevenueResetAt || ""),
        currentSessionStats: {
            totalOrders: currentSessionOrders.length,
            newOrders: currentSessionOrders.filter((order) => normalizeStatus(order?.status) === "yangi").length,
            revenue: currentSessionOrders.reduce((sum, order) => sum + (isOrderRevenueEligible(order) ? Number(order?.total || 0) : 0), 0),
            pendingOrders: currentSessionOrders.filter((order) => !isOrderRevenueEligible(order)).length
        }
    };
}

function buildLocalSessionReport(orders, siteState) {
    const stateValue = siteState || readLocalSiteState();
    const sessionId = String(stateValue?.currentSessionId || "").trim();
    const sessionOrders = (Array.isArray(orders) ? orders : readLocalOrders())
        .filter((order) => String(order?.sessionId || "").trim() === sessionId);
    const activeOrders = sessionOrders.filter((order) => normalizeStatus(order?.status) !== "bekor");
    const paidOrders = activeOrders.filter(isOrderRevenueEligible);
    const pendingOrders = activeOrders.filter((order) => !isOrderRevenueEligible(order));
    return {
        sessionId,
        startedAt: String(stateValue?.sessionStartedAt || ""),
        stoppedAt: String(stateValue?.sessionStoppedAt || nowIso()),
        totalOrders: activeOrders.length,
        paidOrders: paidOrders.length,
        pendingOrders: pendingOrders.length,
        cancelledOrders: Math.max(0, sessionOrders.length - activeOrders.length),
        revenue: paidOrders.reduce((sum, order) => sum + Number(order?.total || 0), 0),
        updatedAt: nowIso()
    };
}

function buildLocalCourierManagement() {
    const couriers = readLocalCouriers();
    const orders = readLocalOrders();
    const enriched = couriers.map((courier) => {
        const courierId = Number(courier?.id || 0);
        const assigned = orders.filter((order) => Number(order?.courierAssignedId || 0) === courierId);
        const activeOrders = assigned.filter((order) => {
            const status = normalizeStatus(order?.status);
            return status !== "bekor" && status !== "yakunlandi";
        }).length;
        const completedOrders = assigned.filter((order) => normalizeStatus(order?.status) === "yakunlandi").length;
        return {
            ...courier,
            activeOrders,
            completedOrders,
            totalOrders: assigned.length
        };
    });
    return {
        couriers: enriched,
        totals: {
            total: enriched.length,
            connected: enriched.filter((courier) => courier.connected).length,
            activeOrders: enriched.reduce((sum, courier) => sum + Number(courier.activeOrders || 0), 0)
        }
    };
}

function ensureLocalAdminDataInitialized() {
    if (localAdminInitDone) return;
    localAdminInitDone = true;

    const seededFoods = (() => {
        const existing = readLocalBucket(LOCAL_ADMIN_KEYS.foods, null);
        if (Array.isArray(existing)) return null;
        try {
            const rawMenu = JSON.parse(localStorage.getItem("menuItems") || "[]");
            if (!Array.isArray(rawMenu)) return [];
            return rawMenu.map((food, idx) => normalizeLocalFood(food, idx + 1)).filter((food) => food.name);
        } catch (_err) {
            return [];
        }
    })();

    if (seededFoods !== null) {
        saveLocalFoods(seededFoods);
    } else {
        saveLocalFoods(readLocalFoods());
    }
    saveLocalOrders(readLocalOrders());
    saveLocalUsers(readLocalUsers());

    const foods = readLocalFoods();
    const foodCategories = uniqueStrings(foods.map((food) => food.category).filter(Boolean));
    const settings = readLocalSiteSettings();
    settings.categories = uniqueStrings([...(settings.categories || []), ...foodCategories]);
    saveLocalSiteSettings(settings);

    saveLocalSiteState(readLocalSiteState());
    saveLocalTelegramSettings(readLocalTelegramSettings());
    saveLocalCouriers(readLocalCouriers());
}

function extractPathFromUrl(url) {
    try {
        return new URL(url, window.location.origin).pathname.replace(/\/+$/, "");
    } catch (_err) {
        return String(url || "").replace(/\/+$/, "");
    }
}

function parseRequestBody(options) {
    const body = options?.body;
    if (!body) return {};
    if (typeof body === "string") {
        try {
            return JSON.parse(body);
        } catch (_err) {
            return {};
        }
    }
    if (typeof body === "object") {
        return body;
    }
    return {};
}

async function handleLocalAdminRequest(url, options = {}) {
    ensureLocalAdminDataInitialized();
    const method = String(options?.method || "GET").toUpperCase();
    const body = parseRequestBody(options);
    const path = extractPathFromUrl(url);

    if (path === "/api/user" && method === "GET") {
        return { id: "local-admin", displayName: "Admin", email: "admin@local" };
    }

    if (path === "/api/foods") {
        if (method === "GET") return readLocalFoods();
        if (method === "POST") {
            const foods = readLocalFoods();
            const nextId = foods.reduce((max, food) => Math.max(max, Number(food?.id || 0)), 0) + 1;
            const created = normalizeLocalFood({ ...body, id: nextId }, nextId);
            foods.push(created);
            saveLocalFoods(foods);
            const settings = readLocalSiteSettings();
            settings.categories = uniqueStrings([...(settings.categories || []), created.category].filter(Boolean));
            saveLocalSiteSettings(settings);
            return created;
        }
    }

    const foodMatch = path.match(/^\/api\/foods\/([^/]+)$/);
    if (foodMatch) {
        const foodId = decodeURIComponent(foodMatch[1]);
        const foods = readLocalFoods();
        const index = foods.findIndex((food) => String(food?.id) === String(foodId));
        if (index === -1) throw new Error("Taom topilmadi");
        if (method === "PUT") {
            foods[index] = normalizeLocalFood({ ...foods[index], ...body, id: foods[index].id }, foods[index].id);
            saveLocalFoods(foods);
            return foods[index];
        }
        if (method === "DELETE") {
            foods.splice(index, 1);
            saveLocalFoods(foods);
            return { success: true };
        }
    }

    if (path === "/api/orders") {
        if (method === "GET") return readLocalOrders();
        if (method === "POST") {
            const orders = readLocalOrders();
            const siteState = readLocalSiteState();
            const nextId = orders.reduce((max, order) => Math.max(max, Number(order?.id || 0)), 0) + 1;
            const status = normalizeStatus(body?.status || "yangi");
            const created = {
                ...body,
                id: nextId,
                date: String(body?.date || formatNowForOrder()),
                status,
                sessionId: String(body?.sessionId || siteState.currentSessionId || ""),
                paymentCollected: Boolean(body?.paymentCollected) || (status === "yakunlandi" && String(body?.paymentMethod || "").toLowerCase() === "cash")
            };
            orders.push(created);
            saveLocalOrders(orders);

            const users = readLocalUsers();
            const phone = String(created?.phone || "").trim();
            const email = String(created?.email || "").trim().toLowerCase();
            if (phone || email) {
                const userIdx = users.findIndex((user) => {
                    const samePhone = phone && String(user?.phone || "").trim() === phone;
                    const sameEmail = email && String(user?.email || "").trim().toLowerCase() === email;
                    return samePhone || sameEmail;
                });
                if (userIdx >= 0) {
                    users[userIdx] = {
                        ...users[userIdx],
                        phone: phone || users[userIdx].phone || "",
                        email: email || users[userIdx].email || ""
                    };
                } else {
                    users.push({
                        id: Date.now(),
                        displayName: String(created?.customerName || created?.email || created?.phone || "Mijoz"),
                        email,
                        phone
                    });
                }
                saveLocalUsers(users);
            }
            return created;
        }
    }

    const orderStatusMatch = path.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && method === "PUT") {
        const orderId = decodeURIComponent(orderStatusMatch[1]);
        const orders = readLocalOrders();
        const index = orders.findIndex((order) => String(order?.id) === String(orderId));
        if (index === -1) throw new Error("Buyurtma topilmadi");
        const nextStatus = normalizeStatus(body?.status || "");
        if (!nextStatus) throw new Error("Status noto'g'ri");
        orders[index] = {
            ...orders[index],
            status: nextStatus,
            paymentCollected: nextStatus === "yakunlandi"
                ? true
                : Boolean(orders[index]?.paymentCollected)
        };
        saveLocalOrders(orders);
        return orders[index];
    }

    if (path === "/api/users" && method === "GET") {
        return readLocalUsers();
    }

    if (path === "/api/admin/settings") {
        if (method === "GET") return readLocalSiteSettings();
        if (method === "PUT") {
            const current = readLocalSiteSettings();
            const saved = saveLocalSiteSettings({ ...current, ...body });
            return saved;
        }
    }

    if (path === "/api/admin/site-state" || path === "/api/site-state") {
        if (method === "GET") {
            return buildLocalSiteSnapshot(readLocalSiteState(), readLocalOrders());
        }
    }

    if (path === "/api/admin/site-control/start" && method === "POST") {
        const current = readLocalSiteState();
        const orders = readLocalOrders();
        const snapshot = buildLocalSiteSnapshot(current, orders);
        const nextState = saveLocalSiteState({
            ...current,
            orderingEnabled: true,
            currentSessionId: `session-${Date.now()}`,
            sessionStartedAt: nowIso(),
            sessionStoppedAt: "",
            lastSessionReport: null,
            totalRevenueCarry: Math.max(0, Number(snapshot?.totalRevenue || 0) || 0),
            totalRevenueOffset: 0
        });
        saveLocalOrders([]);
        return buildLocalSiteSnapshot(nextState, []);
    }

    if (path === "/api/admin/site-control/stop" && method === "POST") {
        const current = readLocalSiteState();
        const orders = readLocalOrders();
        const stoppedAt = nowIso();
        const report = buildLocalSessionReport(orders, { ...current, sessionStoppedAt: stoppedAt });
        const nextState = saveLocalSiteState({
            ...current,
            orderingEnabled: false,
            sessionStoppedAt: stoppedAt,
            lastSessionReport: report
        });
        return buildLocalSiteSnapshot(nextState, orders);
    }

    if (path === "/api/admin/revenue/reset" && method === "POST") {
        const current = readLocalSiteState();
        const orders = readLocalOrders();
        const rawTotalRevenue = orders.reduce((sum, order) => sum + (isOrderRevenueEligible(order) ? Number(order?.total || 0) : 0), 0);
        const nextState = saveLocalSiteState({
            ...current,
            totalRevenueCarry: 0,
            totalRevenueOffset: rawTotalRevenue,
            totalRevenueResetAt: nowIso()
        });
        return buildLocalSiteSnapshot(nextState, orders);
    }

    if (path === "/api/admin/telegram-settings") {
        if (method === "GET") {
            const telegram = readLocalTelegramSettings();
            const couriers = readLocalCouriers();
            const connectedCount = couriers.filter((courier) => courier.connected).length;
            return {
                enabled: Boolean(telegram.enabled),
                botConfigured: Boolean(telegram.botConfigured),
                botConnected: Boolean(telegram.botConnected),
                courierTotal: couriers.length,
                courierConnectedCount: connectedCount
            };
        }
        if (method === "PUT") {
            const telegram = saveLocalTelegramSettings({
                ...readLocalTelegramSettings(),
                enabled: Boolean(body?.enabled)
            });
            const couriers = readLocalCouriers();
            const connectedCount = couriers.filter((courier) => courier.connected).length;
            return {
                enabled: Boolean(telegram.enabled),
                botConfigured: Boolean(telegram.botConfigured),
                botConnected: Boolean(telegram.botConnected),
                courierTotal: couriers.length,
                courierConnectedCount: connectedCount
            };
        }
    }

    if (path === "/api/admin/telegram-token" && method === "POST") {
        const token = String(body?.token || "").trim();
        const telegram = saveLocalTelegramSettings({
            ...readLocalTelegramSettings(),
            token,
            botConfigured: Boolean(token),
            botConnected: Boolean(token)
        });
        const couriers = readLocalCouriers();
        const connectedCount = couriers.filter((courier) => courier.connected).length;
        return {
            enabled: Boolean(telegram.enabled),
            botConfigured: Boolean(telegram.botConfigured),
            botConnected: Boolean(telegram.botConnected),
            courierTotal: couriers.length,
            courierConnectedCount: connectedCount
        };
    }

    if (path === "/api/admin/telegram-admin-password" && method === "PUT") {
        const password = String(body?.password || "").trim();
        saveLocalTelegramSettings({
            ...readLocalTelegramSettings(),
            telegramAdminPassword: password
        });
        return { success: true };
    }

    if (path === "/api/admin/couriers") {
        if (method === "GET") {
            return buildLocalCourierManagement();
        }
        if (method === "POST") {
            const password = String(body?.password || "").trim();
            if (!password) throw new Error("Parol kiriting");
            const couriers = readLocalCouriers();
            const nextId = couriers.reduce((max, courier) => Math.max(max, Number(courier?.id || 0)), 0) + 1;
            const courier = {
                id: nextId,
                label: String(nextId),
                password,
                chatId: "",
                connected: false
            };
            couriers.push(courier);
            saveLocalCouriers(couriers);
            return {
                courier,
                ...buildLocalCourierManagement().totals
            };
        }
    }

    const courierDeleteMatch = path.match(/^\/api\/admin\/couriers\/([^/]+)$/);
    if (courierDeleteMatch && method === "DELETE") {
        const courierId = Number(decodeURIComponent(courierDeleteMatch[1]));
        const couriers = readLocalCouriers().filter((courier) => Number(courier?.id || 0) !== courierId);
        saveLocalCouriers(couriers);
        return { success: true };
    }

    if (path === "/api/admin/couriers/assign" && method === "POST") {
        const courierId = Number(body?.courierId || 0);
        const orderIdsRaw = String(body?.orderIds || "");
        const requestedIds = Array.from(new Set(orderIdsRaw.match(/\d+/g)?.map((id) => Number(id)) || []));
        if (!courierId || !requestedIds.length) {
            throw new Error("Kuryer va buyurtma ID kiriting");
        }

        const orders = readLocalOrders();
        const assignedIds = [];
        const failedIds = [];
        const missingIds = [];
        const skippedIds = [];
        requestedIds.forEach((id) => {
            const index = orders.findIndex((order) => Number(order?.id || 0) === id);
            if (index === -1) {
                missingIds.push(id);
                return;
            }
            const status = normalizeStatus(orders[index]?.status);
            if (status === "bekor" || status === "yakunlandi") {
                skippedIds.push(id);
                return;
            }
            orders[index] = {
                ...orders[index],
                courierAssignedId: courierId,
                courierAssigned: true,
                courierNotified: true,
                courierAssignedAt: nowIso()
            };
            assignedIds.push(id);
        });
        saveLocalOrders(orders);
        return { assignedIds, failedIds, missingIds, skippedIds };
    }

    if (path === "/api/upload-url" && method === "POST") {
        throw new Error("Local rejimda rasm URL server orqali yuklanmaydi.");
    }

    throw new Error(`Local rejim endpoint topilmadi: ${method} ${path}`);
}

const STATUS_META = {
    yangi: { label: "Yangi", className: "status-yangi" },
    tayyorlandi: { label: "Tayyorlandi", className: "status-tayyorlandi" },
    yolda: { label: "Yo'lda", className: "status-yolda" },
    yakunlandi: { label: "Yakunlandi", className: "status-yakunlandi" },
    bekor: { label: "Bekor", className: "status-bekor" }
};

const CATEGORY_COLORS = [
    "#f28b2e",
    "#42b649",
    "#9b67d8",
    "#3c8bd9",
    "#ea5f73",
    "#26a69a",
    "#8d6e63"
];

const ORDER_ALERT_STORAGE_KEY = "admin_last_seen_order_id";
const SETTINGS_ACCESS_STORAGE_KEY = "admin_settings_access_v1";
// Dinamik parol uchun default qiymat kerak emas
// const SETTINGS_PASSWORD = "123";
// Sayt nomining birinchi so'zidan dinamik parol generatsiya qiluvchi funksiya
function generateDynamicPassword(siteName) {
    if (!siteName) return "";
    const firstWord = String(siteName).trim().split(" ")[0].toUpperCase();
    return Array.from(firstWord).map(ch => {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) { // A-Z
            return (code - 64).toString();
        }
        return "";
    }).filter(Boolean).join(",");
}

// Admin panelga kirish uchun "No admin" bosilganda parol so'rash
function bindAdminLoginClick() {
    const adminUserLabel = document.getElementById('adminUserLabel');
    if (!adminUserLabel) return;

    adminUserLabel.addEventListener('click', function() {
        // Sozlamalardagi parolni ishlatish (standart: 123)
        const expectedPassword = state.siteSettings?.adminPanelPassword || "123";

        // Password prompt chiqarish
        const password = window.prompt('Admin panelga kirish uchun parolni kiriting:');
        if (password === null) return;

        // Parolni tekshirish
        if (password === expectedPassword) {
            // Dashboard bo'limini ochish
            openSection("dashboardSection");
        } else {
            alert('Parol noto\'g\'ri!');
        }
    });
}
const SETTINGS_MAX_ATTEMPTS = 5;
const SETTINGS_BLOCK_MS = 10 * 60 * 1000;
const SETTINGS_UNLOCK_MS = 10 * 60 * 1000;
let adminNoticeTimer = null;

const state = {
    foods: [],
    orders: [],
    users: [],
    chart: null,
    editingFoodId: null,
    orderFilter: "all",
    orderScope: "session",
    orderViewMode: "manage",
    customerStats: [],
    site: {
        orderingEnabled: true,
        currentSessionId: "",
        sessionStartedAt: "",
        sessionStoppedAt: "",
        totalRevenue: 0,
        totalRevenueResetAt: "",
        currentSessionStats: {
            totalOrders: 0,
            newOrders: 0,
            revenue: 0,
            pendingOrders: 0
        },
        lastSessionReport: null
    },
    siteSettings: {
        siteName: "Mansur Shashlik",
        freeDeliveryKm: 1,
        deliveryPricePerKm: 1000,
        deliveryMinutesPerKm: 1.5,
        restaurantName: "Mansur Shashlik",
        restaurantAddress: "Самарканд, ул. Имома Ал-Бухорий, 185",
        restaurantLat: 39.6594851,
        restaurantLon: 66.973074,
        categories: []
    },
    telegram: {
        enabled: false,
        botConfigured: false,
        botConnected: false,
        courierConnected: false,
        courierTotal: 0,
        courierConnectedCount: 0
    },
    settingsAccess: {
        failedAttempts: 0,
        unlockedUntil: 0,
        blockedUntil: 0
    },
    lastSeenOrderId: null,
    pollingTimer: null,
    lastFetchError: "",
    lastSyncedAt: null,
    settingsDirty: false
};

function qs(id) {
    return document.getElementById(id);
}

function showAdminNotice(message, tone = "success") {
    const notice = qs("adminNotice");
    if (!notice) {
        alert(message);
        return;
    }

    notice.hidden = false;
    notice.textContent = String(message || "");
    notice.className = `admin-toast is-${tone === "danger" ? "danger" : "success"}`;

    if (adminNoticeTimer) {
        clearTimeout(adminNoticeTimer);
    }
    adminNoticeTimer = setTimeout(() => {
        notice.hidden = true;
    }, 2800);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatMoney(value) {
    return `${Number(value || 0).toLocaleString()} so'm`;
}

function normalizeCategoryName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function getCategoryNameKey(value) {
    return normalizeCategoryName(value).toLowerCase();
}

function isSameCategoryName(a, b) {
    const left = getCategoryNameKey(a);
    return left !== "" && left === getCategoryNameKey(b);
}

function uniqueStrings(values) {
    const result = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
        const normalized = normalizeCategoryName(value);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
    });
    return result;
}

function normalizeStatus(status) {
    const key = String(status || "").trim().toLowerCase();
    return STATUS_META[key] ? key : "yangi";
}

function isClosedStatus(status) {
    const key = normalizeStatus(status);
    return key === "bekor" || key === "yakunlandi";
}

function canTransitionStatus(currentStatus, nextStatus) {
    const from = normalizeStatus(currentStatus);
    const to = normalizeStatus(nextStatus);
    if (from === to) return true;
    if (isClosedStatus(from)) return false;
    if (from === "yangi") return to === "tayyorlandi" || to === "bekor";
    if (from === "tayyorlandi") return to === "yolda" || to === "yakunlandi";
    if (from === "yolda") return to === "yakunlandi";
    return false;
}

function getMaxOrderId(list) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    return list.reduce((max, o) => {
        const id = Number(o?.id || 0);
        return id > max ? id : max;
    }, 0);
}

function loadSeenOrderIdFromStorage() {
    const raw = localStorage.getItem(ORDER_ALERT_STORAGE_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function saveSeenOrderIdToStorage(value) {
    const normalized = Number(value || 0);
    if (normalized > 0) {
        localStorage.setItem(ORDER_ALERT_STORAGE_KEY, String(normalized));
    } else {
        localStorage.removeItem(ORDER_ALERT_STORAGE_KEY);
    }
}

function markOrdersAsSeen() {
    const maxId = getMaxOrderId(state.orders);
    state.lastSeenOrderId = maxId;
    saveSeenOrderIdToStorage(maxId);
    renderOrdersAlertBadge();
}

function renderOrdersAlertBadge() {
    const badge = qs("ordersAlertBadge");
    if (!badge) return;

    const ordersSection = qs("ordersSection");
    if (ordersSection && ordersSection.classList.contains("active")) {
        const maxIdWhenOpen = getMaxOrderId(state.orders);
        state.lastSeenOrderId = maxIdWhenOpen;
        saveSeenOrderIdToStorage(maxIdWhenOpen);
        badge.classList.add("hidden");
        return;
    }

    const seenId = Number(state.lastSeenOrderId || 0);
    const unseenCount = state.orders.filter((o) => Number(o?.id || 0) > seenId).length;
    if (unseenCount > 0) {
        badge.textContent = unseenCount > 99 ? "99+" : String(unseenCount);
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

function customerKeyFromOrder(order) {
    const email = String(order?.email || "").trim().toLowerCase();
    if (email) return { key: `email:${email}`, email, id: "" };
    const id = String(order?.userId || "").trim();
    if (id) return { key: `id:${id}`, email: "", id };
    return { key: "", email: "", id: "" };
}

function buildCustomerStats() {
    const usersByEmail = new Map();
    const usersById = new Map();

    state.users.forEach((u) => {
        const email = String(u.email || "").trim().toLowerCase();
        const id = String(u.id || "").trim();
        if (email) usersByEmail.set(email, u);
        if (id) usersById.set(id, u);
    });

    const map = new Map();
    state.orders.forEach((order) => {
        const ident = customerKeyFromOrder(order);
        if (!ident.key) return;

        let row = map.get(ident.key);
        if (!row) {
            const linkedUser = ident.email
                ? usersByEmail.get(ident.email)
                : usersById.get(ident.id);

            row = {
                key: ident.key,
                displayName: linkedUser?.displayName || "",
                email: linkedUser?.email || ident.email || String(order.email || ""),
                userId: linkedUser?.id || ident.id || "",
                ordersCount: 0,
                totalSpent: 0,
                lastOrderAt: 0
            };
            map.set(ident.key, row);
        }

        row.ordersCount += 1;
        row.totalSpent += Number(order.total || 0);

        const dt = parseOrderDate(order.date || order.id);
        if (dt) {
            row.lastOrderAt = Math.max(row.lastOrderAt, dt.getTime());
        }
    });

    const result = Array.from(map.values()).map((row) => {
        if (!row.displayName) {
            if (row.email) {
                row.displayName = row.email.split("@")[0];
            } else if (row.userId) {
                row.displayName = `Mijoz ${row.userId}`;
            } else {
                row.displayName = "Mijoz";
            }
        }
        return row;
    });

    result.sort((a, b) => {
        const moneyDiff = Number(b.totalSpent || 0) - Number(a.totalSpent || 0);
        if (moneyDiff !== 0) return moneyDiff;
        return Number(b.lastOrderAt || 0) - Number(a.lastOrderAt || 0);
    });
    return result;
}

function formatDateTime(value) {
    const dt = parseOrderDate(value);
    if (!dt) return "-";
    return dt.toLocaleString("uz-UZ", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function parseOrderDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const fromText = new Date(String(value).replace(" ", "T"));
    if (!Number.isNaN(fromText.getTime())) return fromText;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        const fromId = new Date(numeric);
        if (!Number.isNaN(fromId.getTime())) return fromId;
    }
    return null;
}

function normalizeSiteState(site) {
    return {
        orderingEnabled: site?.orderingEnabled !== false,
        currentSessionId: String(site?.currentSessionId || ""),
        sessionStartedAt: String(site?.sessionStartedAt || ""),
        sessionStoppedAt: String(site?.sessionStoppedAt || ""),
        totalRevenue: Number(site?.totalRevenue || 0) || 0,
        totalRevenueResetAt: String(site?.totalRevenueResetAt || ""),
        currentSessionStats: {
            totalOrders: Number(site?.currentSessionStats?.totalOrders || 0) || 0,
            newOrders: Number(site?.currentSessionStats?.newOrders || 0) || 0,
            revenue: Number(site?.currentSessionStats?.revenue || 0) || 0,
            pendingOrders: Number(site?.currentSessionStats?.pendingOrders || 0) || 0
        },
        lastSessionReport: site?.lastSessionReport && typeof site.lastSessionReport === "object"
            ? site.lastSessionReport
            : null
    };
}

function normalizeAdminSiteSettings(siteSettings) {
    const deliveryMinutesPerKm = Number(siteSettings?.deliveryMinutesPerKm);
    const legacyMinuteStepMeters = Number(siteSettings?.deliveryMinuteStepMeters);
    const rawRestaurantLat = Number(siteSettings?.restaurantLat);
    const rawRestaurantLon = Number(siteSettings?.restaurantLon);
    return {
        siteName: String(siteSettings?.siteName || "Mansur Shashlik").trim() || "Mansur Shashlik",
        freeDeliveryKm: Math.max(0, Number(siteSettings?.freeDeliveryKm || 0) || 0),
        deliveryPricePerKm: Math.max(0, Number(siteSettings?.deliveryPricePerKm || 0) || 0),
        deliveryMinutesPerKm: Number.isFinite(deliveryMinutesPerKm) && deliveryMinutesPerKm > 0
            ? deliveryMinutesPerKm
            : (Number.isFinite(legacyMinuteStepMeters) && legacyMinuteStepMeters > 0
                ? Math.round((1000 / legacyMinuteStepMeters) * 10) / 10
                : 1.5),
        maxDeliveryKm: Math.max(0, Number(siteSettings?.maxDeliveryKm || 0) || 0),
        maxItemQuantity: Math.max(0, Number(siteSettings?.maxItemQuantity || 0) || 0),
        contactPhone: String(siteSettings?.contactPhone || "").trim(),
        adminPanelPassword: String(siteSettings?.adminPanelPassword || "123").trim() || "123",
        restaurantName: String(siteSettings?.restaurantName || "Mansur Shashlik").trim() || "Mansur Shashlik",
        restaurantAddress: String(siteSettings?.restaurantAddress || "").trim() || "Самарканд, ул. Имома Ал-Бухорий, 185",
        restaurantLat: Number.isFinite(rawRestaurantLat) ? rawRestaurantLat : 39.6594851,
        restaurantLon: Number.isFinite(rawRestaurantLon) ? rawRestaurantLon : 66.973074,
        categories: uniqueStrings(siteSettings?.categories)
    };
}

function normalizeSettingsAccess(payload) {
    return {
        failedAttempts: Math.max(0, Number(payload?.failedAttempts || 0) || 0),
        unlockedUntil: Math.max(0, Number(payload?.unlockedUntil || 0) || 0),
        blockedUntil: Math.max(0, Number(payload?.blockedUntil || 0) || 0)
    };
}

function loadSettingsAccessFromStorage() {
    try {
        const raw = localStorage.getItem(SETTINGS_ACCESS_STORAGE_KEY);
        return normalizeSettingsAccess(raw ? JSON.parse(raw) : null);
    } catch (err) {
        return normalizeSettingsAccess(null);
    }
}

function saveSettingsAccessToStorage() {
    localStorage.setItem(SETTINGS_ACCESS_STORAGE_KEY, JSON.stringify(state.settingsAccess));
}

function resetExpiredSettingsAccess() {
    const now = Date.now();
    let changed = false;
    if (Number(state.settingsAccess.unlockedUntil || 0) <= now && state.settingsAccess.unlockedUntil) {
        state.settingsAccess.unlockedUntil = 0;
        changed = true;
    }
    if (Number(state.settingsAccess.blockedUntil || 0) <= now && state.settingsAccess.blockedUntil) {
        state.settingsAccess.blockedUntil = 0;
        state.settingsAccess.failedAttempts = 0;
        changed = true;
    }
    if (changed) saveSettingsAccessToStorage();
}

function isSettingsUnlocked() {
    resetExpiredSettingsAccess();
    return Number(state.settingsAccess.unlockedUntil || 0) > Date.now();
}

function isSettingsBlocked() {
    resetExpiredSettingsAccess();
    return Number(state.settingsAccess.blockedUntil || 0) > Date.now();
}

function formatRemainingMinutes(ms) {
    const safeMs = Math.max(0, Number(ms || 0) || 0);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ensureSettingsAccess() {
    resetExpiredSettingsAccess();
    if (isSettingsBlocked()) {
        const remaining = Number(state.settingsAccess.blockedUntil || 0) - Date.now();
        alert(`Sozlamalar vaqtincha bloklangan. ${formatRemainingMinutes(remaining)} kuting.`);
        return false;
    }
    if (isSettingsUnlocked()) return true;

    const remainingAttempts = SETTINGS_MAX_ATTEMPTS - Number(state.settingsAccess.failedAttempts || 0);
    const password = window.prompt(`Sozlamalar parolini kiriting. Qolgan urinish: ${remainingAttempts}`);
    if (password === null) return false;

    // Sozlamalardagi parolni ishlatish
    const expectedPassword = state.siteSettings?.adminPanelPassword || "123";
    if (password === expectedPassword) {
        state.settingsAccess = {
            failedAttempts: 0,
            unlockedUntil: Date.now() + SETTINGS_UNLOCK_MS,
            blockedUntil: 0
        };
        saveSettingsAccessToStorage();
        renderSettings();
        return true;
    }

    state.settingsAccess.failedAttempts = Math.max(0, Number(state.settingsAccess.failedAttempts || 0) + 1);
    if (state.settingsAccess.failedAttempts >= SETTINGS_MAX_ATTEMPTS) {
        state.settingsAccess = {
            failedAttempts: 0,
            unlockedUntil: 0,
            blockedUntil: Date.now() + SETTINGS_BLOCK_MS
        };
        saveSettingsAccessToStorage();
        alert("Parol 5 marta xato kiritildi. Sozlamalar bo'limi 10 daqiqaga bloklandi.");
        renderSettings();
        return false;
    }

    saveSettingsAccessToStorage();
    const attemptsLeft = SETTINGS_MAX_ATTEMPTS - state.settingsAccess.failedAttempts;
    alert(`Parol noto'g'ri. Yana ${attemptsLeft} marta urinib ko'rishingiz mumkin.`);
    return false;
}

function isOrderRevenueEligible(order) {
    const status = normalizeStatus(order?.status);
    if (status === "bekor") return false;
    if (Boolean(order?.paymentCollected)) return true;
    const paymentMethod = String(order?.paymentMethod || "").trim().toLowerCase();
    const paymentStatus = String(order?.paymentStatus || "").trim().toLowerCase();
    return paymentMethod === "card" && paymentStatus === "paid";
}

function getVisibleBaseOrders() {
    const allOrders = state.orders.filter((order) => normalizeStatus(order.status) !== "bekor");
    if (state.orderScope === "all") {
        return allOrders;
    }

    const sessionId = String(state.site?.currentSessionId || "").trim();
    if (!sessionId) return [];
    return allOrders.filter((order) => String(order?.sessionId || "").trim() === sessionId);
}

function getVisibleOrders() {
    const base = getVisibleBaseOrders();
    if (state.orderFilter === "yangi") {
        return base.filter((order) => normalizeStatus(order.status) === "yangi");
    }
    return base;
}

function formatNowForOrder() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function fetchJson(url, options) {
    if (EMBED_LOCAL_ADMIN_MODE) {
        return handleLocalAdminRequest(url, options || {});
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(txt || `HTTP ${response.status}`);
    }
    return response.json();
}

async function loadFoods() {
    const foods = await fetchJson(`${ADMIN_API_URL}/foods`);
    return Array.isArray(foods) ? foods : [];
}

async function loadOrders() {
    const orders = await fetchJson(`${ADMIN_API_URL}/orders`);
    const list = Array.isArray(orders) ? orders : [];
    list.forEach((o) => {
        o.status = normalizeStatus(o.status || "");
    });
    return list.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

async function loadUsers() {
    try {
        const users = await fetchJson(`${ADMIN_API_URL}/users`);
        return Array.isArray(users) ? users : [];
    } catch (err) {
        return [];
    }
}

async function loadTelegramSettings() {
    try {
        const settings = await fetchJson(`${ADMIN_API_URL}/admin/telegram-settings`);
        const courierTotal = Number(settings?.courierTotal || 0);
        const courierConnectedCount = Number(settings?.courierConnectedCount || 0);
        return {
            enabled: Boolean(settings?.enabled),
            botConfigured: Boolean(settings?.botConfigured),
            botConnected: Boolean(settings?.botConnected),
            courierConnected: courierConnectedCount > 0,
            courierTotal,
            courierConnectedCount
        };
    } catch (err) {
        return {
            enabled: false,
            botConfigured: false,
            botConnected: false,
            courierConnected: false,
            courierTotal: 0,
            courierConnectedCount: 0
        };
    }
}

async function loadSiteSettings() {
    try {
        const settings = await fetchJson(`${ADMIN_API_URL}/admin/settings`);
        return normalizeAdminSiteSettings(settings);
    } catch (err) {
        return normalizeAdminSiteSettings(null);
    }
}

async function loadSiteState() {
    try {
        const site = await fetchJson(`${ADMIN_API_URL}/admin/site-state`);
        return normalizeSiteState(site);
    } catch (err) {
        return normalizeSiteState(null);
    }
}

async function setTelegramEnabled(enabled) {
    const settings = await fetchJson(`${ADMIN_API_URL}/admin/telegram-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: Boolean(enabled) })
    });
    const courierTotal = Number(settings?.courierTotal || 0);
    const courierConnectedCount = Number(settings?.courierConnectedCount || 0);
    state.telegram = {
        enabled: Boolean(settings?.enabled),
        botConfigured: Boolean(settings?.botConfigured),
        botConnected: Boolean(settings?.botConnected),
        courierConnected: courierConnectedCount > 0,
        courierTotal,
        courierConnectedCount
    };
    renderTelegramControl();
}

async function saveSiteSettings(payload) {
    const settings = await fetchJson(`${ADMIN_API_URL}/admin/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    state.siteSettings = normalizeAdminSiteSettings(settings);
    applyAdminBranding();
    renderFoodCategoryOptions();
    renderSettings();
    renderCategoryList(); // UI yangilanishi uchun qo'shildi
    return state.siteSettings;
}

async function saveTelegramAdminPassword(password) {
    return fetchJson(`${ADMIN_API_URL}/admin/telegram-admin-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
    });
}

async function resetTotalRevenue() {
    const site = await fetchJson(`${ADMIN_API_URL}/admin/revenue/reset`, {
        method: "POST"
    });
    state.site = normalizeSiteState(site);
    return state.site;
}

async function startSiteSession() {
    const site = await fetchJson(`${ADMIN_API_URL}/admin/site-control/start`, {
        method: "POST"
    });
    state.site = normalizeSiteState(site);
}

async function stopSiteSession() {
    const site = await fetchJson(`${ADMIN_API_URL}/admin/site-control/stop`, {
        method: "POST"
    });
    state.site = normalizeSiteState(site);
}

async function loadAdminUserChip() {
    try {
        const user = await fetchJson(`${ADMIN_API_BASE_URL}/api/user`, { credentials: "include" });
        qs("adminUserLabel").textContent = user.displayName || user.email || "Admin";
    } catch (err) {
        qs("adminUserLabel").textContent = "No admin";
    }
}

function applyAdminBranding() {
    const siteName = state.siteSettings?.siteName || "Mansur Shashlik";
    document.title = `Admin Panel | ${siteName}`;
    const brandName = qs("adminBrandName");
    const topTitle = qs("adminTopTitle");
    if (brandName) brandName.textContent = siteName;
    if (topTitle) topTitle.textContent = `${siteName} Admin`;
}

function renderFoodCategoryOptions() {
    const categorySelect = qs("foodCategory");
    if (!categorySelect) return;

    const categories = uniqueStrings(state.siteSettings?.categories || []);

    const currentValue = String(categorySelect.value || "").trim();
    if (!categories.length) {
        categorySelect.innerHTML = `<option value="">Avval kategoriya qo'shing</option>`;
        categorySelect.value = "";
        categorySelect.disabled = true;
        return;
    }
    categorySelect.disabled = false;
    categorySelect.innerHTML = categories.map((category) => (
        `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    )).join("");

    if (currentValue && categories.some((category) => category === currentValue)) {
        categorySelect.value = currentValue;
        return;
    }
    if (!categorySelect.value && categories[0]) {
        categorySelect.value = categories[0];
    }
}

function getOrderCustomerLabel(order) {
    const explicit = String(order?.customerName || "").trim();
    if (explicit) return explicit;

    const orderUserId = String(order?.userId || "").trim();
    const orderEmail = String(order?.email || "").trim().toLowerCase();
    const orderPhone = String(order?.phone || "").trim();
    const linkedUser = state.users.find((user) => {
        const sameId = orderUserId && String(user?.id || "").trim() === orderUserId;
        const sameEmail = orderEmail && String(user?.email || "").trim().toLowerCase() === orderEmail;
        const samePhone = orderPhone && String(user?.phone || "").trim() === orderPhone;
        return sameId || sameEmail || samePhone;
    });
    if (linkedUser?.displayName) return linkedUser.displayName;
    if (orderEmail) return orderEmail.split("@")[0];
    return orderUserId ? `Mijoz ${orderUserId}` : "Mijoz";
}

function openSection(sectionId) {
    document.querySelectorAll(".panel-section").forEach((el) => {
        el.classList.toggle("active", el.id === sectionId);
    });
    document.querySelectorAll(".nav-item[data-section]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === sectionId);
    });
    if (sectionId === "ordersSection") {
        markOrdersAsSeen();
    }
}

function setOrdersFilter(mode) {
    state.orderFilter = mode === "yangi" ? "yangi" : "all";
    renderOrdersGrid();
}

function bindNavigation() {
    document.querySelectorAll(".nav-item[data-section]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.dataset.section === "settingsSection" && !ensureSettingsAccess()) {
                renderSettings();
                return;
            }
            if (btn.dataset.section === "ordersSection") {
                state.orderScope = "session";
                state.orderViewMode = "manage";
                setOrdersFilter("all");
            }
            openSection(btn.dataset.section);
        });
    });
    document.querySelectorAll("[data-open-section]").forEach((btn) => {
        btn.addEventListener("click", () => openSection(btn.dataset.openSection));
    });
    const goToSiteBtn = qs("goToSiteBtn");
    if (goToSiteBtn) {
        goToSiteBtn.addEventListener("click", () => {
            if (typeof window.closeAdminPanel === "function") {
                window.closeAdminPanel();
                return;
            }
            window.open("/", "_blank");
        });
    }
}

function bindKpiActions() {
    const newOrdersCard = qs("kpiCardNewOrders");
    if (newOrdersCard) {
        newOrdersCard.addEventListener("click", () => {
            state.orderScope = "session";
            state.orderViewMode = "manage";
            setOrdersFilter("yangi");
            openSection("ordersSection");
        });
    }

    const totalOrdersCard = qs("kpiCardTotalOrders");
    if (totalOrdersCard) {
        totalOrdersCard.addEventListener("click", () => {
            state.orderScope = "all";
            state.orderViewMode = "readonly";
            setOrdersFilter("all");
            openSection("ordersSection");
        });
    }

    const usersCard = qs("kpiCardUsers");
    if (usersCard) {
        usersCard.addEventListener("click", () => {
            openSection("usersSection");
        });
    }
}

function bindTelegramControls() {
    const enableBtn = qs("telegramEnableBtn");
    const disableBtn = qs("telegramDisableBtn");

    if (enableBtn) {
        enableBtn.addEventListener("click", async () => {
            try {
                await setTelegramEnabled(true);
                await refreshAllData(true);
            } catch (err) {
                alert(`Telegram botni yoqishda xato: ${err.message}`);
            }
        });
    }

    if (disableBtn) {
        disableBtn.addEventListener("click", async () => {
            try {
                await setTelegramEnabled(false);
                await refreshAllData(true);
            } catch (err) {
                alert(`Telegram botni o'chirishda xato: ${err.message}`);
            }
        });
    }
}

function openTelegramModal() {
    const modal = qs("telegramModal");
    if (!modal) return;
    modal.style.display = "flex";
    const input = qs("telegramApiInput");
    if (input) {
        input.value = "";
        input.focus();
    }
}

function closeTelegramModal() {
    const modal = qs("telegramModal");
    if (!modal) return;
    modal.style.display = "none";
}

async function connectTelegramToken() {
    const input = qs("telegramApiInput");
    const submitBtn = qs("connectTelegramBtn");
    if (!input) return;
    const token = String(input.value || "").trim();
    if (!token) {
        showAdminNotice("API key kiriting.", "danger");
        input.focus();
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
        const settings = await fetchJson(`${ADMIN_API_URL}/admin/telegram-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        const courierTotal = Number(settings?.courierTotal || 0);
        const courierConnectedCount = Number(settings?.courierConnectedCount || 0);
        state.telegram = {
            enabled: Boolean(settings?.enabled),
            botConfigured: Boolean(settings?.botConfigured),
            botConnected: Boolean(settings?.botConnected),
            courierConnected: courierConnectedCount > 0,
            courierTotal,
            courierConnectedCount
        };
        renderTelegramControl();
        showAdminNotice("Telegram API key saqlandi. Botga /start yuboring.", "success");
        closeTelegramModal();
    } catch (err) {
        showAdminNotice(`Telegram ulashda xato: ${err.message}`, "danger");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function bindTelegramModal() {
    const openBtn = qs("openTelegramModalBtn");
    const closeBtn = qs("closeTelegramModalBtn");
    const submitBtn = qs("connectTelegramBtn");
    const modal = qs("telegramModal");
    const input = qs("telegramApiInput");

    if (openBtn) openBtn.addEventListener("click", openTelegramModal);
    if (closeBtn) closeBtn.addEventListener("click", closeTelegramModal);
    if (submitBtn) submitBtn.addEventListener("click", connectTelegramToken);
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                connectTelegramToken();
            }
        });
    }
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeTelegramModal();
            }
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal && modal.style.display !== "none") {
            closeTelegramModal();
        }
    });
}

function openCourierModal() {
    const modal = qs("courierModal");
    if (!modal) return;
    modal.style.display = "flex";
    const input = qs("courierPasswordInput");
    if (input) {
        input.value = "";
        input.focus();
    }
}

function closeCourierModal() {
    const modal = qs("courierModal");
    if (!modal) return;
    modal.style.display = "none";
}

async function createCourierPassword() {
    const input = qs("courierPasswordInput");
    const submitBtn = qs("createCourierBtn");
    if (!input) return;
    const password = String(input.value || "").trim();
    if (!password) {
        showAdminNotice("Kuryer parolini kiriting.", "danger");
        input.focus();
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
        const result = await fetchJson(`${ADMIN_API_URL}/admin/couriers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const courierLabel = result?.courier?.label || result?.courier?.id || "";
        const telegram = await loadTelegramSettings();
        state.telegram = telegram;
        renderTelegramControl();
        showAdminNotice(`Kuryer ${courierLabel ? `#${courierLabel}` : ""} paroli yaratildi.`, "success");
        closeCourierModal();
    } catch (err) {
        showAdminNotice(`Kuryer yaratishda xato: ${err.message}`, "danger");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function bindCourierModal() {
    const openBtn = qs("openCourierModalBtn");
    const closeBtn = qs("closeCourierModalBtn");
    const submitBtn = qs("createCourierBtn");
    const modal = qs("courierModal");
    const input = qs("courierPasswordInput");

    if (openBtn) openBtn.addEventListener("click", openCourierModal);
    if (closeBtn) closeBtn.addEventListener("click", closeCourierModal);
    if (submitBtn) submitBtn.addEventListener("click", createCourierPassword);
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                createCourierPassword();
            }
        });
    }
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeCourierModal();
            }
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal && modal.style.display !== "none") {
            closeCourierModal();
        }
    });
}

async function loadCourierManagement() {
    return fetchJson(`${ADMIN_API_URL}/admin/couriers`);
}

function renderCourierManagement(data) {
    const list = qs("courierList");
    const summary = qs("courierSummary");
    const select = qs("assignCourierSelect");
    if (!list || !summary || !select) return;

    const couriers = Array.isArray(data?.couriers) ? data.couriers : [];
    const totals = data?.totals || {};
    const connected = Number(totals?.connected || 0);
    const total = Number(totals?.total || couriers.length || 0);
    const activeOrders = Number(totals?.activeOrders || 0);
    summary.textContent = `Jami kuryerlar: ${total}, ulangan: ${connected}, aktiv buyurtmalar: ${activeOrders}`;

    if (!couriers.length) {
        list.innerHTML = "<div class=\"courier-meta\">Hozircha kuryer yo'q.</div>";
        select.innerHTML = "<option value=\"\">Kuryer yo'q</option>";
        return;
    }

    list.innerHTML = couriers.map((courier) => {
        const label = courier?.label || courier?.id || "";
        const password = courier?.password ? escapeHtml(courier.password) : "-";
        const connectedText = courier?.connected ? "Ulangan" : "Ulanmagan";
        const statusClass = courier?.connected ? "online" : "offline";
        const active = Number(courier?.activeOrders || 0);
        const done = Number(courier?.completedOrders || 0);
        const totalOrders = Number(courier?.totalOrders || 0);
        return `
            <div class="courier-card">
                <div class="courier-row">
                    <div class="courier-name">Kuryer #${escapeHtml(label)}</div>
                    <div class="courier-status ${statusClass}">${connectedText}</div>
                </div>
                <div class="courier-row">
                    <div class="courier-meta">Parol: <strong>${password}</strong></div>
                    <div class="courier-meta">Aktiv: ${active} | Yakunlangan: ${done} | Jami: ${totalOrders}</div>
                </div>
                <div class="courier-row courier-actions">
                    <button class="courier-delete-btn" data-delete-courier-id="${escapeHtml(label)}">O'chirish</button>
                </div>
            </div>
        `;
    }).join("");

    select.innerHTML = couriers.map((courier) => {
        const label = courier?.label || courier?.id || "";
        const status = courier?.connected ? "ulangan" : "offline";
        return `<option value="${escapeHtml(courier?.id)}">Kuryer #${escapeHtml(label)} (${status})</option>`;
    }).join("");
}

async function refreshCourierManagement() {
    const data = await loadCourierManagement();
    renderCourierManagement(data);
}

function openCourierManageModal() {
    const modal = qs("courierManageModal");
    if (!modal) return;
    modal.style.display = "flex";
    refreshCourierManagement().catch((err) => {
        showAdminNotice(`Kuryerlar ro'yxatini olishda xato: ${err.message}`, "danger");
    });
}

function closeCourierManageModal() {
    const modal = qs("courierManageModal");
    if (!modal) return;
    modal.style.display = "none";
}

async function deleteCourierById(courierId) {
    const id = String(courierId || "").trim();
    if (!id) return;
    if (!confirm(`Kuryer #${id} ni o'chirishni tasdiqlaysizmi?`)) return;
    try {
        await fetchJson(`${ADMIN_API_URL}/admin/couriers/${encodeURIComponent(id)}`, { method: "DELETE" });
        showAdminNotice(`Kuryer #${id} o'chirildi.`, "success");
        await refreshCourierManagement();
        await refreshAllData();
    } catch (err) {
        showAdminNotice(`Kuryer o'chirishda xato: ${err.message}`, "danger");
    }
}

async function assignOrdersToCourier() {
    const select = qs("assignCourierSelect");
    const input = qs("assignOrderIdsInput");
    const btn = qs("assignOrdersBtn");
    if (!select || !input) return;
    const courierId = String(select.value || "").trim();
    const orderIds = String(input.value || "").trim();
    if (!courierId) {
        showAdminNotice("Kuryer tanlang.", "danger");
        return;
    }
    if (!orderIds) {
        showAdminNotice("Buyurtma ID kiriting.", "danger");
        input.focus();
        return;
    }
    if (btn) btn.disabled = true;
    try {
        const result = await fetchJson(`${ADMIN_API_URL}/admin/couriers/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courierId, orderIds })
        });
        const assigned = Array.isArray(result?.assignedIds) ? result.assignedIds.length : 0;
        const failed = Array.isArray(result?.failedIds) ? result.failedIds.length : 0;
        const missing = Array.isArray(result?.missingIds) ? result.missingIds.length : 0;
        const skipped = Array.isArray(result?.skippedIds) ? result.skippedIds.length : 0;
        showAdminNotice(
            `Dastavka yuborildi. Berildi: ${assigned}, yuborilmadi: ${failed}, topilmadi: ${missing}, o'tkazildi: ${skipped}.`,
            assigned ? "success" : "danger"
        );
        input.value = "";
        await refreshCourierManagement();
        await refreshAllData();
    } catch (err) {
        showAdminNotice(`Dastavka yuborishda xato: ${err.message}`, "danger");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function bindCourierManageModal() {
    const openBtn = qs("openCourierManageModalBtn");
    const closeBtn = qs("closeCourierManageModalBtn");
    const modal = qs("courierManageModal");
    const list = qs("courierList");
    const assignBtn = qs("assignOrdersBtn");
    const input = qs("assignOrderIdsInput");

    if (openBtn) openBtn.addEventListener("click", openCourierManageModal);
    if (closeBtn) closeBtn.addEventListener("click", closeCourierManageModal);
    if (assignBtn) assignBtn.addEventListener("click", assignOrdersToCourier);
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                assignOrdersToCourier();
            }
        });
    }
    if (list) {
        list.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-delete-courier-id]");
            if (!btn) return;
            deleteCourierById(btn.dataset.deleteCourierId);
        });
    }
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeCourierManageModal();
            }
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal && modal.style.display !== "none") {
            closeCourierManageModal();
        }
    });
}

function bindSiteControls() {
    const startBtn = qs("siteStartBtn");
    const stopBtn = qs("siteStopBtn");

    if (startBtn) {
        startBtn.addEventListener("click", async () => {
            try {
                await startSiteSession();
                await refreshAllData(true);
                state.orderScope = "session";
                state.orderViewMode = "manage";
                state.lastSeenOrderId = getMaxOrderId(state.orders);
                saveSeenOrderIdToStorage(state.lastSeenOrderId);
                setOrdersFilter("all");
                showAdminNotice("Sayt ishga tushdi. Yangi sessiya boshlandi.", "success");
            } catch (err) {
                alert(`Saytni ishga tushirishda xato: ${err.message}`);
            }
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener("click", async () => {
            try {
                await stopSiteSession();
                await refreshAllData(true);
                showAdminNotice("Sayt to'xtatildi. Buyurtma qabul qilish yopildi.", "danger");
                const report = state.site?.lastSessionReport;
                if (report) {
                    alert(
                        `Sessiya to'xtatildi.\n` +
                        `Jami buyurtma: ${Number(report.totalOrders || 0).toLocaleString()}\n` +
                        `Pulli buyurtma: ${Number(report.paidOrders || 0).toLocaleString()}\n` +
                        `Daromad: ${formatMoney(report.revenue || 0)}`
                    );
                }
            } catch (err) {
                alert(`Saytni to'xtatishda xato: ${err.message}`);
            }
        });
    }
}

function bindForms() {
    const addFoodForm = qs("addFoodForm");
    if (addFoodForm) addFoodForm.addEventListener("submit", addFoodToMenu);

    const addCategoryBtn = qs("addCategoryBtn");
    if (addCategoryBtn) addCategoryBtn.addEventListener("click", addCategoryToCatalog);

    const newOrderForm = qs("newOrderForm");
    if (newOrderForm) newOrderForm.addEventListener("submit", createManualOrder);

    const searchFoodBtn = qs("searchFoodBtn");
    if (searchFoodBtn) searchFoodBtn.addEventListener("click", searchFoodForEdit);

    const searchInput = qs("adminSearchInput");
    if (searchInput) {
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                searchFoodForEdit();
            }
        });
    }

    const saveEditedFoodBtn = qs("saveEditedFoodBtn");
    if (saveEditedFoodBtn) saveEditedFoodBtn.addEventListener("click", saveEditedFood);

    const siteSettingsForm = qs("siteSettingsForm");
    if (siteSettingsForm) {
        siteSettingsForm.addEventListener("input", () => {
            state.settingsDirty = true;
        });
        siteSettingsForm.addEventListener("change", () => {
            state.settingsDirty = true;
        });
        siteSettingsForm.addEventListener("submit", saveSiteSettingsForm);
    }

    const refreshReportsBtn = qs("refreshReportsBtn");
    if (refreshReportsBtn) refreshReportsBtn.addEventListener("click", () => refreshAllData(true));

    const openNewOrderBtn = qs("openNewOrderFormBtn");
    if (openNewOrderBtn) {
        openNewOrderBtn.addEventListener("click", () => openSection("newOrderSection"));
    }

}

function bindOrderActionDelegation() {
    document.addEventListener("click", async (event) => {
        const statusBtn = event.target.closest("[data-order-id][data-next-status]");
        if (!statusBtn) return;
        const orderId = statusBtn.dataset.orderId;
        const nextStatus = statusBtn.dataset.nextStatus;
        if (!orderId || !nextStatus) return;
        await updateOrderStatus(orderId, nextStatus);
    });
}

function statusBadgeHtml(status) {
    const key = normalizeStatus(status);
    const meta = STATUS_META[key];
    return `<span class="status-badge ${meta.className}">${meta.label}</span>`;
}

function renderKpis() {
    const currentSessionStats = state.site?.currentSessionStats || {};
    const newOrders = Number(currentSessionStats.newOrders || 0);
    const totalOrders = Number(currentSessionStats.totalOrders || 0);
    const revenue = Number(state.site?.totalRevenue || 0);
    const sessionRevenue = state.site?.orderingEnabled
        ? Number(currentSessionStats.revenue || 0)
        : Number(state.site?.lastSessionReport?.revenue || currentSessionStats.revenue || 0);
    const users = state.customerStats.length;

    qs("kpiNewOrders").textContent = newOrders.toLocaleString();
    qs("kpiTotalOrders").textContent = totalOrders.toLocaleString();
    qs("kpiRevenue").textContent = formatMoney(revenue);
    qs("kpiSessionRevenue").textContent = formatMoney(sessionRevenue);
    qs("kpiUsers").textContent = users.toLocaleString();
}

function renderLatestOrdersTable() {
    const body = qs("latestOrdersBody");
    if (!body) return;

    const latest = state.orders.slice(0, 8);
    if (latest.length === 0) {
        body.innerHTML = `<tr><td colspan="6"><div class="empty-box">Buyurtmalar topilmadi</div></td></tr>`;
        return;
    }

    body.innerHTML = latest.map((order) => {
        const id = order.id || "-";
        const customer = order.email || order.userId || "Mijoz";
        const phone = order.phone || "-";
        const address = order.address || "-";
        const comment = String(order?.customerComment || order?.comment || "").trim();
        const addressWithComment = comment
            ? `${escapeHtml(address)}<br><small><b>Izoh:</b> ${escapeHtml(comment)}</small>`
            : escapeHtml(address);
        const status = normalizeStatus(order.status);
        return `
            <tr>
                <td>#${escapeHtml(id)}</td>
                <td>${escapeHtml(customer)}</td>
                <td>${escapeHtml(phone)}</td>
                <td>${addressWithComment}</td>
                <td>${statusBadgeHtml(status)}</td>
                <td>
                    <div class="order-actions">
                        <button class="mini-btn ready" data-order-id="${escapeHtml(id)}" data-next-status="tayyorlandi">Tayyor</button>
                        <button class="mini-btn route" data-order-id="${escapeHtml(id)}" data-next-status="yolda">Yo'lda</button>
                        <button class="mini-btn done" data-order-id="${escapeHtml(id)}" data-next-status="yakunlandi">Yakun</button>
                        <button class="mini-btn cancel" data-order-id="${escapeHtml(id)}" data-next-status="bekor">Bekor</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

function renderOrdersGrid() {
    const list = qs("ordersList");
    if (!list) return;
    const titleEl = qs("ordersSectionTitle");

    const filteredOrders = getVisibleOrders();
    const isReadonly = state.orderViewMode === "readonly";

    if (titleEl) {
        if (state.orderScope === "all") {
            titleEl.textContent = "Umumiy Buyurtmalar";
        } else if (state.orderFilter === "yangi") {
            titleEl.textContent = "Yangi Buyurtmalar";
        } else {
            titleEl.textContent = "Joriy Sessiya Buyurtmalari";
        }
    }

    if (filteredOrders.length === 0) {
        list.innerHTML = `<div class="empty-box">Hozircha buyurtmalar yo'q</div>`;
        return;
    }

    list.innerHTML = filteredOrders.map((order) => {
        const id = order.id || "-";
        const status = normalizeStatus(order.status);
        const customerComment = String(order?.customerComment || order?.comment || "").trim();
        const items = order.items && typeof order.items === "object"
            ? Object.entries(order.items).map(([name, info]) => {
                const quantity = Number(info?.quantity || 0);
                return `<div><span>${escapeHtml(name)}</span><strong>x${quantity}</strong></div>`;
            }).join("")
            : `<div><span>Item yo'q</span><strong>-</strong></div>`;
        const customer = getOrderCustomerLabel(order);
        const statusNote = status === "bekor"
            ? "Buyurtma bekor qilingan"
            : (status === "yakunlandi"
                ? "Buyurtma yakunlangan"
                : (status === "tayyorlandi" || status === "yolda")
                    ? "Buyurtma kuryerga berilgan, qayta boshqarib bo'lmaydi"
                    : "");
        const actionsHtml = isReadonly
            ? `<div class="order-readonly-note">Faqat ko'rish rejimi</div>`
            : statusNote
                ? `<div class="order-readonly-note">${escapeHtml(statusNote)}</div>`
                : `
                    <div class="order-actions order-actions-wide">
                        <button class="mini-btn ready" data-order-id="${escapeHtml(id)}" data-next-status="tayyorlandi">Tayyor</button>
                        <button class="mini-btn cancel" data-order-id="${escapeHtml(id)}" data-next-status="bekor">Bekor qilish</button>
                    </div>
                `;
        return `
            <article class="order-card-admin">
                <div class="order-card-top">
                    <strong>#${escapeHtml(id)}</strong>
                    ${statusBadgeHtml(status)}
                </div>
                <div class="order-customer-name">${escapeHtml(customer)}</div>
                <div><b>Tel:</b> ${escapeHtml(order.phone || "-")}</div>
                <div><b>Manzil:</b> ${escapeHtml(order.address || "-")}</div>
                <div><b>Izoh:</b> ${escapeHtml(customerComment || "-")}</div>
                <div><b>Sana:</b> ${escapeHtml(formatDateTime(order.date || order.id))}</div>
                <div class="order-mini-items order-mini-items-strong">${items}</div>
                <div><b>Jami:</b> ${formatMoney(order.total || 0)}</div>
                ${actionsHtml}
            </article>
        `;
    }).join("");
}

function renderUsersTable() {
    const body = qs("usersTableBody");
    if (!body) return;

    if (state.customerStats.length === 0) {
        body.innerHTML = `<tr><td colspan="4">Buyurtma bergan foydalanuvchi topilmadi</td></tr>`;
        return;
    }

    body.innerHTML = state.customerStats.map((u) => `
        <tr>
            <td>${escapeHtml(u.displayName || "-")}</td>
            <td>${escapeHtml(u.email || "-")}</td>
            <td>${Number(u.ordersCount || 0).toLocaleString()}</td>
            <td>${formatMoney(u.totalSpent || 0)}</td>
        </tr>
    `).join("");
}

function getFoodCategoryMap() {
    const map = new Map();
    state.foods.forEach((food) => {
        const key = String(food.name || "").trim().toLowerCase();
        if (!key) return;
        map.set(key, food.category || "Boshqa");
    });
    return map;
}

function buildCategoryStats() {
    const stats = {};
    const foodMap = getFoodCategoryMap();

    state.orders.forEach((order) => {
        const items = order.items;
        if (!items || typeof items !== "object") return;
        Object.entries(items).forEach(([name, value]) => {
            const qty = Number(value?.quantity || 0);
            if (qty <= 0) return;
            const category = foodMap.get(String(name || "").trim().toLowerCase()) || "Boshqa";
            stats[category] = (stats[category] || 0) + qty;
        });
    });

    if (Object.keys(stats).length === 0) {
        state.foods.forEach((food) => {
            const category = food.category || "Boshqa";
            stats[category] = (stats[category] || 0) + 1;
        });
    }

    if (Object.keys(stats).length === 0) {
        stats["Boshqa"] = 1;
    }

    return stats;
}

function renderCategoryChart() {
    const canvas = qs("foodStatsChart");
    if (!canvas || typeof Chart === "undefined") return;

    const stats = buildCategoryStats();
    const labels = Object.keys(stats);
    const values = labels.map((label) => stats[label]);
    const colors = labels.map((_, idx) => CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);

    if (state.chart) {
        state.chart.destroy();
    }

    state.chart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 1,
                borderColor: "#fff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });

    const legend = qs("categoryLegend");
    if (legend) {
        legend.innerHTML = labels.map((label, idx) => `
            <span class="legend-pill">
                <span class="legend-dot" style="background:${colors[idx]}"></span>
                ${escapeHtml(label)} (${values[idx]})
            </span>
        `).join("");
    }
}

function renderSettings() {
    const apiText = qs("apiInfoText");
    const serverText = qs("serverInfoText");
    const lastSyncText = qs("lastSyncText");
    const categoriesText = qs("settingsCategoriesText");
    const totalRevenueText = qs("settingsTotalRevenue");
    const lockedBox = qs("settingsLockedBox");
    const settingsForm = qs("siteSettingsForm");
    if (apiText) apiText.textContent = ADMIN_API_URL;
    if (serverText) serverText.textContent = state.lastFetchError ? "Xato bilan ishlamoqda" : "Ulangan";
    if (lastSyncText) {
        lastSyncText.textContent = state.lastSyncedAt
            ? state.lastSyncedAt.toLocaleString("uz-UZ")
            : "-";
    }
    if (categoriesText) {
        categoriesText.textContent = uniqueStrings(state.siteSettings?.categories).join(", ") || "-";
    }
    if (totalRevenueText) {
        totalRevenueText.textContent = formatMoney(state.site?.totalRevenue || 0);
    }

    const unlocked = isSettingsUnlocked();
    if (lockedBox) {
        if (isSettingsBlocked()) {
            const remaining = Number(state.settingsAccess.blockedUntil || 0) - Date.now();
            lockedBox.textContent = `Sozlamalar bloklangan. Qolgan vaqt: ${formatRemainingMinutes(remaining)}`;
        } else if (!unlocked) {
            const attemptsLeft = SETTINGS_MAX_ATTEMPTS - Number(state.settingsAccess.failedAttempts || 0);
            lockedBox.textContent = `Bu bo'lim parol bilan ochiladi. Qolgan urinish: ${attemptsLeft}`;
        } else {
            const remaining = Number(state.settingsAccess.unlockedUntil || 0) - Date.now();
            lockedBox.textContent = `Sozlamalar ochiq. Parol oynasi ${formatRemainingMinutes(remaining)} dan keyin qayta so'raladi.`;
        }
        lockedBox.classList.toggle("is-open", unlocked);
    }
    if (settingsForm) {
        settingsForm.hidden = !unlocked;
    }
    if (!unlocked) {
        state.settingsDirty = false;
    }
    const isEditingSettings = Boolean(
        unlocked &&
        state.settingsDirty &&
        settingsForm &&
        document.activeElement &&
        settingsForm.contains(document.activeElement)
    );
    if (unlocked && !isEditingSettings) {
        if (qs("settingsSiteName")) qs("settingsSiteName").value = state.siteSettings?.siteName || "";
        if (qs("settingsFreeKm")) qs("settingsFreeKm").value = String(state.siteSettings?.freeDeliveryKm ?? 0);
        if (qs("settingsPricePerKm")) qs("settingsPricePerKm").value = String(state.siteSettings?.deliveryPricePerKm ?? 0);
        if (qs("settingsMinutesPerKm")) qs("settingsMinutesPerKm").value = String(state.siteSettings?.deliveryMinutesPerKm ?? 1.5);
        if (qs("settingsMaxDeliveryKm")) qs("settingsMaxDeliveryKm").value = String(state.siteSettings?.maxDeliveryKm ?? 0);
        if (qs("settingsMaxItemQty")) qs("settingsMaxItemQty").value = String(state.siteSettings?.maxItemQuantity ?? 0);
        if (qs("settingsContactPhone")) qs("settingsContactPhone").value = state.siteSettings?.contactPhone || "";
        if (qs("settingsRestaurantName")) qs("settingsRestaurantName").value = state.siteSettings?.restaurantName || "";
        if (qs("settingsRestaurantAddress")) qs("settingsRestaurantAddress").value = state.siteSettings?.restaurantAddress || "";
        if (qs("settingsRestaurantLat")) qs("settingsRestaurantLat").value = String(state.siteSettings?.restaurantLat ?? 39.6594851);
        if (qs("settingsRestaurantLon")) qs("settingsRestaurantLon").value = String(state.siteSettings?.restaurantLon ?? 66.973074);
        if (qs("settingsAdminPassword")) qs("settingsAdminPassword").value = "";
        if (qs("settingsTelegramAdminPassword")) qs("settingsTelegramAdminPassword").value = "";
    }
}

function renderTelegramControl() {
    const statusText = qs("telegramStatusText");
    const enableBtn = qs("telegramEnableBtn");
    const disableBtn = qs("telegramDisableBtn");
    if (!statusText || !enableBtn || !disableBtn) return;

    const tg = state.telegram || {};
    enableBtn.classList.toggle("active", Boolean(tg.enabled));
    disableBtn.classList.toggle("active", !Boolean(tg.enabled));

    if (!tg.botConfigured) {
        statusText.textContent = "Holat: Bot token topilmadi (serverda sozlang)";
        enableBtn.disabled = true;
        disableBtn.disabled = true;
        return;
    }

    enableBtn.disabled = false;
    disableBtn.disabled = false;
    if (tg.enabled) {
        const courierTotal = Number(tg.courierTotal || 0);
        const courierConnectedCount = Number(tg.courierConnectedCount || 0);
        const courierText = courierTotal
            ? `Kuryerlar: ${courierConnectedCount}/${courierTotal}`
            : "Kuryer paroli yaratilmagan";
        if (tg.botConnected) {
            statusText.textContent = `Holat: Bot ulangan. Admin ulangan. ${courierText}`;
        } else {
            statusText.textContent = "Holat: Yoqilgan, /start va admin parol bilan kiring";
        }
    } else {
        statusText.textContent = "Holat: O'chirilgan, buyurtmalar faqat saytga tushadi";
    }
}

function renderSiteControl() {
    const startBtn = qs("siteStartBtn");
    const stopBtn = qs("siteStopBtn");
    const statusKpi = qs("kpiSiteStatus");
    const controlCard = qs("kpiCardSiteControl");
    const statusText = qs("siteStatusText");
    const reportSummary = qs("siteReportSummary");
    const site = normalizeSiteState(state.site);

    if (statusKpi) {
        statusKpi.textContent = site.orderingEnabled ? "Qabul ochiq" : "Qabul yopiq";
    }
    if (controlCard) {
        controlCard.classList.toggle("is-online", site.orderingEnabled);
        controlCard.classList.toggle("is-offline", !site.orderingEnabled);
    }

    if (startBtn) {
        startBtn.disabled = site.orderingEnabled;
    }
    if (stopBtn) {
        stopBtn.disabled = !site.orderingEnabled;
    }

    if (statusText) {
        statusText.classList.toggle("is-online", site.orderingEnabled);
        statusText.classList.toggle("is-offline", !site.orderingEnabled);
        statusText.textContent = site.orderingEnabled
            ? `Holat: sayt buyurtma qabul qilyapti. Sessiya ${formatDateTime(site.sessionStartedAt)} da boshlangan.`
            : `Holat: sayt buyurtma qabul qilmayapti. Sessiya ${formatDateTime(site.sessionStoppedAt || site.sessionStartedAt)} da to'xtagan.`;
    }

    if (reportSummary) {
        const report = site.orderingEnabled
            ? {
                totalOrders: Number(site.currentSessionStats?.totalOrders || 0),
                paidOrders: Number(site.currentSessionStats?.totalOrders || 0) - Number(site.currentSessionStats?.pendingOrders || 0),
                pendingOrders: Number(site.currentSessionStats?.pendingOrders || 0),
                revenue: Number(site.currentSessionStats?.revenue || 0),
                startedAt: site.sessionStartedAt,
                stoppedAt: ""
            }
            : (site.lastSessionReport || null);

        if (!report) {
            reportSummary.textContent = "Sessiya hisobotlari hali yo'q.";
        } else {
            reportSummary.innerHTML = `
                <div><b>Jami buyurtma:</b> ${Number(report.totalOrders || 0).toLocaleString()}</div>
                <div><b>Tasdiqlangan/pulli:</b> ${Number(report.paidOrders || 0).toLocaleString()}</div>
                <div><b>Kutilayotgan:</b> ${Number(report.pendingOrders || 0).toLocaleString()}</div>
                <div><b>Daromad:</b> ${formatMoney(report.revenue || 0)}</div>
                <div><b>Boshlangan:</b> ${escapeHtml(formatDateTime(report.startedAt || site.sessionStartedAt))}</div>
                <div><b>Tugagan:</b> ${escapeHtml(formatDateTime(report.stoppedAt || site.sessionStoppedAt || "-"))}</div>
            `;
        }
    }
}

function renderAll() {
    state.customerStats = buildCustomerStats();
    applyAdminBranding();
    renderFoodCategoryOptions();
    renderKpis();
    renderLatestOrdersTable();
    renderOrdersGrid();
    renderUsersTable();
    renderCategoryChart();
    renderSettings();
    renderSiteControl();
    renderTelegramControl();
    renderOrdersAlertBadge();
}

async function refreshAllData(silent = false) {
    state.lastFetchError = "";
    try {
        const [foods, orders, users, telegram, site, siteSettings] = await Promise.all([
            loadFoods(),
            loadOrders(),
            loadUsers(),
            loadTelegramSettings(),
            loadSiteState(),
            loadSiteSettings()
        ]);
        state.foods = foods;
        state.orders = orders;
        state.users = users;
        state.telegram = telegram;
        state.site = site;
        state.siteSettings = siteSettings;
    } catch (err) {
        state.lastFetchError = err.message || "Noma'lum xato";
        if (!silent) {
            alert(`Ma'lumotlarni yangilashda xato: ${state.lastFetchError}`);
        }
    }

    if (state.lastSeenOrderId === null) {
        state.lastSeenOrderId = getMaxOrderId(state.orders);
        saveSeenOrderIdToStorage(state.lastSeenOrderId);
    }

    state.lastSyncedAt = new Date();
    renderAll();
}

async function refreshOrdersOnly() {
    try {
        const site = await loadSiteState();
        state.site = site;
        if (site.orderingEnabled) {
            const orders = await loadOrders();
            state.orders = orders;
        }
        state.lastSyncedAt = new Date();
        renderAll();
    } catch (err) {
        // Silent polling: UI ni bezovta qilmaymiz.
    }
}

function startOrdersPolling() {
    if (state.pollingTimer) {
        clearInterval(state.pollingTimer);
    }
    state.pollingTimer = setInterval(() => {
        refreshOrdersOnly();
    }, 7000);
}

function decodeUrlParam(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        return decodeURIComponent(raw);
    } catch (err) {
        return raw;
    }
}

function isHttpImageUrl(value) {
    try {
        const parsed = new URL(String(value || "").trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (err) {
        return false;
    }
}

function normalizeImageInputUrl(rawValue) {
    const value = String(rawValue || "").trim();
    if (!isHttpImageUrl(value)) return value;

    try {
        const parsed = new URL(value);
        const host = String(parsed.hostname || "").toLowerCase();

        const directParams = ["imgurl", "image_url", "mediaurl"];
        for (const key of directParams) {
            const candidate = decodeUrlParam(parsed.searchParams.get(key));
            if (isHttpImageUrl(candidate)) return candidate;
        }

        const redirectHosts = (
            host.includes("google.") ||
            host.endsWith("t.me") ||
            host.includes("telegram.") ||
            host.includes("facebook.")
        );
        if (redirectHosts) {
            const redirected = decodeUrlParam(parsed.searchParams.get("url") || parsed.searchParams.get("u"));
            if (isHttpImageUrl(redirected)) return redirected;
        }

        return parsed.toString();
    } catch (err) {
        return value;
    }
}

async function importImageUrlToLocal(urlValue) {
    const url = String(urlValue || "").trim();
    if (!isHttpImageUrl(url)) return "";

    try {
        const payload = await fetchJson(`${ADMIN_API_URL}/upload-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });
        return String(payload?.url || "").trim();
    } catch (err) {
        return "";
    }
}

// Rasm oldindan ko'rish funksiyasi
function setupImagePreview(inputId, imgPreviewId) {
    const input = qs(inputId);
    const preview = qs(imgPreviewId);
    if (!input || !preview) return;

    let importingUrl = "";

    const updatePreview = () => {
        const raw = String(input.value || "").trim();
        if (!raw) {
            preview.src = "";
            preview.style.display = "none";
            return;
        }

        const normalized = normalizeImageInputUrl(raw);
        if (normalized !== raw) {
            input.value = normalized;
        }
        preview.src = normalized;
        preview.style.display = "block";
    };

    const importIfRemote = async () => {
        const raw = String(input.value || "").trim();
        if (!raw) return;

        const normalized = normalizeImageInputUrl(raw);
        if (normalized !== raw) {
            input.value = normalized;
        }
        if (!isHttpImageUrl(normalized) || importingUrl === normalized) return;

        importingUrl = normalized;
        const localUrl = await importImageUrlToLocal(normalized);
        if (localUrl && String(input.value || "").trim() === normalized) {
            input.value = localUrl;
            preview.src = localUrl;
            preview.style.display = "block";
        }
        importingUrl = "";
    };

    preview.onerror = () => {
        importIfRemote();
    };

    input.addEventListener("input", updatePreview);
    input.addEventListener("change", () => {
        updatePreview();
        importIfRemote();
    });
    input.addEventListener("blur", importIfRemote);
    input.addEventListener("drop", () => {
        setTimeout(() => {
            updatePreview();
            importIfRemote();
        }, 0);
    });
    input.addEventListener("paste", () => {
        setTimeout(() => {
            updatePreview();
            importIfRemote();
        }, 0);
    });

    updatePreview();
}

// Taom qo'shish formasi
async function addFoodToMenu(event) {
    if (event) event.preventDefault();
    const name = String(qs("foodName")?.value || "").trim();
    const price = Number(qs("foodPrice")?.value || 0);
    const img = String(qs("foodImg")?.value || "").trim() || "8.jpg"; // Default 8.jpg
    const prepMinutesRaw = Number(qs("foodPrepMinutes")?.value || 0);
    const prepMinutes = Number.isFinite(prepMinutesRaw) && prepMinutesRaw > 0
        ? Math.round(prepMinutesRaw)
        : null;
    const category = String(qs("foodCategory")?.value || "").trim();

    if (!name || !Number.isFinite(price) || price <= 0 || !category) {
        alert("Taom nomi, narxi va kategoriyani to'g'ri kiriting.");
        return;
    }

    try {
        const payload = { name, price, img, category };
        if (prepMinutes) payload.prepMinutes = prepMinutes;
        await fetchJson(`${ADMIN_API_URL}/foods`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        qs("foodName").value = "";
        qs("foodPrice").value = "";
        qs("foodImg").value = "";
        if (qs("foodImgPreview")) {
            qs("foodImgPreview").src = "";
            qs("foodImgPreview").style.display = "none";
        }
        if (qs("foodPrepMinutes")) qs("foodPrepMinutes").value = "";
        await refreshAllData();
        alert("Taom serverga saqlandi.");
    } catch (err) {
        alert(`Taom qo'shishda xato: ${err.message}`);
    }
}


async function addCategoryToCatalog() {
    const input = qs("newCategoryName");
    const category = normalizeCategoryName(input?.value || "");
    if (!category) {
        alert("Avval yangi kategoriya nomini kiriting.");
        return;
    }
    const hasConflict = (state.siteSettings?.categories || []).some((c) => isSameCategoryName(c, category));
    if (hasConflict) {
        alert("Bu kategoriya allaqachon mavjud.");
        return;
    }
    const nextCategories = uniqueStrings([
        ...(state.siteSettings?.categories || []),
        category
    ]);
    try {
        await saveSiteSettings({
            ...state.siteSettings,
            categories: nextCategories
        });
        if (input) input.value = "";
        alert("Kategoriya saqlandi.");
    } catch (err) {
        alert(`Kategoriya saqlashda xato: ${err.message}`);
    }
}

async function saveSiteSettingsForm(event) {
    if (event) event.preventDefault();
    if (!ensureSettingsAccess()) return;

    const siteNameInput = String(qs("settingsSiteName")?.value || "").trim();
    const freeDeliveryKm = Number(qs("settingsFreeKm")?.value || 0);
    const deliveryPricePerKm = Number(qs("settingsPricePerKm")?.value || 0);
    const deliveryMinutesPerKm = Number(String(qs("settingsMinutesPerKm")?.value || "").replace(",", "."));
    const maxDeliveryKm = Number(qs("settingsMaxDeliveryKm")?.value || 0);
    const maxItemQuantity = Number(qs("settingsMaxItemQty")?.value || 0);
    const contactPhone = String(qs("settingsContactPhone")?.value || "").trim();
    const restaurantNameInput = String(qs("settingsRestaurantName")?.value || "").trim();
    const restaurantAddress = String(qs("settingsRestaurantAddress")?.value || "").trim();
    const restaurantLat = Number(String(qs("settingsRestaurantLat")?.value || "").replace(",", "."));
    const restaurantLon = Number(String(qs("settingsRestaurantLon")?.value || "").replace(",", "."));
    const adminPanelPassword = String(qs("settingsAdminPassword")?.value || "").trim();
    const telegramAdminPassword = String(qs("settingsTelegramAdminPassword")?.value || "").trim();
    const revenueResetRaw = String(qs("settingsRevenueReset")?.value || "").trim();

    let siteName = siteNameInput;
    let restaurantName = restaurantNameInput;
    const previousSiteName = String(state.siteSettings?.siteName || "").trim();
    const previousRestaurantName = String(state.siteSettings?.restaurantName || "").trim();
    if (siteName && siteName !== previousSiteName && restaurantName === previousRestaurantName) {
        restaurantName = siteName;
    }
    if (restaurantName && restaurantName !== previousRestaurantName && siteName === previousSiteName) {
        siteName = restaurantName;
    }
    if (siteName !== siteNameInput && qs("settingsSiteName")) {
        qs("settingsSiteName").value = siteName;
    }
    if (restaurantName !== restaurantNameInput && qs("settingsRestaurantName")) {
        qs("settingsRestaurantName").value = restaurantName;
    }

    if (!siteName) {
        alert("Joy nomini kiriting.");
        return;
    }
    if (!Number.isFinite(freeDeliveryKm) || freeDeliveryKm < 0) {
        alert("Tekin km noto'g'ri.");
        return;
    }
    if (!Number.isFinite(deliveryPricePerKm) || deliveryPricePerKm < 0) {
        alert("1 km narxi noto'g'ri.");
        return;
    }
    if (!Number.isFinite(deliveryMinutesPerKm) || deliveryMinutesPerKm <= 0) {
        alert("1 km vaqt noto'g'ri.");
        return;
    }
    if (!Number.isFinite(maxDeliveryKm) || maxDeliveryKm < 0) {
        alert("Maksimal masofa noto'g'ri.");
        return;
    }
    if (!Number.isFinite(maxItemQuantity) || maxItemQuantity < 0) {
        alert("Bitta taom maksimal soni noto'g'ri.");
        return;
    }
    if (!restaurantName) {
        alert("Restoran nomini kiriting.");
        return;
    }
    if (!restaurantAddress) {
        alert("Restoran manzilini kiriting.");
        return;
    }
    if (!Number.isFinite(restaurantLat) || restaurantLat < -90 || restaurantLat > 90) {
        alert("Restoran kenglik (lat) noto'g'ri.");
        return;
    }
    if (!Number.isFinite(restaurantLon) || restaurantLon < -180 || restaurantLon > 180) {
        alert("Restoran uzunlik (lon) noto'g'ri.");
        return;
    }
    if (revenueResetRaw && Number(revenueResetRaw) !== 0) {
        alert("Daromad maydoniga faqat 0 kiriting.");
        return;
    }

    try {
        const payload = {
            ...state.siteSettings,
            siteName,
            freeDeliveryKm,
            deliveryPricePerKm,
            deliveryMinutesPerKm,
            maxDeliveryKm,
            maxItemQuantity,
            contactPhone,
            restaurantName,
            restaurantAddress,
            restaurantLat,
            restaurantLon,
            categories: state.siteSettings?.categories || []
        };
        if (adminPanelPassword) {
            payload.adminPanelPassword = adminPanelPassword;
        }
        await saveSiteSettings(payload);
    } catch (err) {
        alert(`Sozlamalarni saqlashda xato: ${err.message}`);
        return;
    }

    if (telegramAdminPassword) {
        try {
            await saveTelegramAdminPassword(telegramAdminPassword);
        } catch (err) {
            showAdminNotice(`Telegram admin parolini saqlashda xato: ${err.message}`, "danger");
        }
    }
    if (qs("settingsAdminPassword")) qs("settingsAdminPassword").value = "";
    if (qs("settingsTelegramAdminPassword")) qs("settingsTelegramAdminPassword").value = "";
    state.settingsDirty = false;
    if (revenueResetRaw && Number(revenueResetRaw) === 0) {
        await resetTotalRevenue();
        if (qs("settingsRevenueReset")) qs("settingsRevenueReset").value = "";
        showAdminNotice("Jami daromad 0 dan qayta boshlandi.", "success");
    } else {
        showAdminNotice("Sozlamalar saqlandi.", "success");
    }
    renderAll();
}

function searchFoodForEdit() {
    const q = String(qs("adminSearchInput")?.value || "").trim().toLowerCase();
    const resultBox = qs("searchResult");
    const editForm = qs("editFields");
    const editImgInput = qs("editImg");
    const editImgPreview = qs("editImgPreview");

    if (!q) {
        if (resultBox) resultBox.textContent = "Qidirish uchun taom nomini yozing.";
        if (editForm) editForm.style.display = "none";
        state.editingFoodId = null;
        if (editImgInput) editImgInput.value = "";
        if (editImgPreview) {
            editImgPreview.src = "";
            editImgPreview.style.display = "none";
        }
        return;
    }

    const food = state.foods.find((f) => String(f.name || "").toLowerCase().includes(q));
    if (!food) {
        if (resultBox) resultBox.textContent = "Topilmadi.";
        if (editForm) editForm.style.display = "none";
        state.editingFoodId = null;
        if (editImgInput) editImgInput.value = "";
        if (editImgPreview) {
            editImgPreview.src = "";
            editImgPreview.style.display = "none";
        }
        return;
    }

    state.editingFoodId = food.id;
    qs("editName").value = food.name || "";
    qs("editPrice").value = Number(food.price || 0);
    if (editImgInput) editImgInput.value = food.img || "";
    if (editImgPreview) {
        editImgPreview.src = food.img || "";
        editImgPreview.style.display = food.img ? "block" : "none";
    }
    if (qs("editPrepMinutes")) qs("editPrepMinutes").value = String(Math.max(1, Number(food.prepMinutes || 15)));
    qs("editStatus").value = food.status || "active";
    if (editForm) editForm.style.display = "grid";
    if (resultBox) resultBox.textContent = `Topildi: ${food.name}`;
}

async function saveEditedFood() {
    if (!state.editingFoodId) {
        alert("Avval taomni qidiring.");
        return;
    }

    const status = String(qs("editStatus")?.value || "active");
    const name = String(qs("editName")?.value || "").trim();
    const price = Number(qs("editPrice")?.value || 0);
    const img = String(qs("editImg")?.value || "").trim();
    const prepMinutesRaw = Number(qs("editPrepMinutes")?.value || 0);
    const prepMinutes = Number.isFinite(prepMinutesRaw) && prepMinutesRaw > 0
        ? Math.round(prepMinutesRaw)
        : null;

    try {
        if (status === "delete") {
            await fetchJson(`${ADMIN_API_URL}/foods/${state.editingFoodId}`, { method: "DELETE" });
            alert("Taom o'chirildi.");
        } else {
            const payload = { name, price, img, status };
            if (prepMinutes) payload.prepMinutes = prepMinutes;
            await fetchJson(`${ADMIN_API_URL}/foods/${state.editingFoodId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            alert("Taom yangilandi.");
        }

        state.editingFoodId = null;
        if (qs("editFields")) qs("editFields").style.display = "none";
        if (qs("searchResult")) qs("searchResult").textContent = "";
        if (qs("adminSearchInput")) qs("adminSearchInput").value = "";
        // Clear image input and preview after save
        if (qs("editImg")) qs("editImg").value = "";
        if (qs("editImgPreview")) {
            qs("editImgPreview").src = "";
            qs("editImgPreview").style.display = "none";
        }
        await refreshAllData();
    } catch (err) {
        alert(`Saqlashda xato: ${err.message}`);
    }
}

async function createManualOrder(event) {
    if (event) event.preventDefault();

    const customer = String(qs("newOrderCustomer")?.value || "").trim();
    const phone = String(qs("newOrderPhone")?.value || "").trim();
    const address = String(qs("newOrderAddress")?.value || "").trim();
    const delivery = Number(qs("newOrderDelivery")?.value || 0);
    const total = Number(qs("newOrderTotal")?.value || 0);
    const status = normalizeStatus(qs("newOrderStatus")?.value || "yangi");

    if (!phone || !address || !Number.isFinite(total) || total <= 0 || !Number.isFinite(delivery) || delivery < 0) {
        alert("Buyurtma maydonlarini to'g'ri kiriting.");
        return;
    }

    const payload = {
        date: formatNowForOrder(),
        phone,
        address,
        items: {},
        distanceKm: 0,
        durationMin: 0,
        delivery,
        total,
        userId: "admin",
        email: customer || "admin@local",
        paymentMethod: "cash",
        paymentProvider: "cash",
        paymentStatus: "cash",
        status
    };

    try {
        await fetchJson(`${ADMIN_API_URL}/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (qs("newOrderForm")) qs("newOrderForm").reset();
        await refreshAllData();
        openSection("ordersSection");
        alert("Buyurtma qo'shildi.");
    } catch (err) {
        alert(`Buyurtma qo'shishda xato: ${err.message}`);
    }
}

async function updateOrderStatus(orderId, nextStatus) {
    const normalized = normalizeStatus(nextStatus);
    const current = state.orders.find((o) => String(o?.id) === String(orderId));
    if (current) {
        const currentStatus = normalizeStatus(current.status);
        if (!canTransitionStatus(currentStatus, normalized)) {
            alert("Bu buyurtma holatida ushbu amalga ruxsat yo'q.");
            return;
        }
    }
    try {
        const updated = await fetchJson(`${ADMIN_API_URL}/orders/${orderId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: normalized })
        });
        const idx = state.orders.findIndex((o) => String(o.id) === String(orderId));
        if (idx >= 0) {
            state.orders[idx] = { ...state.orders[idx], ...updated, status: normalizeStatus(updated.status) };
        }
        renderAll();
    } catch (err) {
        alert(`Status yangilashda xato: ${err.message}`);
    }
}

function exposeLegacyNames() {
    window.toggleSection = openSection;
    window.addFoodToMenu = addFoodToMenu;
    window.searchFoodForEdit = searchFoodForEdit;
    window.saveEditedFood = saveEditedFood;
}

let adminPanelInitialized = false;

async function initAdminPanel() {
    if (adminPanelInitialized) return;
    adminPanelInitialized = true;

    console.log("Admin panel ishga tushirilmoqda...");

    // Barcha DOMContentLoaded logikasini shu yerga ko'chiramiz
    try {
        exposeLegacyNames();
        state.lastSeenOrderId = loadSeenOrderIdFromStorage();
        state.settingsAccess = loadSettingsAccessFromStorage();
        bindNavigation();
        bindForms();
        bindKpiActions();
        bindSiteControls();
        bindTelegramControls();
        bindTelegramModal();
        bindCourierModal();
        bindCourierManageModal();
        bindOrderActionDelegation();
        setupImagePreview('foodImg', 'foodImgPreview');
        setupImagePreview('editImg', 'editImgPreview');

        // Rasm yuklash (Upload) logikasi
        const fileInput = document.getElementById('foodImgFile');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (EMBED_LOCAL_ADMIN_MODE) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const dataUrl = typeof reader.result === "string" ? reader.result : "";
                        if (!dataUrl) {
                            alert("Rasmni o'qib bo'lmadi.");
                            return;
                        }
                        const target = document.getElementById('foodImg');
                        if (!target) return;
                        target.value = dataUrl;
                        target.dispatchEvent(new Event('input'));
                    };
                    reader.onerror = () => {
                        alert("Rasmni yuklashda xato yuz berdi.");
                    };
                    reader.readAsDataURL(file);
                    return;
                }

                const formData = new FormData();
                formData.append('image', file);

                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    const data = await res.json();
                    if (data.url) {
                        document.getElementById('foodImg').value = data.url;
                        document.getElementById('foodImg').dispatchEvent(new Event('input')); // Preview yangilash
                    }
                } catch (err) {
                    alert("Rasm yuklashda xato: " + err.message);
                }
            });
        }

        // Chiqish tugmasini panelni yopishga sozlash
        const goHomeBtn = document.getElementById('goHomeBtn');
        if (goHomeBtn) {
            goHomeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.closeAdminPanel) {
                    window.closeAdminPanel();
                } else {
                    window.location.href = "/";
                }
            });
        }

        openSection("dashboardSection");
        await loadAdminUserChip();
        await refreshAllData();
        startOrdersPolling();
    } catch (err) {
        console.error("Admin panelni ishga tushirishda xato:", err);
        alert("Admin panelni ishga tushirishda xatolik yuz berdi. Konsolni tekshiring.");
    }
}

window.initAdminPanel = initAdminPanel;
