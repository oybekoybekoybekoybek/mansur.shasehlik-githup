// --- 1. GLOBAL O'ZGARUVCHILAR ---
let allFoods = [];
let orders = [];
let cart = {};
let activeCategory = "";
let editingIndex = null;
let editingFoodId = null;
let currentUser = null;

// SERVER API URL
const LOCAL_API_FALLBACK = 'http://localhost:3000';
const API_BASE_URL = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null')
    ? LOCAL_API_FALLBACK
    : window.location.origin;
const API_URL = `${API_BASE_URL}/api`;
const GMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;

// Restoran manzili (Yandex xaritadagi manzil)
let RESTAURANT_NAME = "Mansur Shashlik";
let RESTAURANT_ADDRESS = "Самарканд, ул. Имома Ал-Бухорий, 185";
// Nominatim bu manzilda uy raqamini doim topa olmagani uchun ko'cha markazidan fallback.
// Imam Al-Buxoriy 185 — OSM way 380426752 (Zarafshon prospektiga yaqin)
const DEFAULT_RESTAURANT_COORDS = {lat: 39.6594851, lon: 66.9730740};
let RESTAURANT_COORDS = { ...DEFAULT_RESTAURANT_COORDS };
const DELIVERY_PRICE_PER_KM = 2000;
const DEFAULT_PREP_MINUTES = 15;
const CARD_PAYMENTS_ENABLED = false;

// Sayt sozlamalari (default qiymatlar)
let siteSettings = {
    siteName: "Mansur Shashlik",
    freeDeliveryKm: 1,
    deliveryPricePerKm: 2000,
    deliveryMinutesPerKm: 1.5,
    maxDeliveryKm: 0,
    maxItemQuantity: 0,
    contactPhone: "",
    restaurantName: RESTAURANT_NAME,
    restaurantAddress: RESTAURANT_ADDRESS,
    restaurantLat: DEFAULT_RESTAURANT_COORDS.lat,
    restaurantLon: DEFAULT_RESTAURANT_COORDS.lon,
    categories: []
};

let userCoords = null;
let userAddress = "";
let locationWatchId = null;
let locationRefreshPromptTimer = null;
const LOCATION_REFRESH_PROMPT_DELAY_MS = 1 * 60 * 1000;
const SITE_STATE_POLL_INTERVAL_MS = 10000;
let publicSiteState = { orderingEnabled: true };
let siteStatePollTimer = null;
let bestGpsAccuracy = Infinity;
const MIN_TRUSTED_ACCURACY_METERS = 80;
const MAX_ACCEPTABLE_ACCURACY_METERS = 400;
let lastResolvedAddress = "";
let lastResolvedCoordKey = "";
let lastAddressResolveAt = 0;
let isLocationResolved = false;
let isLocationResolving = false;
let locationResolvePromise = null;
let resolveLocationPromise = null;
let currentDeliveryPrice = 0;
let currentDistanceKm = 0;
let currentDurationMin = 0;
let currentDurationText = "";
let isRestaurantCoordsResolved = false;
let selectedPaymentMethod = null;
let selectedDeliveryType = "home";
let currentDeliveryDistanceLabel = "";
let currentDeliveryDurationLabel = "";
const DELIVERY_ROUTE_CACHE_LIMIT = 40;
const deliveryRouteInfoCache = new Map();
const deliveryRouteInfoInFlight = new Map();
const STRAIGHT_LINE_ONLY_UNDER_KM = 1;

const CATEGORY_ICON_RULES = [
    { pattern: /shash/i, icon: "fas fa-fire" },
    { pattern: /salat/i, icon: "fas fa-leaf" },
    { pattern: /ichimlik|drink|cola|fanta|suv|choy|pepsi|mojito|limonad/i, icon: "fas fa-glass-water" },
    { pattern: /garnir|kartoshka|fri|guruch|rice/i, icon: "fas fa-bowl-food" },
    { pattern: /non|bread|patir|lavash/i, icon: "fas fa-bread-slice" },
    { pattern: /farsh|go'sht|gosht|meat|mol/i, icon: "fas fa-drumstick-bite" },
    { pattern: /shirin|dessert|cake|tort/i, icon: "fas fa-cookie-bite" }
];

function normalizeTextValue(value) {
    return String(value ?? "").trim();
}

function normalizePublicSiteState(value) {
    return {
        orderingEnabled: value?.orderingEnabled !== false
    };
}

function isOrderingEnabled() {
    return publicSiteState?.orderingEnabled !== false;
}

function getOrderingBlockedMessage() {
    return "Buyurtma olish vaqtincha ishlamayapti.";
}

function applyPublicSiteStateUi() {
    const locked = !isOrderingEnabled();
    const body = document.body;
    if (body) {
        body.classList.toggle("ordering-locked", locked);
    }

    const notice = document.getElementById("siteOrderNotice");
    if (notice) {
        if (locked) {
            notice.hidden = false;
            notice.innerHTML = `
                <strong>Buyurtma olish vaqtincha ishlamayapti</strong>
                <span>Iltimos, birozdan keyin qayta urinib ko'ring.</span>
            `;
        } else {
            notice.hidden = true;
            notice.innerHTML = "";
        }
    }
}

async function refreshPublicSiteState(options = {}) {
    try {
        const response = await fetch(`${API_URL}/site-state`);
        if (!response.ok) return;
        const payload = await response.json();
        const previous = isOrderingEnabled();
        publicSiteState = normalizePublicSiteState(payload);
        applyPublicSiteStateUi();
        const changed = previous !== isOrderingEnabled();
        if (changed && options?.rerender !== false) {
            renderFoods(activeCategory);
            renderCart();
            updateCartUI();
        }
    } catch (error) {
        // Sayt state poll xatolari UI ni to'xtatmasin
    }
}

function startPublicSiteStatePolling() {
    if (siteStatePollTimer) {
        clearInterval(siteStatePollTimer);
    }
    siteStatePollTimer = setInterval(() => {
        refreshPublicSiteState();
        loadSiteSettings();
    }, SITE_STATE_POLL_INTERVAL_MS);
}

function getCategoryKey(value) {
    return normalizeTextValue(value).toLowerCase();
}

function uniqueValuesByKey(values) {
    const seen = new Set();
    const result = [];

    (Array.isArray(values) ? values : []).forEach((value) => {
        const normalized = normalizeTextValue(value);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
    });

    return result;
}

function isSameCategory(a, b) {
    return getCategoryKey(a) !== "" && getCategoryKey(a) === getCategoryKey(b);
}

function normalizeFoodImage(img) {
    const value = normalizeTextValue(img);
    return value && !value.startsWith("blob:") ? value : "8.jpg";
}

function normalizeMenuFoods(rawFoods) {
    if (!Array.isArray(rawFoods)) return [];

    return rawFoods
        .filter(Boolean)
        .map((food) => {
            const price = Number(food?.price || 0);
            const prepMinutes = Number(food?.prepMinutes || 0);
            return {
                ...food,
                id: food?.id,
                name: normalizeTextValue(food?.name),
                price,
                img: normalizeFoodImage(food?.img),
                category: normalizeTextValue(food?.category),
                prepMinutes: Number.isFinite(prepMinutes) && prepMinutes > 0 ? Math.round(prepMinutes) : null,
                status: normalizeTextValue(food?.status) || "active"
            };
        })
        .filter((food) => food.name && food.category && Number.isFinite(food.price) && food.price > 0);
}

function getFoodPrepMinutesByName(name) {
    const key = normalizeTextValue(name).toLowerCase();
    if (!key) return DEFAULT_PREP_MINUTES;
    const food = allFoods.find((item) => normalizeTextValue(item?.name).toLowerCase() === key);
    const prep = Number(food?.prepMinutes || 0);
    return Number.isFinite(prep) && prep > 0 ? Math.round(prep) : DEFAULT_PREP_MINUTES;
}

function getCartPrepMinutes() {
    const keys = Object.keys(cart || {});
    if (!keys.length) return 0;
    let maxPrep = 0;
    keys.forEach((name) => {
        const prep = getFoodPrepMinutesByName(name);
        if (prep > maxPrep) maxPrep = prep;
    });
    return maxPrep > 0 ? maxPrep : DEFAULT_PREP_MINUTES;
}

function formatDurationHuman(minutes) {
    const total = Math.max(1, Math.round(Number(minutes || 0)));
    if (!Number.isFinite(total) || total <= 0) return "0 min";
    if (total < 60) return `${total} min`;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return mins > 0 ? `${hours} soat ${mins} min` : `${hours} soat`;
}

function formatDistanceLabel(distanceKm) {
    const km = Number(distanceKm || 0);
    if (!Number.isFinite(km) || km <= 0) return "0 km";
    if (km < 1) {
        const meters = Math.round(km * 1000);
        return `${Math.max(1, meters)} m`;
    }
    return `${km.toFixed(1)} km`;
}

function getAvailableCategories() {
    return uniqueValuesByKey(siteSettings?.categories);
}

function getFoodsByCategory(category) {
    return allFoods.filter((food) => isSameCategory(food?.category, category));
}

function getResolvedActiveCategory(preferredCategory = activeCategory) {
    const categories = getAvailableCategories();
    if (!categories.length) return "";

    const matchedCategory = categories.find((category) => isSameCategory(category, preferredCategory));
    if (matchedCategory) return matchedCategory;

    const firstWithFoods = categories.find((category) => getFoodsByCategory(category).length > 0);
    return firstWithFoods || categories[0];
}

function getCategoryIconClass(category) {
    const normalized = normalizeTextValue(category);
    const matched = CATEGORY_ICON_RULES.find((rule) => rule.pattern.test(normalized));
    return matched?.icon || "fas fa-utensils";
}

function syncActiveCategoryButton(shouldScroll = false) {
    const categoryScroll = document.getElementById("categoryScroll");
    if (!categoryScroll) return;

    let activeItem = null;
    categoryScroll.querySelectorAll(".category-item").forEach((item) => {
        const isActive = isSameCategory(item.dataset.category, activeCategory);
        item.classList.toggle("active", isActive);
        if (isActive) activeItem = item;
    });

    if (shouldScroll && activeItem) {
        activeItem.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
}

function renderCategories(preferredCategory = activeCategory) {
    const wrapper = document.querySelector(".category-wrapper");
    const categoryScroll = document.getElementById("categoryScroll");
    if (!categoryScroll) return;

    const categories = getAvailableCategories();
    activeCategory = getResolvedActiveCategory(preferredCategory);
    categoryScroll.innerHTML = "";

    if (!categories.length) {
        wrapper?.classList.remove("is-ready");
        categoryScroll.innerHTML = '<div class="category-empty-state">Hozircha kategoriya yo\'q</div>';
        activeCategory = "";
        return;
    }

    wrapper?.classList.add("is-ready");

    categories.forEach((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-item";
        button.dataset.category = category;
        button.innerHTML = `
            <span>${escapeHtml(category)}</span>
        `;
        categoryScroll.appendChild(button);
    });

    syncActiveCategoryButton(false);
}

function handleCategoryScrollClick(event) {
    const targetItem = event.target.closest("#categoryScroll .category-item");
    if (!targetItem) return;

    const nextCategory = normalizeTextValue(targetItem.dataset.category);
    if (!nextCategory) return;

    activeCategory = nextCategory;
    targetItem.classList.remove("is-popping");
    void targetItem.offsetWidth;
    targetItem.classList.add("is-popping");
    syncActiveCategoryButton(true);
    renderFoods(activeCategory);
}

function isElementVisible(element) {
    return Boolean(element && getComputedStyle(element).display !== "none");
}

function syncPageChromeState() {
    const body = document.body;
    if (!body) return;

    body.classList.toggle("cart-open", Boolean(document.getElementById("cartPanel")?.classList.contains("active")));
    body.classList.toggle("menu-open", Boolean(document.getElementById("menuPanel")?.classList.contains("active")));
    body.classList.toggle("order-modal-open", isElementVisible(document.getElementById("orderModal")));
    body.classList.toggle("auth-locked", isElementVisible(document.getElementById("authModal")));
    body.classList.toggle("bottom-panel-visible", Boolean(document.getElementById("bottomCartPanel")?.classList.contains("is-visible")));
}

function setOverlayDisplay(elementId, isVisible, displayValue = "block") {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.style.display = isVisible ? displayValue : "none";
    syncPageChromeState();
}

function openAuthModal() {
    setOverlayDisplay("authModal", true, "flex");
}

const UZ_PHONE_PREFIX = "+998 ";
const CLICK_RECEIVER_CARD = "4073420072137304";

// --- STORAGE HELPERS (USER-ISOLATED) ---
function sanitizeKeyPart(str) {
    return String(str || "guest").replace(/[^a-zA-Z0-9_-]/g, "");
}

function storageKey(base) {
    const part = currentUser?.id || "guest";
    return `${base}_${sanitizeKeyPart(part)}`;
}

function loadCart() {
    try { return JSON.parse(localStorage.getItem(storageKey("cart")) || "{}"); }
    catch (e) { return {}; }
}

function saveCart() {
    localStorage.setItem(storageKey("cart"), JSON.stringify(cart));
}

function loadOrders() {
    try { return JSON.parse(localStorage.getItem(storageKey("allOrders")) || "[]"); }
    catch (e) { return []; }
}

function saveOrders() {
    localStorage.setItem(storageKey("allOrders"), JSON.stringify(orders));
}


function setCurrentUser(user) {
    currentUser = user || null;
    if (currentUser?.email) {
        localStorage.setItem("preferredGmail", currentUser.email);
    }
    cart = loadCart();
    orders = loadOrders();
    updateUserUI(currentUser);
}

function fillSavedGmail() {
    const gmailInput = document.getElementById("gmailInput");
    if (!gmailInput) return;
    const savedGmail = localStorage.getItem("preferredGmail");
    if (savedGmail && !gmailInput.value) {
        gmailInput.value = savedGmail;
    }
}

function formatMoney(amount) {
    return `${Number(amount || 0).toLocaleString()} so'm`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getSiteBrandName() {
    return normalizeTextValue(siteSettings?.siteName || siteSettings?.restaurantName || RESTAURANT_NAME || "Mansur Shashlik");
}

function formatBrandMultilineHtml(name) {
    const raw = normalizeTextValue(name);
    if (!raw) return "";
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return escapeHtml(raw);
    return `${escapeHtml(words[0])}<br>${escapeHtml(words.slice(1).join(" "))}`;
}

function applySiteBrand() {
    const brandName = getSiteBrandName();
    if (!brandName) return;

    document.title = brandName;

    const center = document.getElementById("siteBrandCenter");
    if (center) center.innerHTML = formatBrandMultilineHtml(brandName);

    const menu = document.getElementById("siteBrandMenu");
    if (menu) menu.innerHTML = formatBrandMultilineHtml(brandName);

    const auth = document.getElementById("siteBrandAuth");
    if (auth) auth.textContent = brandName;
}

function decodeDataKey(value) {
    try {
        return decodeURIComponent(value || "");
    } catch (e) {
        return value || "";
    }
}

function getFoodImageByName(name) {
    const food = allFoods.find(item => item.name === name);
    return food?.img || "8.jpg";
}

function animateQtyButton(button) {
    if (!button) return;
    button.classList.remove("is-bumping");
    // Reflow to replay animation for consecutive clicks.
    void button.offsetWidth;
    button.classList.add("is-bumping");
}

function formatUzbekPhoneInput(rawValue) {
    const digits = String(rawValue || "").replace(/\D/g, "");
    const localDigits = digits.startsWith("998") ? digits.slice(3, 12) : digits.slice(0, 9);
    const groups = [
        localDigits.slice(0, 2),
        localDigits.slice(2, 5),
        localDigits.slice(5, 7),
        localDigits.slice(7, 9)
    ].filter(Boolean);

    return {
        localDigits,
        formatted: groups.length ? `${UZ_PHONE_PREFIX}${groups.join(" ")}` : UZ_PHONE_PREFIX,
        formattedLocal: groups.join(" ")
    };
}

function getPhoneLocalDigits() {
    const phoneInput = document.getElementById("phoneInput");
    if (!phoneInput) return "";
    return formatUzbekPhoneInput(phoneInput.value).localDigits;
}

function refreshSubmitOrderButton() {
    const submitOrderBtn = document.getElementById("submitOrderBtn");
    if (submitOrderBtn) {
        submitOrderBtn.disabled = !isOrderFormValid();
    }
}

function setupPhoneInputMask() {
    const phoneInput = document.getElementById("phoneInput");
    if (!phoneInput) return;

    const savedPhone = localStorage.getItem("userPhone");
    if (savedPhone) {
        const savedDigits = String(savedPhone).replace(/\D/g, "").replace(/^998/, "").slice(0, 9);
        if (savedDigits) {
            phoneInput.value = formatUzbekPhoneInput(savedDigits).formattedLocal;
        }
    }

    const applyMask = () => {
        const { formattedLocal } = formatUzbekPhoneInput(phoneInput.value);
        phoneInput.value = formattedLocal;
        refreshSubmitOrderButton();
    };

    phoneInput.addEventListener("input", applyMask);
    phoneInput.addEventListener("blur", applyMask);
    refreshSubmitOrderButton();
}


// --- 2. SAHIFA YUKLANGANDA ---
document.addEventListener("DOMContentLoaded", async () => {
    fillSavedGmail();
    await checkUserSession();
    syncPageChromeState();
    await loadFoodsFromServer();
    await loadSiteSettings();
    await refreshPublicSiteState({ rerender: false });
    await resolveRestaurantCoords();
    
    renderCategories(activeCategory);
    renderFoods(activeCategory);
    renderCart();
    await updateCartUI();
    initLocation({ forceFresh: true });

    // Kategoriyalarni boshqarish (event delegation)
    const categoryScroll = document.getElementById("categoryScroll");
    if (categoryScroll) {
        categoryScroll.addEventListener("click", handleCategoryScrollClick);
    }

    // Savat tugmalari
    const cartBtn = document.querySelector(".cart-box");
    const cartOverlay = document.getElementById("cartOverlay");
    const closeBtn = document.getElementById("closeCart");
    const cartItems = document.getElementById("cartItems");
    const confirmOrderBtn = document.getElementById("confirmOrderBtn");
    const checkoutBtn = document.getElementById("nextBtn");

    if (cartBtn) cartBtn.onclick = openCart;
    if (cartOverlay) cartOverlay.onclick = closeCartFn;
    if (closeBtn) closeBtn.onclick = closeCartFn;
    if (cartItems) cartItems.addEventListener("click", handleCartItemsClick);
    if (confirmOrderBtn) confirmOrderBtn.onclick = proceedFromCart;
    if (checkoutBtn) checkoutBtn.onclick = proceedToNext;

    // Oziq-ovqat paneli uchun event listener (EVENT DELEGATION)
    const foodDisplay = document.getElementById("foodDisplay");
    if (foodDisplay) {
        foodDisplay.addEventListener("click", handleFoodDisplayClick);
    }

    // Yetkazib berish usuli tugmalari
    document.querySelectorAll(".delivery-option").forEach(option => {
        option.addEventListener("click", () => {
            setDeliveryType(option.dataset.delivery || "home");
        });
    });
    syncDeliveryOptionState();

    // Menyu tugmalari
    const menuBtn = document.getElementById("menuBtn");
    const menuOverlay = document.getElementById("menuOverlay");

    if (menuBtn) menuBtn.onclick = openMenu;
    if (menuOverlay) menuOverlay.onclick = closeMenuFn;

    const gmailInput = document.getElementById("gmailInput");
    if (gmailInput) {
        gmailInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitManualGmail();
            }
        });
    }

    const orderModal = document.getElementById("orderModal");
    if (orderModal) {
        orderModal.addEventListener("click", (event) => {
            if (event.target === orderModal) {
                closeOrderModal();
            }
        });
    }

    const adminEmbedOverlay = document.getElementById("adminEmbedOverlay");
    if (adminEmbedOverlay) {
        adminEmbedOverlay.addEventListener("click", (event) => {
            if (event.target === adminEmbedOverlay) {
                closeAdminPanel();
            }
        });
    }

    setupPhoneInputMask();
    const submitOrderBtn = document.getElementById("submitOrderBtn");
    if (submitOrderBtn) {
        submitOrderBtn.addEventListener("click", submitOrder);
    }

    const clickCardNumber = document.getElementById("clickCardNumber");
    if (clickCardNumber) {
        clickCardNumber.textContent = CLICK_RECEIVER_CARD.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
    }

    const copyCardBtn = document.getElementById("copyCardBtn");
    if (copyCardBtn) {
        copyCardBtn.addEventListener("click", copyClickCardNumber);
    }

    // Jonli buyurtma kuzatuvi
    document.addEventListener("click", handleLiveOrderPanelClick);
    renderLiveOrderTracker();
    ensureLiveOrderTimers();
    syncCustomerOrdersFromServer({ silent: true });
    startPublicSiteStatePolling();
    syncPageChromeState();
});

// Serverdan faollarni yuklash
async function loadFoodsFromServer() {
    try {
        const response = await fetch(`${API_URL}/foods`);
        if (response.ok) {
            const payload = await response.json();
            allFoods = normalizeMenuFoods(payload);
            console.log('вњ… Faollar serverdan yuklandi:', allFoods.length);
        } else {
            console.error('вќЊ Server xatosi:', response.status);
            // Fallback: localStorage dan yuklash
            const localFoods = JSON.parse(localStorage.getItem("menuItems")) || [];
            allFoods = normalizeMenuFoods(localFoods);
        }
    } catch (err) {
        console.error('вќЊ Serverga ulanib bo\'lalmadi:', err.message);
        console.log('рџ’ѕ Lokalni ma\'lumotlar ishlatilmoqda...');
        const localFoods = JSON.parse(localStorage.getItem("menuItems")) || [];
        allFoods = normalizeMenuFoods(localFoods);
    }
}

// --- 3. MASOFANI HISOBLASH (1 KM = 2000 SO'M) ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildRouteCacheKey(fromLat, fromLon, toLat, toLon) {
    return `${buildCoordKey(fromLat, fromLon)}|${buildCoordKey(toLat, toLon)}`;
}

function setCachedRouteInfo(cacheKey, routeInfo) {
    deliveryRouteInfoCache.set(cacheKey, routeInfo);
    if (deliveryRouteInfoCache.size > DELIVERY_ROUTE_CACHE_LIMIT) {
        const oldestKey = deliveryRouteInfoCache.keys().next().value;
        if (oldestKey) deliveryRouteInfoCache.delete(oldestKey);
    }
}

function normalizeBackendRouteInfo(payload) {
    if (!payload || payload.success === false) return null;

    const distanceKm = Number(payload.distanceKm ?? payload.distance ?? 0);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;

    const durationMinRaw = Number(payload.durationMin ?? payload.duration ?? 0);
    return {
        distanceKm,
        durationMin: Number.isFinite(durationMinRaw) && durationMinRaw > 0 ? durationMinRaw : null,
        distanceText: String(payload.distanceText || "").trim(),
        durationText: String(payload.durationText || "").trim(),
        provider: String(payload.provider || "").trim()
    };
}

async function requestRouteInfo(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) return null;

        let payload = null;
        try {
            payload = await response.json();
        } catch (jsonError) {
            payload = null;
        }

        return normalizeBackendRouteInfo(payload);
    } catch (err) {
        return null;
    }
}

async function fetchRouteInfoFromBackend(originLat, originLon, destinationLat, destinationLon) {
    const cacheKey = buildRouteCacheKey(originLat, originLon, destinationLat, destinationLon);
    const cached = deliveryRouteInfoCache.get(cacheKey);
    if (cached) return cached;

    const pending = deliveryRouteInfoInFlight.get(cacheKey);
    if (pending) return pending;

    const requestPromise = (async () => {
        try {
            const query = new URLSearchParams({
                fromLat: String(originLat),
                fromLon: String(originLon),
                toLat: String(destinationLat),
                toLon: String(destinationLon)
            }).toString();

            const googleInfo = await requestRouteInfo(`${API_URL}/gmaps-distance?${query}`);
            const aiInfo = googleInfo ? null : await requestRouteInfo(`${API_URL}/ai-distance`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    originCoords: { lat: originLat, lon: originLon },
                    destinationCoords: { lat: destinationLat, lon: destinationLon }
                })
            });
            const osrmInfo = (googleInfo || aiInfo) ? null : await requestRouteInfo(`${API_URL}/distance?${query}`);
            const normalized = googleInfo || aiInfo || osrmInfo;
            if (!normalized) return null;

            setCachedRouteInfo(cacheKey, normalized);
            return normalized;
        } catch (err) {
            return null;
        } finally {
            deliveryRouteInfoInFlight.delete(cacheKey);
        }
    })();

    deliveryRouteInfoInFlight.set(cacheKey, requestPromise);
    return requestPromise;
}

function calculateDeliveryRouteMinutes(distanceKm) {
    const km = Number(distanceKm || 0);
    if (!Number.isFinite(km) || km <= 0) return 1;
    const minutesPerKm = Number(siteSettings?.deliveryMinutesPerKm || 0);
    const rawMinutes = minutesPerKm > 0 ? (km * minutesPerKm) : (km / 30) * 60;
    return Math.max(1, Math.round(rawMinutes));
}

function formatMinutesForUi(minutes) {
    const value = Number(minutes || 0);
    if (!Number.isFinite(value) || value <= 0) return "1";
    const rounded = Math.max(1, Math.round(value * 10) / 10);
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, "");
}

function renderDeliveryUi() {
    const deliveryLabel = document.getElementById("deliveryText");
    if (!deliveryLabel) return;
    if (selectedDeliveryType === "pickup") return;
    if (!Number.isFinite(currentDistanceKm) || currentDistanceKm <= 0) {
        deliveryLabel.textContent = "Manzil aniqlanmoqda...";
        return;
    }
    const distanceLabel = formatDistanceLabel(currentDistanceKm);
    const durationLabel = formatDurationHuman(currentDurationMin);
    deliveryLabel.textContent = `Yetkazish: ${formatMoney(currentDeliveryPrice)} (${distanceLabel}, ~${durationLabel})`;
}

function saveSessionLocation() {
    if (!userCoords || !Number.isFinite(userCoords.lat) || !Number.isFinite(userCoords.lon)) return;
    try {
        sessionStorage.setItem("session_location_v1", JSON.stringify({
            userCoords: { lat: Number(userCoords.lat), lon: Number(userCoords.lon) },
            userAddress: String(userAddress || "")
        }));
    } catch (e) {
        // sessionStorage mavjud bo'lmasa jimgina o'tkazib yuboramiz
    }
}

async function updateDeliveryInfo(userLat, userLon) {
    const restLat = RESTAURANT_COORDS.lat;
    const restLon = RESTAURANT_COORDS.lon;
    const straightDistanceKm = getDistance(restLat, restLon, userLat, userLon);
    if (!Number.isFinite(straightDistanceKm) || straightDistanceKm <= 0) {
        currentDistanceKm = 0;
        currentDurationMin = 0;
        currentDurationText = "";
        currentDeliveryPrice = 0;
        currentDeliveryDistanceLabel = "";
        currentDeliveryDurationLabel = "";
        renderDeliveryUi();
        saveSessionLocation();
        return;
    }

    const useStraightLineOnly = straightDistanceKm < STRAIGHT_LINE_ONLY_UNDER_KM;
    const routeInfo = useStraightLineOnly
        ? null
        // Foydalanuvchi tomonidan ko'riladigan marshrut yo'nalishi: foydalanuvchi -> filial.
        : await fetchRouteInfoFromBackend(userLat, userLon, restLat, restLon);

    const routeDistanceKm = Number(routeInfo?.distanceKm || 0);
    const hasRouteDistance = Number.isFinite(routeDistanceKm) && routeDistanceKm > 0;
    const routeRatio = hasRouteDistance && straightDistanceKm > 0
        ? (routeDistanceKm / straightDistanceKm)
        : 0;
    const routeLooksUnreliable = hasRouteDistance && (
        (straightDistanceKm <= 0.2 && routeDistanceKm > 1) ||
        (straightDistanceKm < 1 && routeRatio > 8)
    );
    const useRouteDistance = hasRouteDistance && !routeLooksUnreliable;
    const distanceKm = useRouteDistance ? routeDistanceKm : straightDistanceKm;
    const durationLabelFromRoute = String(routeInfo?.durationText || "").trim();
    const routeDurationMin = Number(routeInfo?.durationMin);
    const durationMin = useRouteDistance && Number.isFinite(routeDurationMin) && routeDurationMin > 0
        ? Math.max(1, Math.round(routeDurationMin))
        : calculateDeliveryRouteMinutes(distanceKm);

    currentDistanceKm = distanceKm;
    currentDurationMin = durationMin;
    currentDurationText = useRouteDistance
        ? (durationLabelFromRoute || `${formatMinutesForUi(currentDurationMin)} daqiqa`)
        : formatDurationHuman(currentDurationMin);
    currentDeliveryPrice = calculateDeliveryPrice(distanceKm);
    currentDeliveryDistanceLabel = formatDistanceLabel(currentDistanceKm);
    currentDeliveryDurationLabel = (useRouteDistance && durationLabelFromRoute)
        ? durationLabelFromRoute
        : formatDurationHuman(currentDurationMin);

    renderDeliveryUi();
    saveSessionLocation();
}

// Restoran manzilini koordinataga aylantirish (API key talab qilinmaydi)
async function resolveRestaurantCoords() {
    if (isRestaurantCoordsResolved) return RESTAURANT_COORDS;

    const queries = [
        `${RESTAURANT_NAME}, ${RESTAURANT_ADDRESS}`,
        RESTAURANT_ADDRESS,
        "ул Имама Бухари 185 Самарканд",
        "Imom al-Buxoriy ko'chasi 185 Samarqand",
        "Imom al-Buxoriy ko'chasi Samarqand"
    ];

    try {
        for (const query of queries) {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
            );
            if (!response.ok) continue;

            const data = await response.json();
            if (!Array.isArray(data) || data.length === 0) continue;

            const lat = Number(data[0].lat);
            const lon = Number(data[0].lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                RESTAURANT_COORDS = { lat, lon };
                break;
            }
        }
    } catch (err) {
        console.log("Restoran koordinatasi geokodda topilmadi, fallback ishlatiladi:", err.message);
    } finally {
        isRestaurantCoordsResolved = true;
    }

    return RESTAURANT_COORDS;
}

// --- GOOGLE AUTENTIFIKATSIYA ---
async function checkUserSession() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/user`, { credentials: 'include' });
        if (response.ok) {
            const user = await response.json();
            setCurrentUser(user);
            setOverlayDisplay("authModal", false, "flex");
        } else {
            setCurrentUser(null);
            fillSavedGmail();
            setOverlayDisplay("authModal", true, "flex");
        }
    } catch (error) {
        console.error('Error checking user session:', error);
        setCurrentUser(null);
        fillSavedGmail();
        setOverlayDisplay("authModal", true, "flex");
    }
}

function handleGoogleLogin(event) {
    if (event) event.preventDefault();
    // Google icon tugmasi: account tanlashni majburiy ko'rsatamiz
    window.location.href = `${API_BASE_URL}/auth/google?prompt=select_account`;
}

function isValidGmail(email) {
    return GMAIL_REGEX.test((email || '').trim());
}

function submitManualGmail() {
    const input = document.getElementById('gmailInput');
    const err = document.getElementById('gmailError');
    if (!input || !err) return;
    const email = (input.value || '').trim().toLowerCase();
    if (!isValidGmail(email)) {
        err.style.display = 'block';
        err.textContent = 'Faqat @gmail.com manzili qabul qilinadi.';
        return;
    }
    err.style.display = 'none';
    err.textContent = '';
    localStorage.setItem("preferredGmail", email);
    // Email Google-ga login_hint sifatida yuboriladi; parolni Google o'zi so'raydi va tekshiradi.
    window.location.href = `${API_BASE_URL}/auth/google?email=${encodeURIComponent(email)}`;
}

function closeAuthModal() {
    setOverlayDisplay("authModal", false, "flex");
}

function updateUserUI(user) {
    const menuContent = document.querySelector('.menu-content');
    if (!menuContent) return;
    if (user) {
        console.log("рџ‘¤ Foydalanuvchi:", user.displayName);
        // Logout tugmasini ko'rsatish
        menuContent.innerHTML = `
            <div class="user-profile">
                <img src="${user.photo}" alt="${user.displayName}" class="profile-pic">
                <span>${user.displayName}</span>
            </div>
            <button class="logout-btn" onclick="handleLogout()">
                <i class="fas fa-sign-out-alt"></i> Chiqish
            </button>
            <button class="logout-btn menu-settings-btn" onclick="openAdminPanelFromMenu()">
                <i class="fas fa-sliders-h"></i> Sozlash
            </button>
        `;

    } else {
        // Login taklifini ko'rsatish
         menuContent.innerHTML = `
            <button class="logout-btn" onclick="openAuthModal(); closeMenuFn();">
                <i class="fas fa-sign-in-alt"></i> Kirish
            </button>
            <button class="logout-btn menu-settings-btn" onclick="openAdminPanelFromMenu()">
                <i class="fas fa-sliders-h"></i> Sozlash
            </button>
        `;
    }
}


function getYandexRouteUrlFromUserToRestaurant(originLat, originLon) {
    const destinationPoint = (Number.isFinite(RESTAURANT_COORDS?.lat) && Number.isFinite(RESTAURANT_COORDS?.lon))
        ? `${RESTAURANT_COORDS.lat},${RESTAURANT_COORDS.lon}`
        : RESTAURANT_ADDRESS;
    const originPart = (Number.isFinite(originLat) && Number.isFinite(originLon))
        ? `${originLat},${originLon}`
        : "";
    return originPart
        ? `https://yandex.uz/maps/?mode=routes&rtt=pd&rtext=${encodeURIComponent(originPart)}~${encodeURIComponent(destinationPoint)}`
        : `https://yandex.uz/maps/?mode=routes&rtt=pd&rtext=~${encodeURIComponent(destinationPoint)}`;
}

function sanitizeAddressPart(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/,+/g, ",")
        .trim();
}

function uniqueAddressParts(parts) {
    const uniqueParts = [];
    for (const part of parts) {
        const normalized = sanitizeAddressPart(part);
        if (!normalized) continue;
        if (!uniqueParts.some(item => item.toLowerCase() === normalized.toLowerCase())) {
            uniqueParts.push(normalized);
        }
    }
    return uniqueParts;
}

function buildCoordKey(lat, lon) {
    return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
}

function formatSafeAddress(addressObj, coordString) {
    if (!addressObj || typeof addressObj !== "object") {
        return `Koordinata: ${coordString}`;
    }

    const road = sanitizeAddressPart(
        addressObj.road || addressObj.pedestrian || addressObj.residential || addressObj.footway || addressObj.path
    );
    const houseNumber = sanitizeAddressPart(addressObj.house_number);
    const streetLine = sanitizeAddressPart(road && houseNumber ? `${road} ${houseNumber}` : road);

    const city = sanitizeAddressPart(addressObj.city || addressObj.town || addressObj.village || addressObj.municipality);
    const region = sanitizeAddressPart(addressObj.state || addressObj.region);
    const country = sanitizeAddressPart(addressObj.country);

    const localityLine = uniqueAddressParts([city, region, country]).join(", ");
    const finalAddress = uniqueAddressParts([streetLine, localityLine]).join(" | ");
    return finalAddress || `Koordinata: ${coordString}`;
}

async function resolveAddressFromBackend(lat, lon, coordString) {
    try {
        const coordKey = buildCoordKey(lat, lon);
        if (coordKey === lastResolvedCoordKey && Date.now() - lastAddressResolveAt < 30000 && lastResolvedAddress) {
            return lastResolvedAddress;
        }
        const response = await fetch(
            `${API_URL}/location/resolve?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
        );
        if (!response.ok) return `Koordinata: ${coordString}`;
        const payload = await response.json();
        const address = normalizeTextValue(payload?.address);
        if (!address) return `Koordinata: ${coordString}`;
        lastResolvedCoordKey = coordKey;
        lastResolvedAddress = address;
        lastAddressResolveAt = Date.now();
        return address;
    } catch (error) {
        return `Koordinata: ${coordString}`;
    }
}

function clearLocationRefreshPromptTimer() {
    if (locationRefreshPromptTimer) {
        clearTimeout(locationRefreshPromptTimer);
        locationRefreshPromptTimer = null;
    }
}

function getLocationRefreshChip() {
    const locBtn = document.getElementById("locationBtn");
    if (!locBtn) return null;

    let chip = locBtn.querySelector(".location-refresh-chip");
    if (chip) return chip;

    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "location-refresh-chip";
    chip.setAttribute("aria-label", "Joylashuvni yangilash");
    chip.innerHTML = `<i class="fas fa-sync-alt"></i><span>Yangilash</span>`;
    chip.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideLocationRefreshPrompt();
        await initLocation({ forceFresh: true });
        await updateCartUI();
    });

    locBtn.appendChild(chip);
    return chip;
}

function hideLocationRefreshPrompt() {
    const chip = document.querySelector("#locationBtn .location-refresh-chip");
    if (!chip) return;
    chip.classList.remove("is-visible");
}

function showLocationRefreshPrompt() {
    const chip = getLocationRefreshChip();
    if (!chip || !isLocationResolved) return;
    chip.classList.add("is-visible");
}

function scheduleLocationRefreshPrompt() {
    clearLocationRefreshPromptTimer();
    hideLocationRefreshPrompt();
    if (!isLocationResolved) return;
    locationRefreshPromptTimer = setTimeout(() => {
        showLocationRefreshPrompt();
    }, LOCATION_REFRESH_PROMPT_DELAY_MS);
}

// Yandex Maps marshrutini ochish (API key talab qilinmaydi)
function openRestaurantOnYandexMaps() {
    window.open(getYandexRouteUrlFromUserToRestaurant(), "_blank");
}

function openGoogleNav() {
    if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lon)) {
        window.open(getYandexRouteUrlFromUserToRestaurant(userCoords.lat, userCoords.lon), "_blank");
        return;
    }
    openRestaurantOnYandexMaps();
}

// --- 4. LOKATSIYA ANIQLASH ---
function initLocation(options = {}) {
    const forceFresh = Boolean(options?.forceFresh);
    if (isLocationResolving) {
        return locationResolvePromise;
    }
    const locText = document.getElementById("locationText");
    const locBtn = document.getElementById("locationBtn") || (locText ? locText.parentElement : null);
    if (!locText) return Promise.resolve(false);
    if (locBtn) {
        locBtn.onclick = openRestaurantOnYandexMaps;
        locBtn.style.cursor = "pointer";
        locBtn.title = `${RESTAURANT_NAME} manziliga Yandex marshrut ochish`;
    }
    clearLocationRefreshPromptTimer();
    hideLocationRefreshPrompt();
    if (!navigator.geolocation) {
        locText.textContent = "Brauzer geolokatsiyani qo'llab-quvvatlamaydi";
        userCoords = null;
        updateCartUI();
        return Promise.resolve(false);
    }

    const geoOptions = {
        enableHighAccuracy: forceFresh,
        timeout: forceFresh ? 10000 : 8000,
        maximumAge: forceFresh ? 0 : 60000
    };

    isLocationResolving = true;
    locationResolvePromise = new Promise((resolve) => {
        resolveLocationPromise = resolve;
    });
    bestGpsAccuracy = Infinity;
    locText.textContent = "Joylashuv aniqlanmoqda...";
    locText.title = "Joylashuv aniqlanmoqda...";

    const applyPosition = (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = Number(pos.coords.accuracy) || 0;

        // Best accuracy-ni statistik ma'lumot sifatida saqlaymiz, lekin koordinatani bloklamaymiz
        if (accuracy) {
            bestGpsAccuracy = Math.min(bestGpsAccuracy, accuracy);
        }

        const coordString = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        const hasAccuracy = Number.isFinite(accuracy) && accuracy > 0;
        const accuracyInfo = hasAccuracy ? `aniqlik: ${Math.round(accuracy)}m` : "aniqlik: noma'lum";
        const isUsable = !hasAccuracy || accuracy <= MAX_ACCEPTABLE_ACCURACY_METERS;

        userCoords = { lat, lon };
        isLocationResolved = true;
        scheduleLocationRefreshPrompt();
        if (isLocationResolving && resolveLocationPromise) {
            resolveLocationPromise(true);
            resolveLocationPromise = null;
        }
        isLocationResolving = false;
        locText.textContent = "Manzil aniqlanmoqda...";
        locText.title = "Manzil aniqlanmoqda...";
        updateCartUI();
        resolveAddressFromBackend(lat, lon, coordString).then((resolvedAddress) => {
            userAddress = resolvedAddress;
            locText.textContent = userAddress;
            locText.title = !isUsable
                ? `${userAddress} (${accuracyInfo}) - GPS aniqligi past`
                : `${userAddress} (${accuracyInfo})`;
            getLocationRefreshChip();
        });

        if (locBtn) {
            locBtn.onclick = openGoogleNav;
            locBtn.style.cursor = "pointer";
            locBtn.title = "Yandex xaritada marshrutni ochish";
        }
    };

    navigator.geolocation.getCurrentPosition(
        applyPosition,
        (err) => {
            userCoords = null;
            isLocationResolved = false;
            isLocationResolving = false;
            if (resolveLocationPromise) {
                resolveLocationPromise(false);
                resolveLocationPromise = null;
            }
            const msg = (err && err.code === 1)
                ? "GPS ruxsati berilmadi"
                : (err && err.code === 3)
                    ? "GPS javobi kechikdi, qayta urinib ko'ring"
                    : "GPS orqali joylashuv olinmadi";
            locText.textContent = msg;
            locText.title = msg;
            if (locBtn) {
                locBtn.onclick = openRestaurantOnYandexMaps;
                locBtn.style.cursor = "pointer";
                locBtn.title = `${RESTAURANT_NAME} manziliga Yandex marshrut ochish`;
            }
            clearLocationRefreshPromptTimer();
            hideLocationRefreshPrompt();
            updateCartUI();
        },
        geoOptions
    );

    // Bu oqimda joylashuv 1 marta olinadi, doimiy watch ishlatilmaydi.
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
    return locationResolvePromise;
}

// --- 5. SAVAT FUNKSIYALARI ---
async function openCart() {
    document.getElementById("cartPanel").classList.add("active");
    document.getElementById("cartOverlay").classList.add("active");
    renderCart();
    updateCartSummary();
    if (!isLocationResolved) {
        initLocation({ forceFresh: true });
    }
    await updateCartUI();
    syncPageChromeState();
}

function closeCartFn() {
    document.getElementById("cartPanel").classList.remove("active");
    document.getElementById("cartOverlay").classList.remove("active");
    updateCartUI();
    syncPageChromeState();
}

// --- 5.1 MENYU FUNKSIYALARI ---
function openMenu() {
    document.getElementById("menuPanel").classList.add("active");
    document.getElementById("menuOverlay").classList.add("active");
    syncPageChromeState();
}

function closeMenuFn() {
    document.getElementById("menuPanel").classList.remove("active");
    document.getElementById("menuOverlay").classList.remove("active");
    syncPageChromeState();
}

function openAdminPanel() {
    const overlay = document.getElementById("adminEmbedOverlay");
    if (!overlay) {
        alert("Admin panel topilmadi.");
        return;
    }
    overlay.hidden = false;
    if (document.body) {
        document.body.classList.add("admin-embed-open");
    }
    if (typeof window.initAdminPanel === "function") {
        window.initAdminPanel();
    } else {
        setTimeout(() => {
            if (typeof window.initAdminPanel === "function") {
                window.initAdminPanel();
            }
        }, 80);
    }
}

function closeAdminPanel() {
    const overlay = document.getElementById("adminEmbedOverlay");
    if (overlay) {
        overlay.hidden = true;
    }
    if (document.body) {
        document.body.classList.remove("admin-embed-open");
    }
}

function openAdminPanelFromMenu() {
    closeMenuFn();
    openAdminPanel();
}

window.openAdminPanel = openAdminPanel;
window.closeAdminPanel = closeAdminPanel;

function handleLogout() {
    window.location.href = `${API_BASE_URL}/logout`;
}

function syncDeliveryOptionState() {
    document.querySelectorAll(".delivery-option").forEach(option => {
        option.classList.toggle("active", option.dataset.delivery === selectedDeliveryType);
    });
}

function setDeliveryType(type) {
    selectedDeliveryType = type === "pickup" ? "pickup" : "home";
    syncDeliveryOptionState();
    updateCartUI();
}

function renderCart() {
    const box = document.getElementById("cartItems");
    const totalText = document.getElementById("cartTotal");
    if (!box) return;
    const orderingLocked = !isOrderingEnabled();

    const items = Object.entries(cart);
    if (items.length === 0) {
        box.innerHTML = `
            <div class="cart-empty-state">
                <i class="fas fa-shopping-basket"></i>
                <p>Savat hozircha bo'sh</p>
            </div>`;
        if (totalText) totalText.textContent = formatMoney(0);
        saveCart();
        updateCartSummary();
        updateCartUI();
        return;
    }

    let total = 0;
    box.innerHTML = items.map(([name, item]) => {
        const price = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 0;
        const itemTotal = price * quantity;
        const safeName = escapeHtml(name);
        const encodedName = encodeURIComponent(name);
        const itemImg = escapeHtml(item.img || getFoodImageByName(name));
        const controlsHtml = orderingLocked
            ? `<div class="food-lock-note">Buyurtma vaqtincha yopiq</div>`
            : `
                    <div class="cart-actions">
                        <button class="cart-qty-btn" data-cart-action="decrease" data-key="${encodedName}" data-price="${price}" aria-label="${safeName} sonini kamaytirish">−</button>
                        <span class="cart-qty-count">${quantity}</span>
                        <button class="cart-qty-btn" data-cart-action="increase" data-key="${encodedName}" data-price="${price}" aria-label="${safeName} sonini oshirish">+</button>
                    </div>
            `;
        total += itemTotal;

        return `
            <div class="cart-item" data-key="${encodedName}">
                <img class="cart-item-media" src="${itemImg}" alt="${safeName}" onerror="this.src='8.jpg'">
                <div class="cart-info">
                    <button class="cart-remove" data-cart-action="remove" data-key="${encodedName}" aria-label="${safeName} ni o'chirish">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                    <h4>${safeName}</h4>
                    <p class="cart-unit-price">${formatMoney(price)} (1 dona)</p>
                    <div class="cart-item-total">
                        Jami: ${formatMoney(itemTotal)}
                        <span class="cart-piece-count">(${quantity} ta)</span>
                    </div>
                    ${controlsHtml}
                </div>
            </div>`;
    }).join("");

    if (totalText) totalText.textContent = formatMoney(total);
    saveCart();
    updateCartSummary();
    updateCartUI();
}

function handleCartItemsClick(event) {
    if (!isOrderingEnabled()) {
        alert(getOrderingBlockedMessage());
        return;
    }
    const targetButton = event.target.closest("[data-cart-action]");
    if (!targetButton) return;

    animateQtyButton(targetButton);

    const action = targetButton.dataset.cartAction;
    const name = decodeDataKey(targetButton.dataset.key);
    if (!name) return;

    if (action === "remove") {
        removeItem(name);
        return;
    }

    const price = Number(targetButton.dataset.price || cart[name]?.price || 0);
    const delta = action === "increase" ? 1 : -1;
    if (delta !== 0) {
        changeQty(name, price, delta, cart[name]?.img || getFoodImageByName(name));
    }
}

// Savat xulosasini yangilash
function updateCartSummary() {
    let subtotal = 0;

    Object.values(cart).forEach(item => {
        subtotal += item.price * item.quantity;
    });

    const deliveryPrice = currentDeliveryPrice || 0;
    const total = subtotal + deliveryPrice;

    const subtotalEl = document.getElementById("subtotalPrice");
    const deliveryEl = document.getElementById("deliveryPrice");
    const totalEl = document.getElementById("totalCartPrice");

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    if (deliveryEl) deliveryEl.textContent = formatMoney(deliveryPrice);
    if (totalEl) totalEl.textContent = formatMoney(total);

    renderOrderPreview();
}

function renderOrderPreview() {
    const confirmOrderBtn = document.getElementById("confirmOrderBtn");
    if (!confirmOrderBtn) return;

    const totalItems = Object.values(cart).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    confirmOrderBtn.disabled = totalItems === 0;
    confirmOrderBtn.textContent = totalItems > 0
        ? `Buyurtmani tasdiqlash (${totalItems})`
        : "Buyurtmani tasdiqlash";
}

function changeQty(name, price, delta, img) {
    const numericPrice = Number(price);
    if (!name || !Number.isFinite(numericPrice)) return;

    if (!cart[name] && delta > 0) {
        cart[name] = { price: numericPrice, quantity: 0, img: img || getFoodImageByName(name) };
    }

    if (cart[name]) {
        cart[name].quantity += delta;
        if (cart[name].quantity <= 0) {
            delete cart[name];
        }
    }

    saveCart();
    renderCart();
    renderFoods(activeCategory);
}

function removeItem(name) {
    if (!cart[name]) return;
    delete cart[name];
    renderCart();
    renderFoods(activeCategory);
}

async function updateCartUI() {
    let subtotal = 0;
    let count = 0;
    Object.values(cart).forEach(i => {
        subtotal += i.price * i.quantity;
        count += i.quantity;
    });
    const prepMinutes = getCartPrepMinutes();

    const panel = document.getElementById("bottomCartPanel");
    const nextBtn = document.getElementById("nextBtn");
    const deliveryLabel = document.getElementById("deliveryText");
    const totalPriceText = document.getElementById("totalPriceText");
    const cartPanel = document.getElementById("cartPanel");
    const isCartOpen = Boolean(cartPanel && cartPanel.classList.contains("active"));

    if (panel) {
        panel.style.display = count > 0 ? "block" : "none";
        panel.classList.toggle("is-visible", count > 0 && !isCartOpen);
    }

    if (!isLocationResolved) {
        currentDistanceKm = 0;
        currentDurationMin = 0;
        currentDeliveryPrice = 0;
        currentDeliveryDistanceLabel = "";
        currentDeliveryDurationLabel = "";
        if (deliveryLabel) deliveryLabel.textContent = "Manzil aniqlanmoqda...";
        if (nextBtn) { nextBtn.disabled = true; nextBtn.style.background = "#cccccc"; }
        updateCartSummary();
        syncPageChromeState();
        return;
    }

    if (count > 0 && panel) {
        if (selectedDeliveryType === "pickup") {
            currentDistanceKm = 0;
            currentDurationMin = 0;
            currentDeliveryPrice = 0;
            currentDeliveryDistanceLabel = "";
            currentDeliveryDurationLabel = "";
            if (deliveryLabel) {
                const prepLabel = prepMinutes > 0 ? formatDurationHuman(prepMinutes) : "";
                deliveryLabel.innerHTML = prepLabel
                    ? `Olib ketish: bepul<br><span class="delivery-total-time">Tayyor bo'lish: ${prepLabel}</span>`
                    : "Olib ketish: bepul";
            }
            if (totalPriceText) totalPriceText.textContent = subtotal.toLocaleString() + " so'm";
            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.style.background = "#ffcc00";
                nextBtn.style.opacity = "1";
            }
        } else if (userCoords) {
            await resolveRestaurantCoords();
            await updateDeliveryInfo(userCoords.lat, userCoords.lon);

            if (!Number.isFinite(currentDistanceKm) || currentDistanceKm <= 0) {
                currentDistanceKm = 0;
                currentDurationMin = 0;
                currentDeliveryPrice = 0;
                currentDeliveryDistanceLabel = "";
                currentDeliveryDurationLabel = "";
                if (deliveryLabel) deliveryLabel.textContent = "Manzil aniqlanmoqda...";
                if (nextBtn) { nextBtn.disabled = true; nextBtn.style.background = "#cccccc"; }
                if (totalPriceText) totalPriceText.textContent = subtotal.toLocaleString() + " so'm";
            } else {
                const delivery = currentDeliveryPrice;
                const travelMinutes = Math.max(1, Math.round(currentDurationMin || 0));
                const totalEtaMinutes = prepMinutes + travelMinutes;
                const distanceLabel = currentDeliveryDistanceLabel || formatDistanceLabel(currentDistanceKm);
                const travelLabel = currentDeliveryDurationLabel || formatDurationHuman(travelMinutes);
                const totalLabel = formatDurationHuman(totalEtaMinutes);

            // Ekranga chiqarish (Masofani 1 xona aniqlikda ko'rsatamiz)
            if (deliveryLabel) {
                deliveryLabel.innerHTML = `
                    Yetkazish: ${formatMoney(delivery)} (${distanceLabel}, ~${travelLabel})<br>
                    <span class="delivery-total-time">Jami vaqt: ${totalLabel}</span>
                    <button type="button" class="delivery-route-link" onclick="openGoogleNav()">
                        <i class="fas fa-route"></i> Yandex xaritada marshrutni ko'rish
                    </button>
                `;
            }

            if (totalPriceText) totalPriceText.textContent = (subtotal + delivery).toLocaleString() + " so'm";

            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.style.background = "#ffcc00";
                nextBtn.style.opacity = "1";
            }
            }
        } else {
            currentDistanceKm = 0;
            currentDurationMin = 0;
            currentDeliveryPrice = 0;
            currentDeliveryDistanceLabel = "";
            currentDeliveryDurationLabel = "";
            if (deliveryLabel) deliveryLabel.textContent = "Manzil aniqlanmoqda...";
            if (nextBtn) { nextBtn.disabled = true; nextBtn.style.background = "#cccccc"; }
        }
    } else if (panel) {
        currentDistanceKm = 0;
        currentDurationMin = 0;
        currentDeliveryPrice = 0;
        currentDeliveryDistanceLabel = "";
        currentDeliveryDurationLabel = "";
        panel.classList.remove("is-visible");
        panel.style.display = "none";
    }

    updateCartSummary();
    syncPageChromeState();
}

// --- 6. MENUNI RENDER QILISH (EVENT DELEGATION BILAN) ---
function renderFoods(category) {
    const display = document.getElementById("foodDisplay");
    if (!display) return;
    display.innerHTML = "";

    activeCategory = getResolvedActiveCategory(category);
    const filtered = getFoodsByCategory(activeCategory);

    if (!filtered.length) {
        display.innerHTML = '<div class="food-empty-state">Bu kategoriyada hozircha taom yo\'q</div>';
        return;
    }

    const orderingLocked = !isOrderingEnabled();
    filtered.forEach(food => {
        const isOut = food.status === "out_of_stock";
        const count = cart[food.name]?.quantity || 0;
        const price = Number(food.price);

        const foodCard = document.createElement('div');
        foodCard.className = `food-card ${isOut ? 'out-of-stock' : ''}`;
        
        let quantityControlsHTML = '';
        if (!isOut) {
            if (orderingLocked) {
                quantityControlsHTML = `<div class="food-lock-note">Buyurtma vaqtincha yopiq</div>`;
            } else if (count > 0) {
                quantityControlsHTML = `
                    <div class="quantity-controls">
                        <button class="quantity-btn" data-action="decrease" data-name="${food.name}" data-price="${price}">-</button>
                        <span class="quantity-count">${count}</span>
                        <button class="quantity-btn" data-action="increase" data-name="${food.name}" data-price="${price}">+</button>
                    </div>`;
            } else {
                quantityControlsHTML = `
                    <div class="quantity-controls">
                         <button class="quantity-btn add-to-cart" data-action="increase" data-name="${food.name}" data-price="${price}" data-img="${food.img}">Savatga qo'shish</button>
                    </div>`;
            }
        } else {
            quantityControlsHTML = '<div class="out-label">TUGAGAN</div>';
        }

        foodCard.innerHTML = `
            <img src="${food.img}" onerror="this.src='8.jpg'">
            <div class="food-info">
                <h3>${food.name}</h3>
                <p>${price.toLocaleString()} so'm</p>
                ${quantityControlsHTML}
            </div>`;
            
        display.appendChild(foodCard);
    });
}

function handleFoodDisplayClick(event) {
    if (!isOrderingEnabled()) {
        alert(getOrderingBlockedMessage());
        return;
    }
    const target = event.target;
    const button = target.closest('.quantity-btn');
    
    if (!button) {
        return;
    }

    const action = button.dataset.action;
    const name = button.dataset.name;
    const price = Number(button.dataset.price);
    const img = button.dataset.img;

    if (!action || !name || isNaN(price)) {
        return;
    }

    const delta = action === 'increase' ? 1 : -1;
    changeQty(name, price, delta, img);
}

function proceedFromCart() {
    proceedToNext({ fromCart: true });
}

async function proceedToNext(options = {}) {
    const fromCart = Boolean(options?.fromCart);
    // 1. Avval Google bilan kirganini tekshiramiz
    if (!currentUser) {
        alert("Buyurtma berish uchun avval Google hisobingiz bilan kiring.");
        openAuthModal();
        return;
    }

    if (!isOrderingEnabled()) {
        alert(getOrderingBlockedMessage());
        return;
    }

    // 2. Savatni tekshiramiz
    if (Object.keys(cart).length === 0) {
        alert("Savat bo'sh! Oldin taom tanlang.");
        return;
    }

    // 3. Manzil hali olinmagan bo'lsa, bir marta olib beramiz
    if (!isLocationResolved) {
        alert("Manzil aniqlanmaguncha buyurtma berib bo'lmaydi.");
        initLocation({ forceFresh: true });
        return;
    }

    await updateCartUI();

    // 4. Mavjud manzil bo'yicha hisob tayyormi tekshiramiz
    if (!isCheckoutReady()) {
        alert("Manzil aniqlanmaguncha yoki hisoblanmaguncha kuting.");
        return;
    }

    if (!fromCart) {
        const cartPanel = document.getElementById("cartPanel");
        if (cartPanel && !cartPanel.classList.contains("active")) {
            openCart();
            return;
        }
    }

    // 5. Buyurtma oynasini ochamiz
    openOrderModal();
}

function setSubmitOrderButtonLoading(isLoading) {
    const submitOrderBtn = document.getElementById("submitOrderBtn");
    if (!submitOrderBtn) return;

    if (isLoading) {
        submitOrderBtn.dataset.originalText = submitOrderBtn.textContent;
        submitOrderBtn.disabled = true;
        submitOrderBtn.textContent = "Yuborilmoqda...";
        return;
    }

    submitOrderBtn.textContent = submitOrderBtn.dataset.originalText || "Buyurtmani yuborish";
    refreshSubmitOrderButton();
}

function clearCheckoutStateAfterSubmit() {
    cart = {};
    saveCart();
    renderCart();
    updateCartUI();
    renderFoods(activeCategory);
    const cartCommentInput = document.getElementById("cartCommentInput");
    if (cartCommentInput) cartCommentInput.value = "";
    closeOrderModal(false);
}

function updateCardPaymentHintVisibility() {
    const clickHintBox = document.getElementById("clickHintBox");
    if (!clickHintBox) return;
    const cardOption = document.querySelector(".payment-option[data-payment='card']");
    const cardDisabled = cardOption && cardOption.classList.contains("is-disabled");
    clickHintBox.hidden = selectedPaymentMethod !== "card" || cardDisabled;
}

function copyClickCardNumber() {
    const cardNumber = CLICK_RECEIVER_CARD;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(cardNumber)
            .then(() => alert("Karta raqami nusxalandi."))
            .catch(() => alert(`Karta raqami: ${cardNumber}`));
        return;
    }
    alert(`Karta raqami: ${cardNumber}`);
}

async function requestClickPaymentUrl(orderId, amount, phone) {
    const response = await fetch(`${API_URL}/payments/click-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, amount, phone })
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch (e) {
        payload = {};
    }

    if (!response.ok || !payload.paymentUrl) {
        throw new Error(payload.error || "Click to'lov URL yaratib bo'lmadi");
    }

    return payload;
}

function openOrderModal() {
    if (!isOrderingEnabled()) {
        alert(getOrderingBlockedMessage());
        return;
    }
    const modal = document.getElementById('orderModal');
    if (!modal) {
        alert("Buyurtma oynasi topilmadi. Sahifani yangilang.");
        return;
    }

    selectedPaymentMethod = "cash";

    const phoneInput = document.getElementById("phoneInput");
    if (phoneInput) {
        const savedPhone = localStorage.getItem("userPhone");
        if (savedPhone) {
            const savedDigits = String(savedPhone).replace(/\D/g, "").replace(/^998/, "").slice(0, 9);
            if (savedDigits && !getPhoneLocalDigits()) {
                phoneInput.value = formatUzbekPhoneInput(savedDigits).formattedLocal;
            }
        }
    }

    refreshPaymentOptionsState();
    setOverlayDisplay("orderModal", true, "flex");
}

function closeOrderModal(returnToCart = false) {
    if (document?.body) {
        document.body.classList.remove("order-modal-open");
    }
    setOverlayDisplay("orderModal", false, "flex");
    if (returnToCart) {
        openCart();
        return;
    }
    closeCartFn();
}

async function loadSiteSettings() {
    try {
        const response = await fetch(`${API_URL}/settings`);
        if (!response.ok) return;
        const settings = await response.json();
        const restaurantLat = Number(settings?.restaurantLat);
        const restaurantLon = Number(settings?.restaurantLon);
        const hasRestaurantCoords = Number.isFinite(restaurantLat) && Number.isFinite(restaurantLon);
        siteSettings = {
            ...siteSettings,
            siteName: String(settings?.siteName || siteSettings.siteName || "Mansur Shashlik").trim() || "Mansur Shashlik",
            freeDeliveryKm: Number(settings?.freeDeliveryKm || siteSettings.freeDeliveryKm || 0),
            deliveryPricePerKm: Number(settings?.deliveryPricePerKm || siteSettings.deliveryPricePerKm || 0),
            deliveryMinutesPerKm: Number(settings?.deliveryMinutesPerKm || siteSettings.deliveryMinutesPerKm || 1.5),
            maxDeliveryKm: Number(settings?.maxDeliveryKm || siteSettings.maxDeliveryKm || 0),
            maxItemQuantity: Number(settings?.maxItemQuantity || siteSettings.maxItemQuantity || 0),
            contactPhone: String(settings?.contactPhone || siteSettings.contactPhone || ""),
            restaurantName: String(settings?.restaurantName || siteSettings.restaurantName || RESTAURANT_NAME).trim() || RESTAURANT_NAME,
            restaurantAddress: String(settings?.restaurantAddress || siteSettings.restaurantAddress || RESTAURANT_ADDRESS).trim() || RESTAURANT_ADDRESS,
            restaurantLat: hasRestaurantCoords ? restaurantLat : siteSettings.restaurantLat,
            restaurantLon: hasRestaurantCoords ? restaurantLon : siteSettings.restaurantLon,
            categories: uniqueValuesByKey(settings?.categories)
        };

        RESTAURANT_NAME = siteSettings.restaurantName || RESTAURANT_NAME;
        RESTAURANT_ADDRESS = siteSettings.restaurantAddress || RESTAURANT_ADDRESS;
        applySiteBrand();
        if (hasRestaurantCoords) {
            RESTAURANT_COORDS = {
                lat: Number(restaurantLat.toFixed(6)),
                lon: Number(restaurantLon.toFixed(6))
            };
            isRestaurantCoordsResolved = true;
        }
    } catch (err) {
        console.error("Sozlamalarni yuklashda xato:", err);
    }
}

function calculateDeliveryPrice(distanceKm) {
    const km = Math.max(0, distanceKm || 0);
    const freeKm = Number(siteSettings?.freeDeliveryKm || 0);
    const pricePerKm = Number(siteSettings?.deliveryPricePerKm || DELIVERY_PRICE_PER_KM || 0);
    const chargeableKm = Math.max(0, km - freeKm);
    return Math.round(chargeableKm * pricePerKm);
}

function refreshPaymentOptionsState() {
    if (!CARD_PAYMENTS_ENABLED && selectedPaymentMethod === "card") {
        selectedPaymentMethod = "cash";
    }
    document.querySelectorAll(".payment-option").forEach(option => {
        const paymentType = option.dataset.payment;
        option.classList.toggle("active", paymentType === selectedPaymentMethod);
    });
    const cardOption = document.querySelector(".payment-option[data-payment='card']");
    if (cardOption) {
        cardOption.classList.toggle("is-disabled", !CARD_PAYMENTS_ENABLED);
    }
    updateCardPaymentHintVisibility();
    refreshSubmitOrderButton();
}

function selectPayment(element) {
    const paymentType = element?.dataset?.payment || "";
    if (!element || element.classList.contains("is-disabled")) {
        alert("Karta orqali to'lov vaqtincha ishlamayapti.");
        return;
    }
    if (paymentType === "card" && !CARD_PAYMENTS_ENABLED) {
        alert("Karta orqali to'lov vaqtincha ishlamayapti.");
        return;
    }
    selectedPaymentMethod = paymentType;
    refreshPaymentOptionsState();
}

function isCheckoutReady() {
    const totalItems = Object.values(cart).reduce((sum, item) => sum + (item.quantity || 0), 0);
    if (totalItems <= 0) return false;
    if (!isLocationResolved) return false;
    if (selectedDeliveryType === "pickup") return true;
    return currentDistanceKm > 0;
}

function isOrderFormValid() {
    const phoneLocalDigits = getPhoneLocalDigits();
    return phoneLocalDigits.length === 9 && selectedPaymentMethod !== null && isCheckoutReady();
}

function normalizeCustomerComment(value) {
    return String(value || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 500);
}

function getCustomerCommentValue() {
    const cartInput = document.getElementById("cartCommentInput");
    return normalizeCustomerComment(cartInput?.value || "");
}

async function submitOrder() {
    await refreshPublicSiteState({ rerender: false });
    if (!isOrderingEnabled()) {
        alert(getOrderingBlockedMessage());
        closeOrderModal(false);
        refreshSubmitOrderButton();
        return;
    }

    const phoneLocalDigits = getPhoneLocalDigits();
    if (phoneLocalDigits.length !== 9) {
        alert("Iltimos, to'g'ri telefon raqamini kiriting.");
        refreshSubmitOrderButton();
        return;
    }
    if (!selectedPaymentMethod) {
        alert("Iltimos, to'lov turini tanlang.");
        refreshSubmitOrderButton();
        return;
    }
    if (selectedPaymentMethod === "card" && !CARD_PAYMENTS_ENABLED) {
        alert("Karta orqali to'lov vaqtincha ishlamayapti.");
        refreshSubmitOrderButton();
        return;
    }

    const finalPhone = '+998' + phoneLocalDigits;
    localStorage.setItem("userPhone", finalPhone);

    const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryVal = currentDeliveryPrice || 0;
    const totalVal = subtotal + deliveryVal;
    const isCardPayment = selectedPaymentMethod === "card";
    const customerComment = getCustomerCommentValue();

    const orderPayload = {
        date: new Date().toLocaleString('uz-UZ'),
        phone: finalPhone,
        address: userAddress || "Aniqlanmagan",
        items: JSON.parse(JSON.stringify(cart)),
        distanceKm: selectedDeliveryType === "pickup" ? 0 : Number((currentDistanceKm || 0).toFixed(2)),
        durationMin: selectedDeliveryType === "pickup" ? 0 : Math.max(1, Math.round(currentDurationMin || 0)),
        delivery: deliveryVal,
        total: totalVal,
        userId: currentUser.id,
        email: currentUser.email,
        deliveryType: selectedDeliveryType,
        customerCoords: (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lon))
            ? { lat: Number(userCoords.lat.toFixed(6)), lon: Number(userCoords.lon.toFixed(6)) }
            : null,
        customerMapLink: (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lon))
            ? getYandexRouteUrlFromUserToRestaurant(userCoords.lat, userCoords.lon)
            : "",
        paymentMethod: selectedPaymentMethod,
        paymentProvider: isCardPayment ? "click" : "cash",
        paymentStatus: isCardPayment ? "pending" : "cash",
        customerComment
    };

    setSubmitOrderButtonLoading(true);

    try {
        const response = await fetch(`${API_URL}/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderPayload)
        });

        let payload = {};
        try {
            payload = await response.json();
        } catch (e) {
            payload = {};
        }

        if (!response.ok) {
            const msg = String(payload?.error || "Buyurtma yuborishda xato yuz berdi.");
            alert(msg);
            return;
        }

        const created = payload;
        orders.push(created);
        saveOrders();

        if (isCardPayment) {
            try {
                const clickPayment = await requestClickPaymentUrl(created.id, totalVal, finalPhone);
                alert(`Buyurtmangiz ${created.id} qabul qilindi.\nClick to'lov sahifasi ochiladi.`);
                clearCheckoutStateAfterSubmit();
                window.location.href = clickPayment.paymentUrl;
                return;
            } catch (paymentErr) {
                console.error("Click payment link xatosi:", paymentErr);
                alert(
                    `Buyurtmangiz ${created.id} qabul qilindi.\n` +
                    `Click ulanmadi. To'lovni shu kartaga yuboring:\n${CLICK_RECEIVER_CARD}\n` +
                    `Summa: ${formatMoney(totalVal)}`
                );
                clearCheckoutStateAfterSubmit();
                return;
            }
        }

        alert(`Rahmat! Buyurtmangiz qabul qilindi.\nChek raqami: ${created.id}`);
        renderLiveOrderTracker();
        ensureLiveOrderTimers();
        clearCheckoutStateAfterSubmit();
    } catch (err) {
        console.error("Buyurtmani yuborishda xato:", err);
        alert("Serverga ulanib bo'lmadi. Iltimos, qayta urinib ko'ring.");
    } finally {
        setSubmitOrderButtonLoading(false);
    }
}

// --- JONLI BUYURTMA KUZATUVI (LIVE ORDER TRACKER) ---
let liveOrderExpanded = false;
let liveOrderTicker = null;
let liveOrderPoller = null;

function normalizeStatus(status) {
    return String(status || "").trim().toLowerCase();
}

function getOrderCreatedAtMs(order) {
    const raw = Number(order?.createdAtMs || 0);
    if (Number.isFinite(raw) && raw > 0) return raw;
    const parsed = Date.parse(order?.createdAt || order?.date || "");
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function getOrderPrepMinutes(order) {
    const val = Number(order?.prepMinutes || 0);
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 15;
}

function getFeaturedLiveOrder() {
    const sorted = [...orders].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const active = sorted.find(o => !["yakunlandi", "bekor"].includes(normalizeStatus(o.status)));
    return active || null;
}

function formatRemainingMinutes(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return formatDurationHuman(minutes);
}

function buildLiveOrderItemsMarkup(order) {
    const items = Object.entries(order?.items || {});
    if (!items.length) return "<div>Taomlar topilmadi</div>";
    return items.map(([name, data]) => {
        const qty = Number(data?.quantity || 0) || 1;
        const price = Number(data?.price || 0);
        const itemTotal = price * qty;
        return `
            <div class="live-order-item">
                <div>
                    <strong>${escapeHtml(name)}</strong>
                    <span>${qty} ta</span>
                </div>
                <div class="live-order-item-price">${formatMoney(itemTotal)}</div>
            </div>
        `;
    }).join("");
}

function getOrderItemsSubtotal(order) {
    return Object.values(order?.items || {}).reduce((sum, item) => {
        const price = Number(item?.price || 0);
        const qty = Number(item?.quantity || 0);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
        return sum + (price * qty);
    }, 0);
}

function getLiveOrderView(order, nowMs = Date.now()) {
    const createdAtMs = getOrderCreatedAtMs(order);
    const prepMinutes = getOrderPrepMinutes(order);
    const prepDoneAtMs = createdAtMs + (prepMinutes * 60000);
    const transitMinutes = Math.max(1, Math.round(Number(order?.durationMin || 15)));
    const arrivalAtMs = prepDoneAtMs + (transitMinutes * 60000);
    const status = normalizeStatus(order?.status || "yangi");

    if (status === "bekor") {
        return {
            toneClass: "is-cancelled",
            badge: "Bekor qilindi",
            badgeIcon: "fa-ban",
            title: "Buyurtma bekor qilindi",
            summary: "Buyurtma bekor qilindi. Kerak bo'lsa biz bilan bog'laning.",
            countdownValue: "Bekor",
            progressPercent: 100,
            stepIndex: 0
        };
    }

    if (status === "yakunlandi" || nowMs >= arrivalAtMs) {
        return {
            toneClass: "is-delivered",
            badge: "Yetib keldi",
            badgeIcon: "fa-check-circle",
            title: "Taom yetib keldi",
            summary: "Taom keldi, iltimos to'lov qilib taomni olib qoling.",
            countdownValue: "Yakunlandi",
            progressPercent: 100,
            stepIndex: 2
        };
    }

    if (status === "tayyorlandi" || status === "yolda" || nowMs >= prepDoneAtMs) {
        return {
            toneClass: "is-onway",
            badge: "Yo'lda",
            badgeIcon: "fa-motorcycle",
            title: "Taom yo'lda va kelmoqda",
            summary: "Taom yo'lga chiqdi, kelmoqda.",
            countdownValue: formatRemainingMinutes(arrivalAtMs - nowMs),
            progressPercent: 75,
            stepIndex: 1
        };
    }

    return {
        toneClass: "is-preparing",
        badge: "Tayyorlanmoqda",
        badgeIcon: "fa-fire",
        title: "Taom tayyorlash jarayonida",
        summary: "Buyurtma qabul qilindi, taom tayyorlanmoqda.",
        countdownValue: formatRemainingMinutes(prepDoneAtMs - nowMs),
        progressPercent: 35,
        stepIndex: 0
    };
}

function renderLiveOrderTracker() {
    const host = document.getElementById("liveOrderSection");
    if (!host) return;
    const order = currentUser ? getFeaturedLiveOrder() : null;
    if (!order) {
        host.hidden = true;
        return;
    }

    host.hidden = false;
    const view = getLiveOrderView(order);
    const status = normalizeStatus(order?.status || "");
    const itemsSubtotal = getOrderItemsSubtotal(order);
    const deliveryFee = Number(order?.delivery || 0);
    const totalAmount = Number(order?.total || (itemsSubtotal + deliveryFee));
    const prepMinutes = getOrderPrepMinutes(order);
    const rawTravel = Number(order?.durationMin || 0);
    const travelMinutes = Number.isFinite(rawTravel) && rawTravel > 0 ? Math.round(rawTravel) : 0;
    const totalEtaMinutes = prepMinutes + travelMinutes;
    const totalEtaLabel = totalEtaMinutes > 0 ? formatDurationHuman(totalEtaMinutes) : formatDurationHuman(prepMinutes);
    const courierAssigned = Boolean(order?.courierAssignedId || order?.courierAssigned || order?.courierNotified);
    const canCancel = status === "yangi" && !courierAssigned;
    const steps = [
        { label: "Tayyorlanmoqda", icon: "fa-fire" },
        { label: "Yo'lda", icon: "fa-motorcycle" },
        { label: "Yetib keldi", icon: "fa-check-circle" }
    ];
    const stepMarkup = steps.map((step, idx) => {
        const stateClass = idx < view.stepIndex ? "is-completed" : (idx === view.stepIndex ? "is-active" : "");
        return `
            <div class="live-order-step ${stateClass}">
                <div class="live-order-step-icon"><i class="fas ${step.icon}"></i></div>
                <span>${step.label}</span>
            </div>
        `;
    }).join("");

    if (!liveOrderExpanded) {
        host.innerHTML = `
            <button type="button" class="live-order-launcher" data-action="toggle-live-order">
                <div class="live-order-launcher-copy">
                    <i class="fas ${view.badgeIcon}"></i>
                    <div>
                        <strong>Chekni ko'rish</strong>
                        <span>Chek ${order.id} • ${view.badge} • ${view.countdownValue}</span>
                    </div>
                </div>
                <span class="live-order-launcher-action">Ochish <i class="fas fa-chevron-down"></i></span>
            </button>
        `;
        return;
    }

    host.innerHTML = `
        <div class="live-order-card ${view.toneClass}">
            <div class="live-order-topline">
                <div>
                    <div class="live-order-id-row">
                        <h2>Buyurtma ${order.id}</h2>
                        <span class="live-order-badge"><i class="fas ${view.badgeIcon}"></i> ${view.badge}</span>
                    </div>
                    <p>${view.title}</p>
                </div>
                <button type="button" class="live-order-toggle" data-action="toggle-live-order">
                    Yopish <i class="fas fa-chevron-up"></i>
                </button>
            </div>
            <div class="live-order-hero">
                <div class="live-order-status-copy">
                    <p class="live-order-lead">${view.summary}</p>
                    <div class="live-order-countdown">
                        <span>Qolgan vaqt</span>
                        <strong>${view.countdownValue}</strong>
                    </div>
                </div>
                <div class="live-order-eta-card">
                    <span>Jami vaqt</span>
                    <strong>${totalEtaLabel}</strong>
                    <small>Taom + Yo'l</small>
                </div>
            </div>
            <div class="live-order-track">
                <div class="live-order-track-line">
                    <span style="width:${view.progressPercent}%"></span>
                </div>
                <div class="live-order-steps">${stepMarkup}</div>
            </div>
            <div class="live-order-receipt-panel ${liveOrderExpanded ? "is-open" : ""}">
                <div class="live-order-receipt-inner">
                    <div class="live-order-receipt-head">
                        <div>
                            <h3>Chek va buyurtma</h3>
                            <p>Dastavka raqami: ${order.id}</p>
                        </div>
                        <span class="live-order-receipt-chip">${formatMoney(totalAmount)}</span>
                    </div>
                    <div class="live-order-receipt-grid">
                        <div class="live-order-items">
                            ${buildLiveOrderItemsMarkup(order)}
                        </div>
                        <div class="live-order-receipt-summary">
                            <div class="live-order-summary-row">
                                <span>Taomlar</span>
                                <strong>${formatMoney(itemsSubtotal)}</strong>
                            </div>
                            <div class="live-order-summary-row">
                                <span>Yetkazish</span>
                                <strong>${formatMoney(deliveryFee)}</strong>
                            </div>
                            <div class="live-order-summary-row total">
                                <span>To'lov</span>
                                <strong class="live-order-total-amount">${formatMoney(totalAmount)}</strong>
                            </div>
                            <p class="live-order-summary-note">To'lovni yetkazib beruvchiga topshiring.</p>
                            <div class="live-order-receipt-actions">
                                ${canCancel ? `<button type="button" class="live-order-cancel-btn" data-action="cancel-order" data-order-id="${order.id}">Bekor qilish</button>` : ""}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function cancelLiveOrder(orderId) {
    const id = Number(orderId);
    if (!Number.isFinite(id) || id <= 0) return;
    const confirmed = window.confirm("Buyurtmani bekor qilmoqchimisiz?");
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_URL}/orders/${encodeURIComponent(id)}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "bekor" })
        });
        if (!response.ok) throw new Error("Bekor qilish bajarilmadi");
        const updated = await response.json();
        const idx = orders.findIndex((item) => Number(item?.id) === id);
        if (idx >= 0) {
            orders[idx] = updated;
        } else {
            orders.push(updated);
        }
        saveOrders();
        renderLiveOrderTracker();
    } catch (err) {
        console.error("Buyurtmani bekor qilishda xato:", err);
        alert("Buyurtmani bekor qilishda xato yuz berdi.");
    }
}

function handleLiveOrderPanelClick(event) {
    const cancelButton = event.target.closest("[data-action='cancel-order']");
    if (cancelButton) {
        cancelLiveOrder(cancelButton.dataset.orderId);
        return;
    }
    const toggleButton = event.target.closest("[data-action='toggle-live-order']");
    if (!toggleButton) return;
    liveOrderExpanded = !liveOrderExpanded;
    renderLiveOrderTracker();
}

async function syncCustomerOrdersFromServer(options = {}) {
    if (!currentUser) return;
    const userId = currentUser?.id ? String(currentUser.id) : "";
    const email = currentUser?.email ? String(currentUser.email) : "";
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);
    if (email) params.set("email", email);
    try {
        const response = await fetch(`${API_URL}/orders?${params.toString()}`);
        if (!response.ok) throw new Error("Orders fetch failed");
        const list = await response.json();
        if (Array.isArray(list)) {
            orders = list;
            saveOrders();
            renderLiveOrderTracker();
        }
    } catch (err) {
        if (!options.silent) {
            console.error("Buyurtmalarni yangilashda xato:", err);
        }
    }
}

function ensureLiveOrderTimers() {
    if (liveOrderTicker) return;
    liveOrderTicker = setInterval(() => renderLiveOrderTracker(), 20000);
    if (!liveOrderPoller) {
        liveOrderPoller = setInterval(() => syncCustomerOrdersFromServer({ silent: true }), 15000);
    }
}

// --- 8. ADMIN PANELI FUNKSIYALARI (O'zgarishsiz qoldirildi) ---
function toggleSection(id) {
    document.getElementById('foodForm').style.display = id === 'foodForm' ? 'block' : 'none';
    document.getElementById('editSection').style.display = id === 'editSection' ? 'block' : 'none';
    document.getElementById('ordersSection').style.display = id === 'ordersSection' ? 'block' : 'none';
}

function addFoodToMenu() {
    const name = document.getElementById("foodName").value;
    const price = Number(document.getElementById("foodPrice").value);
    const img = document.getElementById("foodImg").value || "8.jpg";
    const category = document.getElementById("foodCategory").value;

    if (!name || !price) return alert("Nom va narxni kiriting!");

    // Serverga yuborish
    fetch(`${API_URL}/foods`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, price, img, category })
    })
    .then(res => res.json())
    .then(newFood => {
        console.log('вњ… Faol qo\'shildi:', newFood);
        allFoods.push(newFood);
        alert("вњ… Taom qo'shildi va serverda saqlandi!");
        renderFoods(activeCategory);

        // Formani tozalash
        document.getElementById("foodName").value = "";
        document.getElementById("foodPrice").value = "";
        document.getElementById("foodImg").value = "";
    })
    .catch(err => {
        console.error('вќЊ Xato:', err);
        alert('вќЊ Serverga ulanib bo\'lalmadi! Lokal ma\'lumot qo\'shildi.');
        // Fallback to localStorage
        allFoods.push({ name, price, img, category, status: 'active' });
        localStorage.setItem("menuItems", JSON.stringify(allFoods));
        renderFoods(activeCategory);
    });
}

function renderOrders() {
    const list = document.getElementById("ordersList");
    if (!list) return;

    fetch(`${API_URL}/orders`).then(r => r.json()).then(serverOrders => {
        list.innerHTML = serverOrders.length === 0 ? "<p>Buyurtmalar yo'q</p>" : "";
        [...serverOrders].reverse().forEach((o, i) => {
            let itemsList = "";
            for (const [name, data] of Object.entries(o.items)) {
                itemsList += `<div style="display:flex;justify-content:space-between"><span>${name} x${data.quantity}</span><span>${(data.price * data.quantity).toLocaleString()}</span></div>`;
            }

            list.innerHTML += `
                <div class="order-receipt" style="background:#fff;color:#000;padding:15px;margin-bottom:15px;border-radius:5px;font-family:monospace;box-shadow:0 4px 10px rgba(0,0,0,0.3)">
                    <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:10px">
                        <h3 style="margin:0">MANSUR SHASHLIK</h3>
                        <small>CHEK #${o.id} | ${o.date}</small>
                    </div>
                    <div style="padding:10px 0;border-bottom:1px dashed #000">
                        <p style="margin:0"><b>TEL:</b> ${o.phone}</p>
                        <p style="margin:0"><b>MANZIL:</b> ${o.address}</p>
                         <p style="margin:0"><b>MIJOZ:</b> ${o.email || o.userId}</p>
                    </div>
                    <div style="padding:10px 0">
                        ${itemsList}
                    </div>
                    <div style="border-top:1px dashed #000;padding-top:10px;text-align:right">
                        <div>Yetkazish: ${o.delivery.toLocaleString()}</div>
                        <h3 style="margin:0">JAMI: ${o.total.toLocaleString()} so'm</h3>
                    </div>
                </div>`;
        });
    });
}


function closePage() { document.getElementById("secretPage").style.display = "none"; }

function searchFoodForEdit() {
    const q = document.getElementById("adminSearchInput").value.toLowerCase();
    const foodItem = allFoods.find(f => f.name.toLowerCase().includes(q));
    
    if (foodItem) {
        editingFoodId = foodItem.id;
        document.getElementById("editFields").style.display = "block";
        document.getElementById("editName").value = foodItem.name;
        document.getElementById("editPrice").value = foodItem.price;
        document.getElementById("editImg").value = foodItem.img;
        document.getElementById("editStatus").value = foodItem.status;
    } else {
        alert("Topilmadi!");
    }
}

function saveEditedFood() {
    if (!editingFoodId) {
        alert("Avval taomni qidiring!");
        return;
    }

    const status = document.getElementById("editStatus").value;
    const name = document.getElementById("editName").value;
    const price = Number(document.getElementById("editPrice").value);
    const img = document.getElementById("editImg").value;

    if (status === "delete") {
        // O'chirish
        fetch(`${API_URL}/foods/${editingFoodId}`, {
            method: 'DELETE'
        })
        .then(res => {
            if(!res.ok) throw new Error("Serverdan o'chirib bo'lmadi");
            allFoods = allFoods.filter(f => f.id !== editingFoodId);
            alert("вњ… Taom o'chirildi!");
            location.reload();
        })
        .catch(err => {
            console.error('вќЊ Xato:', err);
            alert('вќЊ Serverga ulanib bo\'lalmadi!');
        });
    } else {
        // Yangilash
        fetch(`${API_URL}/foods/${editingFoodId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, price, img, status })
        })
        .then(res => res.json())
        .then(updated => {
            const index = allFoods.findIndex(f => f.id === editingFoodId);
            if (index > -1) allFoods[index] = updated;
            alert("вњ… Taom yangilandi!");
            location.reload();
        })
        .catch(err => {
            console.error('вќЊ Xato:', err);
            alert('вќЊ Serverga ulanib bo\'lalmadi!');
        });
    }
}

function toggleSection(sectionId) {
    // Hammasini yopish
    document.getElementById('foodForm').style.display = 'none';
    document.getElementById('editSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    
    // Tanlanganini ochish
    const target = document.getElementById(sectionId);
    if (target) {
        target.style.display = 'block';
    }
    
    // Agar buyurtmalar bo'limi ochilsa, buyurtmalarni yuklash
    if (sectionId === 'ordersSection') {
        loadOrdersFromServer();
    }
}
async function loadOrdersFromServer() {
    try {
        const response = await fetch(`${API_URL}/orders`); // server.js dagi endpoint
        const orders = await response.json();
        const ordersList = document.getElementById('ordersList');
        ordersList.innerHTML = '';

        orders.reverse().forEach(order => {
            const card = document.createElement('div');
            card.className = 'order-card'; // CSS dagi styllar bilan
            card.innerHTML = `
                <div class="order-header">
                    <span><b>Sana:</b> ${order.date}</span>
                    <span><b>ID:</b> #${order.id.toString().slice(-5)}</span>
                </div>
                <p><b>Tel:</b> ${order.phone}</p>
                <p><b>Manzil:</b> ${order.address}</p>
                <div class="order-items">
                    ${Object.keys(order.items).map(name => `<div>${name} x ${order.items[name].quantity}</div>`).join('')}
                </div>
                <div class="order-total">Jami: ${order.total.toLocaleString()} so'm</div>
            `;
            ordersList.appendChild(card);
        });
    } catch (err) {
        console.error("Buyurtmalarni yuklashda xato:", err);
    }
}
