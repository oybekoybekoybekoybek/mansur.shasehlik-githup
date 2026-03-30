﻿﻿﻿﻿﻿const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');

// Google OAuth credentials: trim space characters to avoid TokenError
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET').trim();

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CALLBACK_URL = (process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`).trim();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim() || 'gemini-1.5-flash';
const GEMINI_COOLDOWN_MS = 1000 * 60 * 15;
const GEMINI_DISABLE_MS = 1000 * 60 * 60 * 6;
let geminiCooldownUntil = 0;
let geminiDisabledUntil = 0;
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 10;
const DISTANCE_CACHE_TTL_MS = 1000 * 60 * 3;
const locationCache = new Map();
const distanceCache = new Map();
const NOMINATIM_LOG_INTERVAL_MS = 1000 * 60 * 5;
const nominatimLogState = { lastAt: 0, mutedCount: 0 };
const CLICK_SERVICE_ID = (process.env.CLICK_SERVICE_ID || '').trim();
const CLICK_MERCHANT_ID = (process.env.CLICK_MERCHANT_ID || '').trim();
const CLICK_RETURN_URL = (process.env.CLICK_RETURN_URL || `http://localhost:${PORT}/`).trim();
const CLICK_RECEIVER_CARD = (process.env.CLICK_RECEIVER_CARD || '4073420072137304').trim();
const CLICK_PAYMENT_BASE_URL = 'https://my.click.uz/services/pay';
const REMEMBER_COOKIE_NAME = 'remember_token';
const REMEMBER_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365; // 1 yil
const LEGACY_TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '8546744167:AAFrwrMQmGkrBFyxq-nIGrpbPEGSoSbvv80').replace(/\s+/g, '').trim();
const TELEGRAM_ADMIN_BOT_TOKEN = String(process.env.TELEGRAM_ADMIN_BOT_TOKEN || '8675459119:AAHeB2wPAdkc3tq3UHuG9Fy-nm-LfV4iPkM').replace(/\s+/g, '').trim();
const TELEGRAM_ADMIN_PASSWORD = (process.env.TELEGRAM_ADMIN_PASSWORD || 'nasim').trim();
const TELEGRAM_COURIER_PASSWORD = (process.env.TELEGRAM_COURIER_PASSWORD || 'aaa').trim();
const TELEGRAM_POLL_INTERVAL_MS = Math.max(2500, Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 4000));
const COURIER_AUTO_DELAY_MINUTES = 15;
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 12000;
const REMOTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const REMOTE_IMAGE_MAX_REDIRECTS = 3;
const ENV_RESTAURANT_LAT = Number(process.env.RESTAURANT_LAT);
const ENV_RESTAURANT_LON = Number(process.env.RESTAURANT_LON);
const DEFAULT_RESTAURANT_COORDS = {
    lat: Number.isFinite(ENV_RESTAURANT_LAT) ? ENV_RESTAURANT_LAT : 39.6594851,
    lon: Number.isFinite(ENV_RESTAURANT_LON) ? ENV_RESTAURANT_LON : 66.9730740
};
const DEFAULT_RESTAURANT_NAME = String(process.env.RESTAURANT_NAME || 'Mansur Shashlik').trim() || 'Mansur Shashlik';
const DEFAULT_RESTAURANT_ADDRESS = String(process.env.RESTAURANT_ADDRESS || 'Самарканд, ул. Имома Ал-Бухорий, 185').trim() || 'Самарканд, ул. Имома Ал-Бухорий, 185';
const RESTAURANT_COORDS = { lat: DEFAULT_RESTAURANT_COORDS.lat, lon: DEFAULT_RESTAURANT_COORDS.lon };
const DEBUG_AUTH = String(process.env.DEBUG_AUTH || '').trim() === '1';
const DEBUG_NOMINATIM = String(process.env.DEBUG_NOMINATIM || '').trim() === '1';

function authDebugLog(...args) {
    if (!DEBUG_AUTH) return;
    console.log(...args);
}

function isClickConfigured() {
    return Boolean(CLICK_SERVICE_ID && CLICK_MERCHANT_ID);
}

function createRememberToken() {
    return crypto.randomBytes(24).toString('hex');
}

function getCookieValue(cookieHeader, name) {
    const source = String(cookieHeader || '');
    if (!source) return '';
    const parts = source.split(';');
    for (const part of parts) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) return decodeURIComponent(rest.join('='));
    }
    return '';
}

function ensureRememberToken(user) {
    if (!user || !user.id) return '';
    if (user.rememberToken) return user.rememberToken;

    const users = readUsers();
    const idx = users.findIndex(u => String(u.id) === String(user.id));
    if (idx === -1) return '';

    users[idx].rememberToken = createRememberToken();
    saveUsers(users);
    user.rememberToken = users[idx].rememberToken;
    return users[idx].rememberToken;
}

function extractJsonObject(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (e) {
        return null;
    }
}

function parseDurationMinutesFromText(timeText) {
    const text = String(timeText || '').toLowerCase();
    if (!text) return null;

    let total = 0;
    const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(soat|hour|hours|h)/);
    const minMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(daqiqa|min|minutes|m)/);

    if (hourMatch) total += Number(hourMatch[1].replace(',', '.')) * 60;
    if (minMatch) total += Number(minMatch[1].replace(',', '.'));

    if (total > 0) return total;
    const plain = Number(text.replace(',', '.'));
    return Number.isFinite(plain) && plain > 0 ? plain : null;
}

function parseDistanceKmFromText(text) {
    const value = String(text || '');
    if (!value) return null;

    const kmMatch = value.match(/(\d+(?:[.,]\d+)?)\s*km/i);
    if (kmMatch) {
        const km = Number(kmMatch[1].replace(',', '.'));
        if (Number.isFinite(km) && km > 0) return km;
    }

    const meterMatch = value.match(/(\d+(?:[.,]\d+)?)\s*(m|metr|meter|meters)\b/i);
    if (meterMatch) {
        const meters = Number(meterMatch[1].replace(',', '.'));
        if (Number.isFinite(meters) && meters > 0) return meters / 1000;
    }

    return null;
}

function formatDistanceText(distanceKm) {
    const km = Number(distanceKm || 0);
    if (!Number.isFinite(km) || km <= 0) return '';
    if (km < 1) {
        const meters = Math.max(1, Math.round(km * 1000));
        return `${meters} m`;
    }
    return `${km.toFixed(1)} km`;
}

function formatDurationText(durationMin) {
    const minutes = Math.max(1, Math.round(Number(durationMin || 0)));
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} soat ${mins} min` : `${hours} soat`;
}

function isGeminiConfigured() {
    return Boolean(GEMINI_API_KEY);
}

function isGeminiCooldownActive() {
    return Boolean(GEMINI_API_KEY) && Date.now() < geminiCooldownUntil;
}

function isGeminiDisabled() {
    return Date.now() < geminiDisabledUntil;
}

function isGeminiReady() {
    if (!isGeminiConfigured()) return false;
    if (isGeminiCooldownActive()) return false;
    if (isGeminiDisabled()) return false;
    return true;
}

function setGeminiCooldown(reason, status) {
    geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
    const debug = String(process.env.DEBUG_GEMINI || '').trim();
    if (debug) {
        const label = reason ? ` (${reason})` : '';
        const statusText = status ? ` status=${status}` : '';
        console.warn(`Gemini cooldown yoqildi${label}${statusText}. ${Math.round(GEMINI_COOLDOWN_MS / 60000)} daqiqa kuting.`);
    }
}

function setGeminiDisabled(reason, status) {
    geminiDisabledUntil = Date.now() + GEMINI_DISABLE_MS;
    const debug = String(process.env.DEBUG_GEMINI || '').trim();
    if (debug) {
        const label = reason ? ` (${reason})` : '';
        const statusText = status ? ` status=${status}` : '';
        console.warn(`Gemini vaqtincha o'chirildi${label}${statusText}. ${Math.round(GEMINI_DISABLE_MS / 60000)} daqiqa kuting.`);
    }
}

function buildCoordCacheKey(lat, lon) {
    return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
}

function getCachedLocation(lat, lon) {
    const key = buildCoordCacheKey(lat, lon);
    const cached = locationCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.savedAt > LOCATION_CACHE_TTL_MS) {
        locationCache.delete(key);
        return null;
    }
    return cached;
}

function setCachedLocation(lat, lon, payload) {
    const key = buildCoordCacheKey(lat, lon);
    locationCache.set(key, {
        address: String(payload?.address || '').trim(),
        source: String(payload?.source || 'nominatim'),
        savedAt: Date.now()
    });
}

function buildDistanceCacheKey(fromLat, fromLon, toLat, toLon) {
    return `${Number(fromLat).toFixed(5)},${Number(fromLon).toFixed(5)}|${Number(toLat).toFixed(5)},${Number(toLon).toFixed(5)}`;
}

function getCachedDistance(fromLat, fromLon, toLat, toLon) {
    const key = buildDistanceCacheKey(fromLat, fromLon, toLat, toLon);
    const cached = distanceCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.savedAt > DISTANCE_CACHE_TTL_MS) {
        distanceCache.delete(key);
        return null;
    }
    return cached;
}

function setCachedDistance(fromLat, fromLon, toLat, toLon, payload) {
    const key = buildDistanceCacheKey(fromLat, fromLon, toLat, toLon);
    distanceCache.set(key, {
        ...payload,
        savedAt: Date.now()
    });
}

function logNominatimIssue(context, err) {
    if (!DEBUG_NOMINATIM) return;
    const message = String(err?.message || err || 'noma`lum xato');
    const now = Date.now();
    const elapsed = now - Number(nominatimLogState.lastAt || 0);
    if (elapsed >= NOMINATIM_LOG_INTERVAL_MS) {
        const muted = Number(nominatimLogState.mutedCount || 0);
        nominatimLogState.lastAt = now;
        nominatimLogState.mutedCount = 0;
        const repeated = muted > 0 ? ` (+${muted} marta qaytarildi)` : '';
        console.warn(`Nominatim ${context} vaqtincha ishlamadi: ${message}${repeated}. Fallback ishlatildi.`);
        return;
    }
    nominatimLogState.mutedCount = Number(nominatimLogState.mutedCount || 0) + 1;
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getOsrmRouteInfo(fromLat, fromLon, toLat, toLon) {
    try {
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`
        );
        if (!response.ok) return null;

        const data = await response.json();
        const route = data?.routes?.[0];
        const distanceKm = Number(route?.distance) / 1000;
        const durationMin = Number(route?.duration) / 60;
        if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;

        return {
            distanceKm,
            durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : null,
            provider: 'osrm',
            confidence: 0.82,
            sanityAdjusted: false
        };
    } catch (err) {
        return null;
    }
}

function getStraightLineFallbackInfo(fromLat, fromLon, toLat, toLon) {
    const straightKmRaw = haversineKm(fromLat, fromLon, toLat, toLon);
    if (!Number.isFinite(straightKmRaw)) return null;
    const straightKm = Math.max(0.05, straightKmRaw);

    const roadFactor = straightKm < 0.8 ? 2.4 : (straightKm < 2 ? 1.6 : 1.45);
    const minRoadKm = Math.max(straightKm * 0.9, 0.15);
    const maxRoadKm = Math.max(straightKm * 2.2, straightKm + 0.8);

    let distanceKm = straightKm * roadFactor;
    distanceKm = Math.min(maxRoadKm, Math.max(minRoadKm, distanceKm));
    distanceKm = Number(distanceKm.toFixed(3));

    const durationMin = Math.max(1, Math.round((distanceKm / 28) * 60));
    return {
        distanceKm,
        durationMin,
        provider: 'haversine',
        confidence: 0.35,
        sanityAdjusted: true
    };
}

async function getGoogleDistanceInfo(fromLat, fromLon, toLat, toLon) {
    if (!GOOGLE_MAPS_API_KEY) return null;
    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${fromLat},${fromLon}&destinations=${toLat},${toLon}&mode=driving&units=metric&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        const el = data?.rows?.[0]?.elements?.[0];
        if (!el || el.status !== 'OK') return null;
        return {
            distanceKm: el.distance.value / 1000,
            durationMin: el.duration.value / 60,
            provider: 'google',
            confidence: 0.9,
            sanityAdjusted: false
        };
    } catch (err) {
        return null;
    }
}

function sanitizeRouteInfo(info, straightKm) {
    if (!info) return null;
    const baseStraight = Number(straightKm || 0);
    let distanceKm = Number(info.distanceKm || 0);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;

    if (Number.isFinite(baseStraight) && baseStraight > 0) {
        const tiny = baseStraight <= 0.2;
        const ratio = distanceKm / baseStraight;
        if (tiny && distanceKm > 1) {
            distanceKm = baseStraight;
        } else if (ratio > 8 && baseStraight < 1) {
            distanceKm = baseStraight;
        }
    }

    let durationMin = Number(info.durationMin || 0);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
        durationMin = Math.max(1, Math.round((distanceKm / 20) * 60));
    }
    const distanceText = String(info?.distanceText || info?.distance_text || '').trim()
        || formatDistanceText(distanceKm);
    const durationText = String(info?.durationText || info?.duration_text || '').trim()
        || formatDurationText(durationMin);

    return {
        ...info,
        distanceKm: Number(distanceKm.toFixed(3)),
        durationMin: Math.max(1, Math.round(durationMin)),
        distanceText,
        durationText
    };
}

async function getDistanceFallbackInfo(fromLat, fromLon, toLat, toLon) {
    const osrm = await getOsrmRouteInfo(fromLat, fromLon, toLat, toLon);
    if (osrm) return osrm;
    return getStraightLineFallbackInfo(fromLat, fromLon, toLat, toLon);
}

async function getGeminiDistanceInfo(fromLat, fromLon, toLat, toLon) {
    if (!isGeminiReady()) return null;

    const prompt = [
        "Vazifa: restoran va foydalanuvchi koordinatalari orasidagi avtomobil (driving) yo'l masofasi va vaqtini aniqlang.",
        "Qoidalar:",
        "1) Faqat JSON qaytaring.",
        "2) JSON format: {\"distance_km\": number, \"duration_min\": number, \"distance_text\": \"0.8 km\", \"duration_text\": \"12 min\"}.",
        "3) distance_text: agar masofa 1 km dan kichik bo'lsa metrda yozing (masalan \"450 m\").",
        "4) duration_text: 60 minutdan kichik bo'lsa minutda, katta bo'lsa soatda yozing (masalan \"1 soat 10 min\").",
        `Restoran koordinatasi: ${Number(fromLat).toFixed(6)}, ${Number(fromLon).toFixed(6)}`,
        `Foydalanuvchi koordinatasi: ${Number(toLat).toFixed(6)}, ${Number(toLon).toFixed(6)}`
    ].join("\n");

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 120
                    }
                })
            }
        );

        if (!response.ok) {
            if (response.status === 429) {
                setGeminiCooldown('distance', response.status);
                return null;
            }
            if (response.status === 404) {
                setGeminiDisabled('distance', response.status);
                return null;
            }
            throw new Error(`Gemini API status ${response.status}`);
        }

        const payload = await response.json();
        const text = String(
            payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join(' ').trim() || ''
        );
        if (!text) return null;

        const parsed = extractJsonObject(text);
        let distanceKm = Number(parsed?.distance_km ?? parsed?.distanceKm ?? parsed?.distance ?? 0);
        if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
            distanceKm = Number(parseDistanceKmFromText(text) || 0);
        }
        let durationMin = Number(parsed?.duration_min ?? parsed?.durationMin ?? parsed?.duration ?? 0);
        if (!Number.isFinite(durationMin) || durationMin <= 0) {
            durationMin = Number(parseDurationMinutesFromText(text) || 0);
        }

        if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
        const distanceText = String(parsed?.distance_text || parsed?.distanceText || '').trim()
            || formatDistanceText(distanceKm);
        const durationText = String(parsed?.duration_text || parsed?.durationText || '').trim()
            || formatDurationText(durationMin);

        return {
            distanceKm,
            durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : null,
            distanceText,
            durationText,
            provider: 'gemini',
            confidence: 0.55,
            sanityAdjusted: false
        };
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('status 429') && !msg.includes('status 404')) {
            console.log('Gemini distance error:', err.message);
        }
        return null;
    }
}

async function getSmartDistanceInfo(fromLat, fromLon, toLat, toLon) {
    const cached = getCachedDistance(fromLat, fromLon, toLat, toLon);
    if (cached) return cached;

    const straight = haversineKm(fromLat, fromLon, toLat, toLon);

    const gemini = await getGeminiDistanceInfo(fromLat, fromLon, toLat, toLon);
    const geminiSafe = sanitizeRouteInfo(gemini, straight);
    if (geminiSafe) {
        setCachedDistance(fromLat, fromLon, toLat, toLon, geminiSafe);
        return geminiSafe;
    }

    const osrm = await getOsrmRouteInfo(fromLat, fromLon, toLat, toLon);
    const osrmSafe = sanitizeRouteInfo(osrm, straight);
    if (osrmSafe) {
        setCachedDistance(fromLat, fromLon, toLat, toLon, osrmSafe);
        return osrmSafe;
    }

    const fallback = await getStraightLineFallbackInfo(fromLat, fromLon, toLat, toLon);
    const fallbackSafe = sanitizeRouteInfo(fallback, straight);
    if (fallbackSafe) setCachedDistance(fromLat, fromLon, toLat, toLon, fallbackSafe);
    return fallbackSafe;
}

function isHttpUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

function decodeUrlValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch (err) {
        return raw;
    }
}

function normalizeKnownImageWrapperUrl(rawUrl) {
    const input = String(rawUrl || '').trim();
    if (!isHttpUrl(input)) return input;

    try {
        const parsed = new URL(input);
        const host = String(parsed.hostname || '').toLowerCase();

        const explicitParams = ['imgurl', 'image_url', 'mediaurl'];
        for (const key of explicitParams) {
            const value = decodeUrlValue(parsed.searchParams.get(key));
            if (isHttpUrl(value)) return value;
        }

        const redirectHosts = (
            host.includes('google.') ||
            host === 'l.facebook.com' ||
            host.endsWith('.facebook.com') ||
            host.endsWith('t.me') ||
            host.includes('telegram.')
        );
        if (redirectHosts) {
            const redirected = decodeUrlValue(parsed.searchParams.get('url') || parsed.searchParams.get('u'));
            if (isHttpUrl(redirected)) return redirected;
        }

        return parsed.toString();
    } catch (err) {
        return input;
    }
}

function ensureUploadsDir() {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function resolveUrlFromBase(baseUrl, value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('//')) return `https:${raw}`;
    try {
        return new URL(raw, baseUrl).toString();
    } catch (err) {
        return '';
    }
}

function extractImageUrlFromHtml(html, baseUrl) {
    const source = String(html || '');
    if (!source) return '';

    const patterns = [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<img[^>]+src=["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (!match || !match[1]) continue;
        const resolved = resolveUrlFromBase(baseUrl, decodeUrlValue(match[1]));
        if (isHttpUrl(resolved)) {
            return normalizeKnownImageWrapperUrl(resolved);
        }
    }

    return '';
}

function getImageExtension(mimeType, urlValue) {
    const mime = String(mimeType || '').toLowerCase();
    const byMime = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg',
        'image/avif': '.avif'
    };

    if (byMime[mime]) return byMime[mime];

    try {
        const parsed = new URL(String(urlValue || ''));
        const ext = String(path.extname(parsed.pathname || '') || '').toLowerCase();
        if (/^\.(jpg|jpeg|png|webp|gif|bmp|svg|avif)$/.test(ext)) {
            return ext === '.jpeg' ? '.jpg' : ext;
        }
    } catch (err) {}

    return '.jpg';
}

async function fetchRemoteImagePayload(initialUrl, depth = 0) {
    if (depth > REMOTE_IMAGE_MAX_REDIRECTS) return null;

    const candidateUrl = normalizeKnownImageWrapperUrl(initialUrl);
    if (!isHttpUrl(candidateUrl)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_IMAGE_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(candidateUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MansurShashlikBot/1.0; +http://localhost)',
                'Accept': 'image/*,text/html;q=0.9,*/*;q=0.8'
            }
        });
        if (!response.ok) return null;

        const contentTypeRaw = String(response.headers.get('content-type') || '').toLowerCase();
        const contentType = contentTypeRaw.split(';')[0].trim();
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > REMOTE_IMAGE_MAX_BYTES) {
            return null;
        }

        const finalUrl = String(response.url || candidateUrl);
        if (contentType.startsWith('image/')) {
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.length <= 0 || buffer.length > REMOTE_IMAGE_MAX_BYTES) return null;
            return {
                buffer,
                mimeType: contentType,
                finalUrl
            };
        }

        if (!contentType || contentType.includes('text/html')) {
            const html = await response.text();
            const extracted = extractImageUrlFromHtml(html, finalUrl);
            if (!extracted || extracted === candidateUrl) return null;
            return fetchRemoteImagePayload(extracted, depth + 1);
        }

        return null;
    } catch (err) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function importRemoteImageToUploads(rawUrl) {
    const payload = await fetchRemoteImagePayload(rawUrl, 0);
    if (!payload?.buffer) return '';

    const uploadsDir = ensureUploadsDir();
    const ext = getImageExtension(payload.mimeType, payload.finalUrl);
    const filename = `food-remote-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const fullPath = path.join(uploadsDir, filename);
    await fs.promises.writeFile(fullPath, payload.buffer);
    return `/uploads/${filename}`;
}

async function normalizeFoodImageReference(rawImg) {
    const value = String(rawImg || '').trim();
    if (!value) return '';

    const normalized = normalizeKnownImageWrapperUrl(value);
    if (!isHttpUrl(normalized)) return normalized;

    const imported = await importRemoteImageToUploads(normalized);
    return imported || normalized;
}

// --- MULTER SOZLAMALARI (RASM YUKLASH) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, 'food-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// Uploads papkasini statik qilish
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Quick debug output (safe: show only start of client id)
if (GOOGLE_CLIENT_ID) {
    console.log('Using GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID.length > 30 ? GOOGLE_CLIENT_ID.slice(0,30) + '...' : GOOGLE_CLIENT_ID);
}

// Detect placeholder credentials. If placeholders exist, Google OAuth routes return config error.
const looksLikePlaceholder = (s) => !s || /your[_-]?google|YOUR_GOOGLE|your-google-client|your-google-client-id|paste[_-]?your|PASTE[_-]?YOUR/i.test(s);
const GOOGLE_OAUTH_ENABLED = !(looksLikePlaceholder(GOOGLE_CLIENT_ID) || looksLikePlaceholder(GOOGLE_CLIENT_SECRET));
if (!GOOGLE_OAUTH_ENABLED) {
    console.warn('\nвљ пёЏ Google OAuth credentials look like placeholders. Google OAuth will be disabled.');
    console.warn('Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to enable sign-in.');
}

if (!isClickConfigured()) {
    console.warn('CLICK payment disabled: set CLICK_SERVICE_ID and CLICK_MERCHANT_ID in .env');
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Sessiya va Passport route'lardan oldin bo'lishi shart
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 kun
        sameSite: 'lax',
        httpOnly: true
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Serve static files (html, css, js) from the project root directory.
// This will automatically serve index.html for '/' requests.
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        if (/\.(html|js|css)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Admin sahifasi uchun alohida route'lar
// This ensures that visiting /admin serves the admin.html page.
app.get('/admin', (req, res) => {
    return res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/auth/manual-gmail', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email manzili talab qilinadi.' });
    }
    if (!email.toLowerCase().endsWith('@gmail.com')) {
        return res.status(400).json({ message: 'Faqat @gmail.com manzili qabul qilinadi.' });
    }

    let users = readUsers();
    let user = users.find(u => u.email === email);

    if (user) {
        // Agar foydalanuvchi mavjud bo'lsa, rememberToken yangilash
        user.rememberToken = ensureRememberToken(user);
        saveUsers(users);
        return res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, rememberToken: user.rememberToken } });
    } else {
        // Yangi foydalanuvchi yaratish
        const newUser = {
            id: Date.now(),
            email: email,
            displayName: email.split('@')[0], // Emailning birinchi qismini displayName sifatida ishlatish
            rememberToken: createRememberToken()
        };
        users.push(newUser);
        saveUsers(users);
        return res.status(201).json({ user: { id: newUser.id, email: newUser.email, displayName: newUser.displayName, rememberToken: newUser.rememberToken } });
    }
});

// Session yo'qolgan bo'lsa ham remember cookie orqali avtomatik tiklash.
app.use((req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }

    const rememberToken = getCookieValue(req.headers.cookie, REMEMBER_COOKIE_NAME);
    if (!rememberToken) {
        return next();
    }

    const users = readUsers();
    const user = users.find(u => u.rememberToken === rememberToken);

    if (!user) {
        res.clearCookie(REMEMBER_COOKIE_NAME);
        return next();
    }

    req.login(user, (err) => {
        if (err) {
            return next(err);
        }

        const newRememberToken = createRememberToken();
        
        // Users array'dagi user'ni to'g'ri indeks bilan update qilish
        const userIndex = users.findIndex(u => String(u.id) === String(user.id));
        if (userIndex !== -1) {
            users[userIndex].rememberToken = newRememberToken;
            saveUsers(users);
        }

        res.cookie(REMEMBER_COOKIE_NAME, newRememberToken, { maxAge: REMEMBER_COOKIE_MAX_AGE, httpOnly: true, sameSite: 'lax' });

        return next();
    });
});

// Database fayllari
const DB_FILE = path.join(__dirname, 'foods_db.json');
const USERS_FILE = path.join(__dirname, 'users_db.json');
const ORDERS_FILE = path.join(__dirname, 'orders_db.json');
const BOT_SETTINGS_FILE = path.join(__dirname, 'bot_settings.json');
const SITE_STATE_FILE = path.join(__dirname, 'site_state.json');
const SITE_SETTINGS_FILE = path.join(__dirname, 'site_settings.json');
const DEFAULT_SITE_CATEGORIES = [];

// Passport strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL,
    proxy: true,
    passReqToCallback: true
},
function(req, accessToken, refreshToken, profile, done) {
    // Bu funksiya Google tomonidan muvaffaqiyatli autentifikatsiyadan so'ng ishga tushadi
    // Foydalanuvchini database'da qidiramiz yoki yangi foydalanuvchi yaratamiz
    try {
        const users = readUsers();
        const email = (profile.emails && profile.emails[0] && profile.emails[0].value) ? profile.emails[0].value : '';

        // Faqat @gmail.com hisoblari qabul qilinadi
        if (!email.toLowerCase().endsWith('@gmail.com')) {
            return done(null, false, { message: 'Only @gmail.com accounts allowed' });
        }

        const userIndex = users.findIndex(u => u.googleId === profile.id || u.email === email);
        if (userIndex !== -1) {
            let user = users[userIndex];
            // Ism yoki rasm yo'q bo'lsa yangilab qo'yamiz
            let changed = false;
            if (!user.googleId) { user.googleId = profile.id; changed = true; }
            if (!user.displayName && profile.displayName) { user.displayName = profile.displayName; changed = true; }
            if (!user.photo && profile.photos?.[0]?.value) { user.photo = profile.photos[0].value; changed = true; }
            if (!user.rememberToken) { user.rememberToken = createRememberToken(); changed = true; }

            if (changed) {
                saveUsers(users);
            }
            return done(null, user);
        }

        const newUser = {
            id: Date.now(),
            googleId: profile.id,
            displayName: profile.displayName || email.split('@')[0],
            email: email,
            photo: (profile.photos && profile.photos[0] && profile.photos[0].value) ? profile.photos[0].value : '',
            rememberToken: createRememberToken()
        };
        users.push(newUser);
        saveUsers(users);
        return done(null, newUser);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const users = readUsers();
    const user = users.find(u => String(u.id) === String(id));
    done(null, user);
});


// Faollarni o'qish
function readFoods() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Database o\'qish xatosi:', err);
    }
    return [];
}

// Faollarni saqlash
function saveFoods(foods) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(foods, null, 2), 'utf8');
    } catch (err) {
        console.error('Database saqlash xatosi:', err);
    }
}

function readUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) { console.error('Users read error:', err); }
    return [];
}

function saveUsers(u) {
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2), 'utf8'); } catch (e) { console.error(e); }
}

function readOrders() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const data = fs.readFileSync(ORDERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) { console.error('Orders read error:', err); }
    return [];
}

function saveOrders(o) {
    try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { console.error(e); }
}

function normalizeOrderIds(orders) {
    if (!Array.isArray(orders)) return false;
    let changed = false;
    const users = readUsers();
    for (let i = 0; i < orders.length; i += 1) {
        const expectedId = i + 1;
        if (Number(orders[i]?.id) !== expectedId) {
            orders[i].id = expectedId;
            changed = true;
        }
        const status = String(orders[i]?.status || '').trim().toLowerCase();
        if (!status) {
            orders[i].status = 'yangi';
            changed = true;
        }

        const createdAtMs = parseOrderDateToMs(orders[i]);
        if (createdAtMs > 0 && Number(orders[i]?.createdAtMs || 0) !== createdAtMs) {
            orders[i].createdAtMs = createdAtMs;
            changed = true;
        }
        if (createdAtMs > 0 && !orders[i]?.createdAt) {
            orders[i].createdAt = new Date(createdAtMs).toISOString();
            changed = true;
        }

        const deliveryType = normalizeDeliveryType(
            orders[i]?.deliveryType || (Number(orders[i]?.delivery || 0) > 0 ? 'home' : 'pickup')
        );
        if (String(orders[i]?.deliveryType || '') !== deliveryType) {
            orders[i].deliveryType = deliveryType;
            changed = true;
        }

        const existingRegion = String(orders[i]?.customerRegion || '').trim();
        if (!existingRegion || !detectUzbekRegionLabel(existingRegion)) {
            const inferredRegion = extractRegionFromAddress(orders[i]?.address || '');
            if (inferredRegion !== existingRegion) {
                orders[i].customerRegion = inferredRegion;
                changed = true;
            }
        }

        if (!String(orders[i]?.customerName || '').trim()) {
            const orderUserId = String(orders[i]?.userId || '').trim();
            const orderEmail = String(orders[i]?.email || '').trim().toLowerCase();
            const orderPhone = String(orders[i]?.phone || '').trim();
            const linkedUser = users.find((user) => {
                const sameId = orderUserId && String(user?.id || '').trim() === orderUserId;
                const sameEmail = orderEmail && String(user?.email || '').trim().toLowerCase() === orderEmail;
                const samePhone = orderPhone && String(user?.phone || '').trim() === orderPhone;
                return sameId || sameEmail || samePhone;
            });
            const displayName = String(linkedUser?.displayName || '').trim();
            if (displayName) {
                orders[i].customerName = displayName;
                changed = true;
            }
        }

        if (normalizeOrderCoords(orders[i]?.customerCoords)) {
            const coords = normalizeOrderCoords(orders[i]?.customerCoords);
            if (JSON.stringify(coords) !== JSON.stringify(orders[i]?.customerCoords || null)) {
                orders[i].customerCoords = coords;
                changed = true;
            }
        }

        if (orders[i]?.paymentCollected !== true) {
            const collected = isPaymentCollected(orders[i]);
            if (Boolean(orders[i]?.paymentCollected) !== collected) {
                orders[i].paymentCollected = collected;
                changed = true;
            }
        }
    }
    return changed;
}

function isLocalRequest(req) {
    const raw = String(req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '');
    const ip = raw.split(',')[0].trim();
    return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.0.0.1');
}

function normalizeTelegramToken(token) {
    return String(token || '').replace(/\s+/g, '').trim();
}

function resolveTelegramToken(_botKind, settings) {
    const stored = settings?.adminBotToken;
    const fallback = TELEGRAM_ADMIN_BOT_TOKEN || LEGACY_TELEGRAM_BOT_TOKEN;
    const normalizedStored = normalizeTelegramToken(stored);
    return normalizedStored || normalizeTelegramToken(fallback);
}

function resolveTelegramAdminPassword(settings) {
    const stored = String(settings?.telegramAdminPassword || '').trim();
    return stored || TELEGRAM_ADMIN_PASSWORD;
}

function createDefaultBotSettings() {
    return {
        enabled: false,
        adminChatId: '',
        adminLastUpdateId: 0,
        adminBotToken: '',
        adminTokenFingerprint: '',
        telegramAdminPassword: '',
        couriers: [],
        updatedAt: new Date().toISOString()
    };
}

function uniqueNonEmptyStrings(values) {
    const result = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
    });
    return result;
}

function normalizeCourierLabel(value, fallbackId) {
    const label = String(value || '').trim();
    return label || String(fallbackId || '').trim();
}

function normalizeCourierList(rawCouriers) {
    const list = [];
    const usedIds = new Set();
    const usedPasswords = new Set();
    let nextId = 1;
    const claimNextId = () => {
        while (usedIds.has(nextId)) nextId += 1;
        const id = nextId;
        usedIds.add(id);
        nextId += 1;
        return id;
    };

    (Array.isArray(rawCouriers) ? rawCouriers : []).forEach((entry) => {
        const password = String(entry?.password || '').trim();
        if (!password) return;
        const passwordKey = password.toLowerCase();
        if (usedPasswords.has(passwordKey)) return;

        const candidateId = Number(entry?.id);
        const id = Number.isFinite(candidateId) && candidateId > 0 && !usedIds.has(candidateId)
            ? candidateId
            : claimNextId();
        usedIds.add(id);
        usedPasswords.add(passwordKey);

        const chatId = entry?.chatId ? String(entry.chatId) : '';
        const createdAt = entry?.createdAt ? String(entry.createdAt) : new Date().toISOString();
        const connectedAt = entry?.connectedAt
            ? String(entry.connectedAt)
            : (chatId ? new Date().toISOString() : '');

        list.push({
            id,
            label: normalizeCourierLabel(entry?.label || entry?.name, id),
            password,
            chatId,
            createdAt,
            connectedAt
        });
    });

    return list;
}

function getNextCourierId(couriers) {
    const ids = (Array.isArray(couriers) ? couriers : [])
        .map((c) => Number(c?.id || 0))
        .filter((id) => Number.isFinite(id) && id > 0);
    const maxId = ids.length ? Math.max(...ids) : 0;
    return maxId + 1;
}

function findCourierByChatId(settings, chatId) {
    const key = String(chatId || '').trim();
    if (!key) return null;
    const couriers = Array.isArray(settings?.couriers) ? settings.couriers : [];
    return couriers.find((courier) => String(courier?.chatId || '') === key) || null;
}

function findCourierByPassword(settings, password) {
    const pass = String(password || '').trim();
    if (!pass) return null;
    const couriers = Array.isArray(settings?.couriers) ? settings.couriers : [];
    return couriers.find((courier) => String(courier?.password || '') === pass) || null;
}

function getConnectedCouriers(settings) {
    const couriers = Array.isArray(settings?.couriers) ? settings.couriers : [];
    const seenChatIds = new Set();
    const result = [];
    couriers.forEach((courier) => {
        const chatId = String(courier?.chatId || '').trim();
        if (!chatId) return;
        if (seenChatIds.has(chatId)) return;
        seenChatIds.add(chatId);
        result.push(courier);
    });
    return result;
}

function createTokenFingerprint(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function normalizeSiteSettings(input, foodsOverride) {
    const categories = uniqueNonEmptyStrings(
        Array.isArray(input?.categories) ? input.categories : DEFAULT_SITE_CATEGORIES
    );
    const rawRestaurantLat = Number(input?.restaurantLat);
    const rawRestaurantLon = Number(input?.restaurantLon);
    const restaurantLat = Number.isFinite(rawRestaurantLat) && rawRestaurantLat >= -90 && rawRestaurantLat <= 90
        ? Number(rawRestaurantLat.toFixed(6))
        : DEFAULT_RESTAURANT_COORDS.lat;
    const restaurantLon = Number.isFinite(rawRestaurantLon) && rawRestaurantLon >= -180 && rawRestaurantLon <= 180
        ? Number(rawRestaurantLon.toFixed(6))
        : DEFAULT_RESTAURANT_COORDS.lon;

    return {
        siteName: String(input?.siteName || 'Mansur Shashlik').trim() || 'Mansur Shashlik',
        freeDeliveryKm: Math.max(0, Number(input?.freeDeliveryKm || 1) || 0),
        deliveryPricePerKm: Math.max(0, Number(input?.deliveryPricePerKm || 2000) || 0),
        deliveryMinutesPerKm: Math.max(0.1, Number(input?.deliveryMinutesPerKm || 1.5) || 1.5),
        maxDeliveryKm: Math.max(0, Number(input?.maxDeliveryKm || 0) || 0),
        maxItemQuantity: Math.max(0, Number(input?.maxItemQuantity || 0) || 0),
        contactPhone: String(input?.contactPhone || '').trim(),
        adminPanelPassword: String(input?.adminPanelPassword || '123').trim() || '123',
        restaurantName: String(input?.restaurantName || DEFAULT_RESTAURANT_NAME).trim() || DEFAULT_RESTAURANT_NAME,
        restaurantAddress: String(input?.restaurantAddress || DEFAULT_RESTAURANT_ADDRESS).trim() || DEFAULT_RESTAURANT_ADDRESS,
        restaurantLat,
        restaurantLon,
        categories,
        updatedAt: new Date().toISOString()
    };
}

function createDefaultSiteSettings() {
    return normalizeSiteSettings({
        siteName: 'Mansur Shashlik',
        freeDeliveryKm: 1,
        deliveryPricePerKm: 2000,
        deliveryMinutesPerKm: 1.5,
        maxDeliveryKm: 0,
        maxItemQuantity: 0,
        contactPhone: '',
        adminPanelPassword: '123',
        restaurantName: DEFAULT_RESTAURANT_NAME,
        restaurantAddress: DEFAULT_RESTAURANT_ADDRESS,
        restaurantLat: DEFAULT_RESTAURANT_COORDS.lat,
        restaurantLon: DEFAULT_RESTAURANT_COORDS.lon,
        categories: DEFAULT_SITE_CATEGORIES
    }, []);
}

function readBotSettings() {
    try {
        if (fs.existsSync(BOT_SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(BOT_SETTINGS_FILE, 'utf8'));
            const adminBotToken = normalizeTelegramToken(parsed?.adminBotToken);
            let couriers = normalizeCourierList(parsed?.couriers);

            if (!couriers.length) {
                const legacyChatId = parsed?.courierChatId ? String(parsed.courierChatId) : '';
                const legacyPassword = String(parsed?.courierPassword || TELEGRAM_COURIER_PASSWORD || '').trim();
                if (legacyChatId || legacyPassword) {
                    couriers = normalizeCourierList([{
                        id: 1,
                        label: '1',
                        password: legacyPassword,
                        chatId: legacyChatId,
                        createdAt: parsed?.updatedAt || new Date().toISOString(),
                        connectedAt: legacyChatId ? new Date().toISOString() : ''
                    }]);
                }
            }

            const payload = {
                ...createDefaultBotSettings(),
                ...parsed,
                enabled: Boolean(parsed?.enabled),
                adminChatId: parsed?.adminChatId ? String(parsed.adminChatId) : '',
                adminLastUpdateId: Number(parsed?.adminLastUpdateId ?? parsed?.lastUpdateId ?? 0),
                adminBotToken,
                adminTokenFingerprint: String(parsed?.adminTokenFingerprint || ''),
                telegramAdminPassword: String(parsed?.telegramAdminPassword || '').trim(),
                couriers
            };
            const currentFingerprint = createTokenFingerprint(resolveTelegramToken('admin', payload));

            if (payload.adminTokenFingerprint !== currentFingerprint) {
                payload.adminChatId = '';
                payload.adminLastUpdateId = 0;
                payload.adminTokenFingerprint = currentFingerprint;
                payload.couriers = payload.couriers.map((courier) => ({
                    ...courier,
                    chatId: '',
                    connectedAt: ''
                }));
            }
            return payload;
        }
    } catch (err) {
        console.error('Bot settings read error:', err.message);
    }
    return createDefaultBotSettings();
}

function saveBotSettings(settings) {
    const adminBotToken = normalizeTelegramToken(settings?.adminBotToken);
    const couriers = normalizeCourierList(settings?.couriers);
    const payload = {
        ...createDefaultBotSettings(),
        ...settings,
        enabled: Boolean(settings?.enabled),
        adminChatId: settings?.adminChatId ? String(settings.adminChatId) : '',
        adminLastUpdateId: Number(settings?.adminLastUpdateId || 0),
        adminBotToken,
        adminTokenFingerprint: createTokenFingerprint(resolveTelegramToken('admin', { adminBotToken })),
        telegramAdminPassword: String(settings?.telegramAdminPassword || '').trim(),
        couriers,
        updatedAt: new Date().toISOString()
    };
    try {
        fs.writeFileSync(BOT_SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error('Bot settings save error:', err.message);
    }
    return payload;
}

function readSiteSettings() {
    try {
        if (fs.existsSync(SITE_SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SITE_SETTINGS_FILE, 'utf8'));
            return normalizeSiteSettings(parsed);
        }
    } catch (err) {
        console.error('Site settings read error:', err.message);
    }
    return createDefaultSiteSettings();
}

function saveSiteSettings(siteSettings) {
    const payload = normalizeSiteSettings(siteSettings);
    try {
        fs.writeFileSync(SITE_SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error('Site settings save error:', err.message);
    }
    return payload;
}

function getPublicSiteSettingsSnapshot() {
    const settings = readSiteSettings();
    return {
        siteName: settings.siteName,
        freeDeliveryKm: Number(settings.freeDeliveryKm || 0),
        deliveryPricePerKm: Number(settings.deliveryPricePerKm || 0),
        deliveryMinutesPerKm: Number(settings.deliveryMinutesPerKm || 1.5),
        maxDeliveryKm: Number(settings.maxDeliveryKm || 0),
        maxItemQuantity: Number(settings.maxItemQuantity || 0),
        contactPhone: String(settings.contactPhone || '').trim(),
        restaurantName: String(settings.restaurantName || DEFAULT_RESTAURANT_NAME).trim() || DEFAULT_RESTAURANT_NAME,
        restaurantAddress: String(settings.restaurantAddress || DEFAULT_RESTAURANT_ADDRESS).trim() || DEFAULT_RESTAURANT_ADDRESS,
        restaurantLat: Number(settings.restaurantLat || DEFAULT_RESTAURANT_COORDS.lat),
        restaurantLon: Number(settings.restaurantLon || DEFAULT_RESTAURANT_COORDS.lon),
        categories: uniqueNonEmptyStrings(settings.categories)
    };
}

function getAdminSiteSettingsSnapshot() {
    const settings = readSiteSettings();
    return {
        ...getPublicSiteSettingsSnapshot(),
        adminPanelPassword: String(settings.adminPanelPassword || '123').trim() || '123'
    };
}

function syncSiteSettingsCategoriesWithFoods(foodsOverride) {
    const current = readSiteSettings();
    return saveSiteSettings({
        ...current,
        categories: uniqueNonEmptyStrings(current.categories)
    });
}

function createDefaultSiteState() {
    const nowIso = new Date().toISOString();
    return {
        orderingEnabled: true,
        currentSessionId: `session-${Date.now()}`,
        sessionStartedAt: nowIso,
        sessionStoppedAt: '',
        lastSessionReport: null,
        totalRevenueCarry: 0,
        totalRevenueOffset: 0,
        totalRevenueResetAt: '',
        updatedAt: nowIso
    };
}

function readSiteState() {
    try {
        if (fs.existsSync(SITE_STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SITE_STATE_FILE, 'utf8'));
            const fallback = createDefaultSiteState();
            return {
                ...fallback,
                ...parsed,
                orderingEnabled: parsed?.orderingEnabled !== false,
                currentSessionId: String(parsed?.currentSessionId || fallback.currentSessionId),
                sessionStartedAt: String(parsed?.sessionStartedAt || fallback.sessionStartedAt),
                sessionStoppedAt: parsed?.sessionStoppedAt ? String(parsed.sessionStoppedAt) : '',
                totalRevenueCarry: Math.max(0, Number(parsed?.totalRevenueCarry || 0) || 0),
                totalRevenueOffset: Math.max(0, Number(parsed?.totalRevenueOffset || 0) || 0),
                totalRevenueResetAt: parsed?.totalRevenueResetAt ? String(parsed.totalRevenueResetAt) : '',
                lastSessionReport: parsed?.lastSessionReport && typeof parsed.lastSessionReport === 'object'
                    ? parsed.lastSessionReport
                    : null
            };
        }
    } catch (err) {
        console.error('Site state read error:', err.message);
    }
    return createDefaultSiteState();
}

function saveSiteState(siteState) {
    const fallback = createDefaultSiteState();
    const payload = {
        ...fallback,
        ...siteState,
        orderingEnabled: siteState?.orderingEnabled !== false,
        currentSessionId: String(siteState?.currentSessionId || fallback.currentSessionId),
        sessionStartedAt: String(siteState?.sessionStartedAt || fallback.sessionStartedAt),
        sessionStoppedAt: siteState?.sessionStoppedAt ? String(siteState.sessionStoppedAt) : '',
        totalRevenueCarry: Math.max(0, Number(siteState?.totalRevenueCarry || 0) || 0),
        totalRevenueOffset: Math.max(0, Number(siteState?.totalRevenueOffset || 0) || 0),
        totalRevenueResetAt: siteState?.totalRevenueResetAt ? String(siteState.totalRevenueResetAt) : '',
        lastSessionReport: siteState?.lastSessionReport && typeof siteState.lastSessionReport === 'object'
            ? siteState.lastSessionReport
            : null,
        updatedAt: new Date().toISOString()
    };
    try {
        fs.writeFileSync(SITE_STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error('Site state save error:', err.message);
    }
    return payload;
}

function getTelegramSettingsSnapshot() {
    const settings = readBotSettings();
    const adminToken = resolveTelegramToken('admin', settings);
    const couriers = Array.isArray(settings.couriers) ? settings.couriers : [];
    const courierConnectedCount = couriers.filter((courier) => String(courier?.chatId || '').trim()).length;
    return {
        enabled: Boolean(settings.enabled),
        botConfigured: Boolean(adminToken),
        botConnected: Boolean(settings.adminChatId),
        adminChatId: settings.adminChatId ? String(settings.adminChatId) : '',
        courierTotal: couriers.length,
        courierConnected: courierConnectedCount > 0,
        courierConnectedCount
    };
}

function escapeTelegramText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseOrderDateToMs(order) {
    if (!order || typeof order !== 'object') return 0;
    const fromCreated = Number(order.createdAtMs || order.createdAt || 0);
    if (Number.isFinite(fromCreated) && fromCreated > 0) return fromCreated;

    const rawDate = String(order.date || '').trim();
    if (rawDate) {
        const parsed = new Date(rawDate.replace(' ', 'T'));
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    }

    return 0;
}

function normalizeDeliveryType(value) {
    const lower = String(value || '').trim().toLowerCase();
    if (lower === 'pickup' || lower === 'saboy') return 'pickup';
    return 'home';
}

function normalizeOrderCoords(coords) {
    const lat = Number(coords?.lat);
    const lon = Number(coords?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6))
    };
}

function formatSoM(value) {
    return `${Number(value || 0).toLocaleString()} so'm`;
}

function buildOrderMapLink(order) {
    const coords = normalizeOrderCoords(order?.customerCoords);
    if (coords) {
        const settings = readSiteSettings();
        const originLat = Number(settings?.restaurantLat);
        const originLon = Number(settings?.restaurantLon);
        const fromLat = Number.isFinite(originLat) ? originLat : RESTAURANT_COORDS.lat;
        const fromLon = Number.isFinite(originLon) ? originLon : RESTAURANT_COORDS.lon;
        return `https://yandex.uz/maps/?mode=routes&rtt=pd&rtext=${encodeURIComponent(`${fromLat},${fromLon}`)}~${encodeURIComponent(`${coords.lat},${coords.lon}`)}`;
    }

    const address = String(order?.address || '').trim();
    if (address) {
        return `https://yandex.uz/maps/?mode=search&text=${encodeURIComponent(address)}`;
    }

    const directLink = String(order?.customerMapLink || order?.mapLink || '').trim();
    if (/^https?:\/\//i.test(directLink)) return directLink;
    return '';
}

function getOrderCoordsText(order) {
    const coords = normalizeOrderCoords(order?.customerCoords);
    if (!coords) return '';
    return `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
}

function sanitizeLocationLabel(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\btaxmin(?:iy|an)?\b[:\s-]*/gi, '')
        .replace(/[|]{2,}/g, '|')
        .replace(/^[,|.\s-]+|[,|.\s-]+$/g, '')
        .trim();
}

function sanitizeOrderComment(value) {
    return String(value || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 500);
}

function getOrderCommentText(order) {
    return sanitizeOrderComment(order?.customerComment || order?.comment || '');
}

function buildAddressFromNominatimPayload(payload, lat, lon) {
    const coordLabel = `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
    if (!payload || typeof payload !== 'object') return `Koordinata: ${coordLabel}`;

    const address = payload.address && typeof payload.address === 'object' ? payload.address : {};
    const road = String(address.road || address.pedestrian || address.residential || address.footway || address.path || '').trim();
    const house = String(address.house_number || '').trim();
    const neighborhood = String(address.suburb || address.neighbourhood || address.quarter || '').trim();
    const city = String(address.city || address.town || address.village || address.hamlet || address.municipality || '').trim();
    const region = String(address.state || address.region || '').trim();

    const streetLine = [road, house].filter(Boolean).join(' ').trim();
    const localityLine = [neighborhood, city, region]
        .filter(Boolean)
        .filter((part, idx, arr) => arr.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === idx)
        .join(', ');

    const primary = sanitizeLocationLabel(streetLine);
    const secondary = sanitizeLocationLabel(localityLine);
    if (primary && secondary) return `${primary}, ${secondary}`;
    if (primary) return primary;
    if (secondary) return secondary;

    const display = sanitizeLocationLabel(
        String(payload.display_name || '')
            .split(',')
            .slice(0, 3)
            .join(',')
    );
    return display || `Koordinata: ${coordLabel}`;
}

async function resolveAddressWithGemini(lat, lon, nominatimPayload, fallbackAddress) {
    if (!isGeminiReady()) return '';

    const settings = readSiteSettings();
    const restaurantLat = Number(settings?.restaurantLat);
    const restaurantLon = Number(settings?.restaurantLon);
    const restaurantCoordLabel = (Number.isFinite(restaurantLat) && Number.isFinite(restaurantLon))
        ? `${restaurantLat.toFixed(6)}, ${restaurantLon.toFixed(6)}`
        : `${DEFAULT_RESTAURANT_COORDS.lat.toFixed(6)}, ${DEFAULT_RESTAURANT_COORDS.lon.toFixed(6)}`;
    const nominatimAddress = buildAddressFromNominatimPayload(nominatimPayload, lat, lon);
    const prompt = [
        "Vazifa: koordinata uchun foydalanuvchiga ko'rsatiladigan qisqa manzil yozing.",
        "Qoidalar:",
        "1) Faqat 1 qator matn qaytaring.",
        "2) 'Taxminiy' yoki shunga o'xshash so'z ishlatmang.",
        "3) O'zbekcha, aniq va ixcham yozing.",
        "4) Agar to'liq ko'cha topilmasa, mahalla/shahar/viloyatni yozing.",
        `Restoran koordinatasi: ${restaurantCoordLabel}`,
        `Koordinata: ${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`,
        `Nominatim ma'lumoti: ${JSON.stringify(nominatimPayload || {})}`,
        `Fallback manzil: ${fallbackAddress}`,
        `Nominatim qisqa manzil: ${nominatimAddress}`
    ].join("\n");

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 120
                }
            })
        }
    );

    if (!response.ok) {
        if (response.status === 429) {
            setGeminiCooldown('location', response.status);
            return '';
        }
        if (response.status === 404) {
            setGeminiDisabled('location', response.status);
            return '';
        }
        throw new Error(`Gemini API status ${response.status}`);
    }

    const payload = await response.json();
    const text = String(
        payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join(' ').trim() || ''
    );
    if (!text) return '';

    const parsed = extractJsonObject(text);
    const rawAddress = parsed?.address ? String(parsed.address) : text.split('\n')[0];
    const cleaned = sanitizeLocationLabel(rawAddress);
    if (!cleaned) return '';
    if (cleaned.length > 180) return '';
    return cleaned;
}

async function resolveLocationAddress(lat, lon) {
    const coordLabel = `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
    const cached = getCachedLocation(lat, lon);
    if (cached?.address) {
        return { address: cached.address, source: cached.source || 'cache' };
    }
    let nominatimPayload = null;
    let fallbackAddress = `Koordinata: ${coordLabel}`;

    try {
        const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1&zoom=18&accept-language=uz,en`;
        const reverseRes = await fetch(reverseUrl, {
            headers: { 'User-Agent': 'MansurShashlik/1.0' },
            signal: AbortSignal.timeout(12000)
        });
        if (reverseRes.ok) {
            nominatimPayload = await reverseRes.json();
            fallbackAddress = buildAddressFromNominatimPayload(nominatimPayload, lat, lon);
        }
    } catch (err) {
        logNominatimIssue('reverse', err);
    }

    try {
        const geminiAddress = await resolveAddressWithGemini(lat, lon, nominatimPayload, fallbackAddress);
        if (geminiAddress) {
            const result = { address: geminiAddress, source: 'gemini' };
            setCachedLocation(lat, lon, result);
            return result;
        }
    } catch (err) {
        const msg = String(err?.message || '');
        if (!msg.includes('status 429')) {
            console.log('Gemini location resolve error:', err.message);
        }
    }
    const result = { address: sanitizeLocationLabel(fallbackAddress) || `Koordinata: ${coordLabel}`, source: 'nominatim' };
    setCachedLocation(lat, lon, result);
    return result;
}

function getCustomerDisplayName(order) {
    const customerName = String(order?.customerName || '').trim();
    if (customerName) return customerName;
    const displayName = String(order?.displayName || '').trim();
    if (displayName) return displayName;

    const userId = String(order?.userId || '').trim();
    const email = String(order?.email || '').trim().toLowerCase();
    const phone = String(order?.phone || '').trim();
    if (userId || email || phone) {
        const linkedUser = readUsers().find((user) => {
            const sameId = userId && String(user?.id || '').trim() === userId;
            const sameEmail = email && String(user?.email || '').trim().toLowerCase() === email;
            const samePhone = phone && String(user?.phone || '').trim() === phone;
            return sameId || sameEmail || samePhone;
        });
        const linkedName = String(linkedUser?.displayName || '').trim();
        if (linkedName) return linkedName;
    }

    const rawEmail = String(order?.email || '').trim();
    if (rawEmail) return rawEmail;
    return userId ? `Mijoz ${userId}` : 'Noma\'lum mijoz';
}

const UZBEK_REGION_MATCHERS = [
    { label: "Qoraqalpog'iston Respublikasi", pattern: /(qoraqalpog|karakalpak|qaraqalpoq|қорақалпоғ|каракалпак)/i },
    { label: "Andijon viloyati", pattern: /(andijon|андижан)/i },
    { label: "Buxoro viloyati", pattern: /(buxoro|bukhara|бухар)/i },
    { label: "Farg'ona viloyati", pattern: /(farg'?ona|fergana|фарғона|ферган)/i },
    { label: "Jizzax viloyati", pattern: /(jizzax|jizakh|джизак)/i },
    { label: "Xorazm viloyati", pattern: /(xorazm|khorezm|хорезм)/i },
    { label: "Namangan viloyati", pattern: /(namangan|наманган)/i },
    { label: "Navoiy viloyati", pattern: /(navoiy|navoi|навои)/i },
    { label: "Qashqadaryo viloyati", pattern: /(qashqadaryo|kashkadarya|кашкадар)/i },
    { label: "Samarqand viloyati", pattern: /(samarqand|samarkand|самарканд)/i },
    { label: "Sirdaryo viloyati", pattern: /(sirdaryo|syrdarya|сырдар)/i },
    { label: "Surxondaryo viloyati", pattern: /(surxondaryo|surkhandarya|сурхандар)/i },
    { label: "Toshkent shahri", pattern: /(toshkent shahri|toshkent city|ташкент шаҳри|г\.?\s*ташкент)/i },
    { label: "Toshkent viloyati", pattern: /(toshkent viloyati|tashkent region|ташкентская область)/i }
];

function detectUzbekRegionLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    for (const item of UZBEK_REGION_MATCHERS) {
        if (item.pattern.test(raw)) return item.label;
    }
    return '';
}

function extractRegionFromAddress(address) {
    const raw = sanitizeLocationLabel(address);
    if (!raw) return '-';

    const known = detectUzbekRegionLabel(raw);
    if (known) return known;

    const chunks = raw
        .split(',')
        .map((item) => sanitizeLocationLabel(item))
        .filter(Boolean);
    const regionLike = chunks.find((part) => /(viloyat|viloyati|province|region|область|respublika|respublikasi)/i.test(part));
    if (regionLike) {
        return detectUzbekRegionLabel(regionLike) || regionLike;
    }

    return '-';
}

async function resolveRegionFromCoords(coords) {
    const normalizedCoords = normalizeOrderCoords(coords);
    if (!normalizedCoords) return '';

    const lat = normalizedCoords.lat;
    const lon = normalizedCoords.lon;
    try {
        const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1&zoom=12&accept-language=uz,en`;
        const reverseRes = await fetch(reverseUrl, {
            headers: { 'User-Agent': 'MansurShashlik/1.0' },
            signal: AbortSignal.timeout(12000)
        });

        if (!reverseRes.ok) return '';
        const payload = await reverseRes.json();
        const address = payload?.address && typeof payload.address === 'object' ? payload.address : {};
        const regionCandidates = [
            address.state,
            address.region,
            address.province,
            address.state_district,
            address.county,
            address.city,
            address.town,
            address.village,
            payload?.display_name
        ]
            .map((item) => sanitizeLocationLabel(item))
            .filter(Boolean);

        for (const candidate of regionCandidates) {
            const detected = detectUzbekRegionLabel(candidate);
            if (detected) return detected;
        }

        const regionLike = regionCandidates.find((part) => /(viloyat|viloyati|respublika|respublikasi|shahri|province|region|область|республика)/i.test(part));
        return regionLike || '';
    } catch (err) {
        logNominatimIssue('region', err);
        return '';
    }
}

function extractLocalityFromAddress(address) {
    const raw = sanitizeLocationLabel(address);
    if (!raw) return '-';

    const chunks = raw
        .split(',')
        .map((item) => sanitizeLocationLabel(item))
        .filter(Boolean);
    if (!chunks.length) return raw;

    const firstSpecific = chunks.find((part) => {
        if (!part) return false;
        if (detectUzbekRegionLabel(part)) return false;
        if (/(viloyat|viloyati|province|region|область|respublika|respublikasi)/i.test(part)) return false;
        return true;
    });

    return firstSpecific || chunks[0] || '-';
}

function isPaymentCollected(order) {
    if (!order || typeof order !== 'object') return false;
    if (Boolean(order.paymentCollected)) return true;

    const paymentStatus = String(order?.paymentStatus || '').trim().toLowerCase();
    return paymentStatus === 'paid';
}

function isOrderClosedForCustomer(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    if (status === 'bekor') return true;
    if (status !== 'yakunlandi') return false;
    return isPaymentCollected(order);
}

function isOrderRevenueEligible(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    if (status === 'bekor') return false;
    return isPaymentCollected(order);
}

function getOrderRevenueAmount(order) {
    return isOrderRevenueEligible(order) ? Number(order?.total || 0) : 0;
}

function doesOrderBelongToCustomer(order, candidate) {
    const candidateUserId = String(candidate?.userId || '').trim();
    const candidateEmail = String(candidate?.email || '').trim().toLowerCase();
    const candidatePhone = String(candidate?.phone || '').trim();
    const orderUserId = String(order?.userId || '').trim();
    const orderEmail = String(order?.email || '').trim().toLowerCase();
    const orderPhone = String(order?.phone || '').trim();

    if (candidateUserId && orderUserId && candidateUserId !== 'guest' && candidateUserId === orderUserId) return true;
    if (candidateEmail && orderEmail && candidateEmail !== '' && candidateEmail === orderEmail) return true;
    return Boolean(candidatePhone && orderPhone && candidatePhone === orderPhone);
}

function findBlockingCustomerOrder(orders, candidate) {
    if (!Array.isArray(orders)) return null;
    const matchingOrders = orders
        .filter((order) => doesOrderBelongToCustomer(order, candidate))
        .filter((order) => !isOrderClosedForCustomer(order))
        .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
    return matchingOrders[0] || null;
}

function getOrdersForSession(orders, sessionId) {
    const key = String(sessionId || '').trim();
    if (!key) return [];
    return Array.isArray(orders)
        ? orders.filter((order) => String(order?.sessionId || '').trim() === key)
        : [];
}

function buildSessionReport(orders, siteState) {
    const sessionId = String(siteState?.currentSessionId || '').trim();
    const sessionOrders = getOrdersForSession(orders, sessionId);
    const activeOrders = sessionOrders.filter((order) => String(order?.status || '').trim().toLowerCase() !== 'bekor');
    const paidOrders = activeOrders.filter(isOrderRevenueEligible);
    const pendingOrders = activeOrders.filter((order) => !isOrderRevenueEligible(order));

    return {
        sessionId,
        startedAt: String(siteState?.sessionStartedAt || ''),
        stoppedAt: String(siteState?.sessionStoppedAt || new Date().toISOString()),
        totalOrders: activeOrders.length,
        paidOrders: paidOrders.length,
        pendingOrders: pendingOrders.length,
        cancelledOrders: Math.max(0, sessionOrders.length - activeOrders.length),
        revenue: paidOrders.reduce((sum, order) => sum + getOrderRevenueAmount(order), 0),
        updatedAt: new Date().toISOString()
    };
}

function getSiteStateSnapshot(siteState, orders) {
    const state = siteState || readSiteState();
    const list = Array.isArray(orders) ? orders : readOrders();
    const currentSessionOrders = getOrdersForSession(list, state.currentSessionId)
        .filter((order) => String(order?.status || '').trim().toLowerCase() !== 'bekor');
    const rawTotalRevenue = list.reduce((sum, order) => sum + getOrderRevenueAmount(order), 0);
    const totalRevenueCarry = Math.max(0, Number(state.totalRevenueCarry || 0) || 0);
    const totalRevenueOffset = Math.max(0, Number(state.totalRevenueOffset || 0) || 0);
    const liveRevenue = Math.max(0, rawTotalRevenue - totalRevenueOffset);

    return {
        orderingEnabled: Boolean(state.orderingEnabled),
        currentSessionId: String(state.currentSessionId || ''),
        sessionStartedAt: String(state.sessionStartedAt || ''),
        sessionStoppedAt: state.sessionStoppedAt ? String(state.sessionStoppedAt) : '',
        lastSessionReport: state.lastSessionReport || null,
        totalRevenue: totalRevenueCarry + liveRevenue,
        totalRevenueCarry,
        totalRevenueOffset,
        totalRevenueResetAt: state.totalRevenueResetAt ? String(state.totalRevenueResetAt) : '',
        currentSessionStats: {
            totalOrders: currentSessionOrders.length,
            newOrders: currentSessionOrders.filter((order) => String(order?.status || '').trim().toLowerCase() === 'yangi').length,
            revenue: currentSessionOrders.reduce((sum, order) => sum + getOrderRevenueAmount(order), 0),
            pendingOrders: currentSessionOrders.filter((order) => !isOrderRevenueEligible(order)).length
        }
    };
}

function calcCollectAmount(order) {
    const paymentMethod = String(order?.paymentMethod || '').trim().toLowerCase();
    const paymentStatus = String(order?.paymentStatus || '').trim().toLowerCase();
    const total = Number(order?.total || 0);

    if (paymentMethod === 'cash' || paymentStatus === 'cash') {
        return total;
    }
    return 0;
}

function formatOrderItemsForTelegram(order) {
    return Object.entries(order?.items || {})
        .map(([name, data]) => {
            const qty = Number(data?.quantity || 0);
            return `• <b>${escapeTelegramText(name)} x${qty}</b>`;
        })
        .join('\n');
}

function formatOrderForTelegram(order) {
    const items = formatOrderItemsForTelegram(order);
    const region = order?.customerRegion || extractRegionFromAddress(order?.address || '');
    const locality = extractLocalityFromAddress(order?.address || '');
    const prepMinutes = getOrderPrepMinutes(order);
    const customerComment = getOrderCommentText(order);

    return [
        '<b>Yangi buyurtma keldi</b>',
        `<b>ID:</b> ${escapeTelegramText(order?.id)}`,
        `<b>Sana:</b> ${escapeTelegramText(order?.date || '')}`,
        `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
        `<b>Telefon:</b> ${escapeTelegramText(order?.phone || '-')}`,
        `<b>Viloyat:</b> ${escapeTelegramText(region || '-')}`,
        `<b>Joy:</b> ${escapeTelegramText(locality || '-')}`,
        `<b>Izoh:</b> ${escapeTelegramText(customerComment || '-')}`,
        `<b>Tayyor bo'lish:</b> ${escapeTelegramText(prepMinutes)} daqiqa`,
        '',
        `<b>Buyurtma qilingan taomlar (ID:${escapeTelegramText(order?.id)})</b>`,
        items || '- Taom yo\'q',
        '',
        `<b>Yetkazish:</b> ${formatSoM(order?.delivery || 0)}`,
        `<b>Jami:</b> ${formatSoM(order?.total || 0)}`,
        '',
        `<b>Boshqarish:</b> ID ni yuboring (masalan: <code>${escapeTelegramText(order?.id)}</code>)`
    ].join('\n');
}

function formatCourierOrderForTelegram(order, reason) {
    const items = formatOrderItemsForTelegram(order);
    const mapLink = buildOrderMapLink(order);
    const collectAmount = calcCollectAmount(order);
    const prepMinutes = getOrderPrepMinutes(order);
    const region = order?.customerRegion || extractRegionFromAddress(order?.address || '');
    const locality = extractLocalityFromAddress(order?.address || '');
    const customerComment = getOrderCommentText(order);
    const reasonText = reason === 'admin_ready'
        ? 'Admin tayyor deb belgiladi'
        : (reason === 'manual_lookup'
            ? 'Qo\'lda ochildi'
            : `${prepMinutes} daqiqa kutish muddati tugadi`);
    const mapLine = mapLink
        ? `<b>Manzil link:</b> <a href="${escapeTelegramText(mapLink)}">Yandex xaritada ochish</a>`
        : '<b>Manzil link:</b> Mavjud emas';
    const coordsText = getOrderCoordsText(order);

    return [
        '<b>Buyurtma yetkazishga tayyor</b>',
        `<b>Sabab:</b> ${escapeTelegramText(reasonText)}`,
        `<b>Buyurtma ID:</b> ${escapeTelegramText(order?.id)}`,
        `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
        `<b>Telefon:</b> ${escapeTelegramText(order?.phone || '-')}`,
        `<b>Viloyat:</b> ${escapeTelegramText(region || '-')}`,
        `<b>Joy:</b> ${escapeTelegramText(locality || '-')}`,
        `<b>Manzil:</b> ${escapeTelegramText(order?.address || '-')}`,
        `<b>Izoh:</b> ${escapeTelegramText(customerComment || '-')}`,
        `<b>Koordinata:</b> ${escapeTelegramText(coordsText || 'Mavjud emas')}`,
        `<b>Olinadigan summa:</b> ${formatSoM(collectAmount || order?.total || 0)}`,
        `<b>Jami chek:</b> ${formatSoM(order?.total || 0)}`,
        '',
        `<b>Taomlar (ID:${escapeTelegramText(order?.id)})</b>`,
        items || '- Taom yo\'q',
        '',
        mapLine
    ].join('\n');
}

function formatCourierHeadsUpForTelegram(order) {
    const prepMinutes = getOrderPrepMinutes(order);
    const region = order?.customerRegion || extractRegionFromAddress(order?.address || '');
    const locality = extractLocalityFromAddress(order?.address || '');
    const customerComment = getOrderCommentText(order);
    return [
        `<b>${prepMinutes} daqiqada buyurtma tayyor bo'ladi</b>`,
        `<b>ID:</b> ${escapeTelegramText(order?.id)}`,
        `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
        `<b>Telefon:</b> ${escapeTelegramText(order?.phone || '-')}`,
        `<b>Viloyat:</b> ${escapeTelegramText(region || '-')}`,
        `<b>Joy:</b> ${escapeTelegramText(locality || '-')}`,
        `<b>Izoh:</b> ${escapeTelegramText(customerComment || '-')}`
    ].join('\n');
}

function getTelegramBotToken(botKind = 'admin', settingsOverride) {
    const settings = settingsOverride || readBotSettings();
    return resolveTelegramToken(botKind, settings);
}

async function telegramApiRequest(method, payload, botKind = 'admin') {
    const botToken = getTelegramBotToken(botKind);
    if (!botToken) return { ok: false };
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        if (!response.ok) return { ok: false };
        const json = await response.json().catch(() => ({ ok: false }));
        return json && typeof json === 'object' ? json : { ok: false };
    } catch (err) {
        return { ok: false };
    }
}

async function sendTelegramMessage(chatId, text, extra = {}, botKind = 'admin') {
    if (!chatId) return false;
    const payload = {
        chat_id: chatId,
        text: String(text || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
    };
    const data = await telegramApiRequest('sendMessage', payload, botKind);
    return Boolean(data?.ok);
}

async function answerTelegramCallbackQuery(callbackQueryId, text, botKind = 'admin') {
    if (!callbackQueryId) return false;
    const payload = {
        callback_query_id: callbackQueryId,
        text: String(text || 'Bajarildi'),
        show_alert: false
    };
    const data = await telegramApiRequest('answerCallbackQuery', payload, botKind);
    return Boolean(data?.ok);
}

async function editTelegramMessageMarkup(chatId, messageId, replyMarkup = null, botKind = 'admin') {
    if (!chatId || !messageId) return false;
    const payload = {
        chat_id: chatId,
        message_id: messageId
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const data = await telegramApiRequest('editMessageReplyMarkup', payload, botKind);
    return Boolean(data?.ok);
}

async function editTelegramMessageText(chatId, messageId, text, extra = {}, botKind = 'admin') {
    if (!chatId || !messageId) return false;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: String(text || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
    };
    const data = await telegramApiRequest('editMessageText', payload, botKind);
    return Boolean(data?.ok);
}

async function deleteTelegramMessage(chatId, messageId, botKind = 'admin') {
    if (!chatId || !messageId) return false;
    const payload = {
        chat_id: chatId,
        message_id: messageId
    };
    const data = await telegramApiRequest('deleteMessage', payload, botKind);
    return Boolean(data?.ok);
}

function buildAdminOrderControls(orderId) {
    return {
        inline_keyboard: [
            [{ text: 'Tayyor', callback_data: `admin_ready_${orderId}` }],
            [{ text: 'Bekor qilish', callback_data: `admin_cancel_${orderId}` }],
            [{ text: 'Buyurtmachi bilan bog\'lanish', callback_data: `admin_contact_${orderId}` }]
        ]
    };
}

function buildCourierPaymentControls(orderId) {
    return {
        inline_keyboard: [
            [{ text: 'Buyurtmadan pul oldim', callback_data: `courier_paid_${orderId}` }]
        ]
    };
}

function findOrderById(orders, orderId) {
    const id = Number(orderId);
    if (!Number.isFinite(id) || id <= 0) return { index: -1, order: null };
    const index = orders.findIndex((o) => Number(o?.id) === id);
    if (index === -1) return { index: -1, order: null };
    return { index, order: orders[index] };
}

function parseOrderIdList(value) {
    const result = [];
    const seen = new Set();
    const rawList = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\s]+/);
    rawList.forEach((item) => {
        const id = Number(String(item || '').trim());
        if (!Number.isFinite(id) || id <= 0) return;
        if (seen.has(id)) return;
        seen.add(id);
        result.push(id);
    });
    return result;
}

function getMaxItemQuantity(items) {
    let maxQty = 0;
    if (!items || typeof items !== 'object') return maxQty;
    Object.values(items).forEach((item) => {
        const qty = Number(item?.quantity || 0);
        if (Number.isFinite(qty) && qty > maxQty) {
            maxQty = qty;
        }
    });
    return maxQty;
}

function getFoodPrepMinutes(food) {
    const value = Number(food?.prepMinutes || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : COURIER_AUTO_DELAY_MINUTES;
}

function getOrderPrepMinutes(order, foodsOverride) {
    const explicit = Number(order?.prepMinutes || 0);
    if (Number.isFinite(explicit) && explicit > 0) {
        return Math.round(explicit);
    }
    const foods = Array.isArray(foodsOverride) ? foodsOverride : readFoods();
    const items = order?.items && typeof order.items === 'object' ? order.items : {};
    let maxPrep = 0;
    Object.keys(items).forEach((name) => {
        const food = foods.find((item) => String(item?.name || '').toLowerCase() === String(name || '').toLowerCase());
        const prep = getFoodPrepMinutes(food);
        if (prep > maxPrep) maxPrep = prep;
    });
    return maxPrep > 0 ? maxPrep : COURIER_AUTO_DELAY_MINUTES;
}

function buildOrderBlockMessage(reason, limit, contactPhone) {
    let message = "Buyurtma qabul qilinmadi. Iltimos biz bilan bog'laning va buyurtmani tasdiqlang.";
    if (reason === "distance" && Number(limit) > 0) {
        message = `Buyurtma qabul qilinmadi. Yetkazish masofasi ${Number(limit)} km dan oshmasligi kerak. Iltimos biz bilan bog'laning va buyurtmani tasdiqlang.`;
    } else if (reason === "quantity" && Number(limit) > 0) {
        message = `Buyurtma qabul qilinmadi. Bitta taom miqdori ${Number(limit)} dan oshmasligi kerak. Iltimos biz bilan bog'laning va buyurtmani tasdiqlang.`;
    }
    const phone = String(contactPhone || "").trim();
    if (phone) {
        message += ` Tel: ${phone}`;
    }
    return message;
}

function isActiveDeliveryOrder(order) {
    const type = normalizeDeliveryType(order?.deliveryType || 'home');
    if (type === 'pickup') return false;
    const status = String(order?.status || 'yangi').trim().toLowerCase();
    if (status === 'bekor' || status === 'yakunlandi') return false;
    return true;
}

function isOrderClosed(order) {
    const status = String(order?.status || '').trim().toLowerCase();
    return status === 'bekor' || status === 'yakunlandi';
}

function canTransitionOrderStatus(currentStatus, nextStatus) {
    const from = String(currentStatus || '').trim().toLowerCase();
    const to = String(nextStatus || '').trim().toLowerCase();
    if (!to) return false;
    if (from === to) return true;
    if (from === 'bekor' || from === 'yakunlandi') return false;

    if (from === 'yangi') {
        return to === 'tayyorlandi' || to === 'bekor';
    }
    if (from === 'tayyorlandi') {
        return to === 'yolda' || to === 'yakunlandi';
    }
    if (from === 'yolda') {
        return to === 'yakunlandi';
    }
    return false;
}

function getCourierQueueScore(order) {
    const queuedAt = Date.parse(String(order?.courierQueuedAt || ''));
    if (Number.isFinite(queuedAt) && queuedAt > 0) return queuedAt;
    const createdAt = parseOrderDateToMs(order);
    if (createdAt) return createdAt;
    const id = Number(order?.id || 0);
    return Number.isFinite(id) && id > 0 ? id : 0;
}

function syncLegacyCourierAssignments(orders, couriers) {
    if (!Array.isArray(orders) || !Array.isArray(couriers) || couriers.length !== 1) return false;
    const courierId = Number(couriers[0]?.id || 0);
    if (!Number.isFinite(courierId) || courierId <= 0) return false;
    let changed = false;
    orders.forEach((order, index) => {
        if (!order || typeof order !== 'object') return;
        const hasAssigned = Number(order?.courierAssignedId || 0) > 0;
        if (hasAssigned || !order?.courierNotified) return;
        if (!isActiveDeliveryOrder(order)) return;
        orders[index] = {
            ...order,
            courierAssignedId: courierId,
            courierAssignedAt: String(order?.courierAssignedAt || order?.courierNotifiedAt || new Date().toISOString())
        };
        changed = true;
    });
    return changed;
}

function getActiveCourierAssignments(orders) {
    const map = new Map();
    (Array.isArray(orders) ? orders : []).forEach((order) => {
        if (!order || typeof order !== 'object') return;
        const courierId = Number(order?.courierAssignedId || 0);
        if (!Number.isFinite(courierId) || courierId <= 0) return;
        if (!isActiveDeliveryOrder(order)) return;
        map.set(courierId, Number(order?.id || 0));
    });
    return map;
}

const telegramRuntime = {
    polling: false,
    timer: null,
    pendingPasswordChats: new Map(),
    deliveryTimers: new Map()
};

function clearCourierTimer(orderId) {
    const key = String(orderId || '');
    if (!key) return;
    const timer = telegramRuntime.deliveryTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        telegramRuntime.deliveryTimers.delete(key);
    }
}

function clearAllCourierTimers() {
    telegramRuntime.deliveryTimers.forEach((timer, key) => {
        try { clearTimeout(timer); } catch (err) {}
        telegramRuntime.deliveryTimers.delete(key);
    });
}

function scheduleCourierNotification(orderId, delayMs, reason) {
    const id = Number(orderId);
    if (!Number.isFinite(id) || id <= 0) return;
    clearCourierTimer(id);
    const wait = Math.max(0, Number(delayMs || 0));
    const key = String(id);
    const timer = setTimeout(async () => {
        telegramRuntime.deliveryTimers.delete(key);
        try {
            await notifyCourierForOrder(id, reason || 'auto_prep');
        } catch (err) {
            console.error('Courier auto notify error:', err?.message || err);
        }
    }, wait);
    telegramRuntime.deliveryTimers.set(key, timer);
}

function syncCourierTimersFromDb() {
    const settings = readBotSettings();
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    if (syncLegacyCourierAssignments(orders, settings.couriers)) {
        saveOrders(orders);
    }
    const now = Date.now();
    orders.forEach((order) => {
        if (!isActiveDeliveryOrder(order)) return;
        if (order?.courierNotified) return;
        if (order?.courierQueuedAt) return;
        const orderId = Number(order?.id);
        if (!Number.isFinite(orderId) || orderId <= 0) return;
        const createdAtMs = parseOrderDateToMs(order) || now;
        const prepMinutes = getOrderPrepMinutes(order);
        const dueAt = createdAtMs + (prepMinutes * 60 * 1000);
        const wait = Math.max(0, dueAt - now);
        scheduleCourierNotification(orderId, wait, 'auto_prep');
    });
}

async function assignQueuedOrders() {
    const settings = readBotSettings();
    if (!settings.enabled) return { assignedCount: 0, reason: 'disabled' };

    const connectedCouriers = getConnectedCouriers(settings)
        .filter((courier) => Number(courier?.id || 0) > 0)
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    if (!connectedCouriers.length) return { assignedCount: 0, reason: 'courier_not_connected' };

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    let changed = false;
    if (syncLegacyCourierAssignments(orders, connectedCouriers)) {
        changed = true;
    }

    const activeAssignments = getActiveCourierAssignments(orders);
    let availableCouriers = connectedCouriers.filter((courier) => !activeAssignments.has(Number(courier.id || 0)));
    if (!availableCouriers.length) {
        if (changed) saveOrders(orders);
        return { assignedCount: 0, reason: 'courier_busy' };
    }

    const queuedOrders = orders
        .filter((order) => {
            if (!order || typeof order !== 'object') return false;
            if (!order?.courierQueuedAt) return false;
            if (!isActiveDeliveryOrder(order)) return false;
            if (Number(order?.courierAssignedId || 0) > 0) return false;
            if (order?.courierNotified) return false;
            return true;
        })
        .sort((a, b) => {
            const diff = getCourierQueueScore(a) - getCourierQueueScore(b);
            if (diff !== 0) return diff;
            return Number(a?.id || 0) - Number(b?.id || 0);
        });

    let assignedCount = 0;
    for (const order of queuedOrders) {
        if (!availableCouriers.length) break;
        const courier = availableCouriers.shift();
        if (!courier?.chatId) continue;

        const reason = order?.courierNotifyReason || 'auto_prep';
        const sent = await sendTelegramMessage(
            courier.chatId,
            formatCourierOrderForTelegram(order, reason),
            { reply_markup: buildCourierPaymentControls(order.id) },
            'courier'
        );

        if (!sent) {
            availableCouriers.push(courier);
            continue;
        }

        const index = orders.findIndex((item) => Number(item?.id) === Number(order?.id));
        if (index === -1) continue;
        orders[index] = {
            ...orders[index],
            courierAssignedId: courier.id,
            courierAssignedAt: new Date().toISOString(),
            courierNotified: true,
            courierNotifiedAt: new Date().toISOString(),
            courierNotifyReason: reason
        };
        clearCourierTimer(order.id);
        assignedCount += 1;
        changed = true;
    }

    if (changed) {
        saveOrders(orders);
    }
    return { assignedCount, reason: assignedCount > 0 ? 'ok' : 'empty_queue' };
}

async function notifyCourierForOrder(orderId, reason) {
    const settings = readBotSettings();
    if (!settings.enabled) {
        return { sent: false, reason: 'disabled' };
    }

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const found = findOrderById(orders, orderId);
    if (!found.order) {
        return { sent: false, reason: 'order_not_found' };
    }
    if (!isActiveDeliveryOrder(found.order)) {
        return { sent: false, reason: 'not_delivery' };
    }
    if (found.order.courierNotified || Number(found.order?.courierAssignedId || 0) > 0) {
        return { sent: false, reason: 'already_notified' };
    }

    const queueReason = String(reason || found.order?.courierNotifyReason || 'auto_prep');
    orders[found.index] = {
        ...found.order,
        courierQueuedAt: found.order?.courierQueuedAt || new Date().toISOString(),
        courierNotifyReason: queueReason
    };
    saveOrders(orders);

    const assignment = await assignQueuedOrders();
    const latestOrders = readOrders();
    const updated = findOrderById(latestOrders, orderId);
    const sent = Boolean(updated?.order?.courierAssignedId);

    if (sent) {
        clearCourierTimer(orderId);
        return { sent: true, reason: 'ok', order: updated.order };
    }
    return { sent: false, reason: assignment.reason || 'queued', order: updated.order };
}

async function notifyCourierHeadsUp(order) {
    const settings = readBotSettings();
    if (!settings.enabled) return false;
    if (!isActiveDeliveryOrder(order)) return false;
    const couriers = getConnectedCouriers(settings);
    if (!couriers.length) return false;
    const results = await Promise.all(couriers.map((courier) => (
        sendTelegramMessage(courier.chatId, formatCourierHeadsUpForTelegram(order), {}, 'courier')
    )));
    return results.some(Boolean);
}

async function notifyAdminDeliveryConfirmation(order) {
    const settings = readBotSettings();
    if (!settings.enabled || !settings.adminChatId) return false;
    return sendTelegramMessage(
        settings.adminChatId,
        [
            '<b>Buyurtma muvaffaqiyatli yetkazildi</b>',
            `<b>ID:</b> ${escapeTelegramText(order?.id)}`,
            `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
            `<b>Jami:</b> ${formatSoM(order?.total || 0)}`,
            `<b>To'lov olindi:</b> ${formatSoM(calcCollectAmount(order) || order?.total || 0)}`
        ].join('\n'),
        {},
        'admin'
    );
}

async function notifyOrderToTelegram(order) {
    const settings = readBotSettings();
    if (!settings.enabled || !settings.adminChatId) return false;
    return sendTelegramMessage(settings.adminChatId, formatOrderForTelegram(order), {}, 'admin');
}

async function handleAdminOrderLookup(chatKey, orderId) {
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const found = findOrderById(orders, orderId);
    if (!found.order) {
        await sendTelegramMessage(chatKey, `ID ${escapeTelegramText(orderId)} topilmadi.`, {}, 'admin');
        return;
    }

    const order = found.order;
    const mapLink = buildOrderMapLink(order);
    const coordsText = getOrderCoordsText(order);
    const mapLine = mapLink
        ? `<b>Xarita:</b> <a href="${escapeTelegramText(mapLink)}">Yandex xaritada ochish</a>`
        : '<b>Xarita:</b> Mavjud emas';
    const text = [
        `<b>Buyurtma #${escapeTelegramText(order.id)}</b>`,
        `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
        `<b>Telefon:</b> ${escapeTelegramText(order.phone || '-')}`,
        `<b>Manzil:</b> ${escapeTelegramText(order.address || '-')}`,
        `<b>Izoh:</b> ${escapeTelegramText(getOrderCommentText(order) || '-')}`,
        `<b>Koordinata:</b> ${escapeTelegramText(coordsText || 'Mavjud emas')}`,
        `<b>Jami:</b> ${formatSoM(order.total || 0)}`,
        `<b>Status:</b> ${escapeTelegramText(order.status || 'yangi')}`,
        `<b>Tayyor bo'lish:</b> ${escapeTelegramText(getOrderPrepMinutes(order))} daqiqa`,
        mapLine,
        '',
        'Tanlang:'
    ].join('\n');

    await sendTelegramMessage(chatKey, text, {
        reply_markup: buildAdminOrderControls(order.id)
    }, 'admin');
}

async function handleCourierOrderLookup(chatKey, orderId, settings) {
    const courier = findCourierByChatId(settings, chatKey);
    if (!courier) {
        await sendTelegramMessage(chatKey, 'Siz yetkazuvchi sifatida ulanmagansiz. /start yuboring.', {}, 'courier');
        return;
    }

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const found = findOrderById(orders, orderId);
    if (!found.order) {
        await sendTelegramMessage(chatKey, `ID ${escapeTelegramText(orderId)} topilmadi.`, {}, 'courier');
        return;
    }
    const assignedCourierId = Number(found.order?.courierAssignedId || 0);
    if (assignedCourierId && assignedCourierId !== Number(courier.id || 0)) {
        await sendTelegramMessage(chatKey, 'Bu buyurtma boshqa yetkazuvchiga biriktirilgan.', {}, 'courier');
        return;
    }
    if (!assignedCourierId) {
        await sendTelegramMessage(chatKey, 'Bu buyurtma hali sizga biriktirilmagan.', {}, 'courier');
        return;
    }

    await sendTelegramMessage(
        chatKey,
        formatCourierOrderForTelegram(found.order, 'manual_lookup'),
        { reply_markup: buildCourierPaymentControls(found.order.id) },
        'courier'
    );
}

function markOrderPaidAndDelivered(orderId, actorChatId) {
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const found = findOrderById(orders, orderId);
    if (!found.order) {
        return { ok: false, error: 'order_not_found' };
    }
    if (isOrderClosed(found.order) || Boolean(found.order?.paymentCollected)) {
        return { ok: false, error: 'already_closed', order: found.order };
    }

    orders[found.index] = {
        ...found.order,
        status: 'yakunlandi',
        paymentCollected: true,
        paymentStatus: 'paid',
        paymentCollectedAt: new Date().toISOString(),
        deliveryConfirmedAt: String(found.order?.deliveryConfirmedAt || new Date().toISOString()),
        courierPaidConfirmedBy: actorChatId ? String(actorChatId) : '',
        courierCompletedAt: new Date().toISOString()
    };
    saveOrders(orders);
    clearCourierTimer(orderId);
    return { ok: true, order: orders[found.index] };
}

async function handleTelegramCallbackAction(callbackQuery, settings) {
    const callbackId = callbackQuery?.id;
    const data = String(callbackQuery?.data || '');
    const message = callbackQuery?.message || {};
    const chatId = String(message?.chat?.id || callbackQuery?.from?.id || '');
    const messageId = Number(message?.message_id || 0);
    const adminMatch = data.match(/^admin_(ready|cancel|contact)_(\d+)$/);
    const courierMatch = data.match(/^courier_paid_(\d+)$/);
    const adminChatId = String(settings?.adminChatId || '');
    const courier = findCourierByChatId(settings, chatId);

    if (courierMatch) {
        if (!courier) {
            await answerTelegramCallbackQuery(callbackId, 'Faqat kuryer amali ruxsat etilgan', 'courier');
            return;
        }
        const orderId = Number(courierMatch[1]);
        const orders = readOrders();
        const found = findOrderById(orders, orderId);
        const assignedCourierId = Number(found?.order?.courierAssignedId || 0);
        if (assignedCourierId && assignedCourierId !== Number(courier.id || 0)) {
            await answerTelegramCallbackQuery(callbackId, 'Bu buyurtma sizga biriktirilmagan', 'courier');
            return;
        }

        const result = markOrderPaidAndDelivered(orderId, chatId);
        if (!result.ok) {
            const message = result.error === 'already_closed'
                ? 'Bu buyurtma allaqachon yopilgan'
                : 'Buyurtma topilmadi';
            await answerTelegramCallbackQuery(callbackId, message, 'courier');
            if (messageId > 0) {
                await editTelegramMessageMarkup(chatId, messageId, { inline_keyboard: [] }, 'courier');
            }
            return;
        }

        await notifyAdminDeliveryConfirmation(result.order);
        await answerTelegramCallbackQuery(callbackId, 'To\'lov tasdiqlandi', 'courier');
        if (messageId > 0) {
            const deleted = await deleteTelegramMessage(chatId, messageId, 'courier');
            if (!deleted) {
                await editTelegramMessageText(
                    chatId,
                    messageId,
                    `<b>Buyurtma #${escapeTelegramText(orderId)} bo'yicha pul olindi.</b>\n${escapeTelegramText(getCustomerDisplayName(result.order))}`,
                    { reply_markup: { inline_keyboard: [] } },
                    'courier'
                );
            }
        }

        await assignQueuedOrders();
        return;
    }

    if (!adminMatch) {
        await answerTelegramCallbackQuery(callbackId, 'Noma\'lum amal', 'admin');
        return;
    }

    if (adminChatId && chatId !== adminChatId) {
        await answerTelegramCallbackQuery(callbackId, 'Faqat admin amali ruxsat etilgan', 'admin');
        return;
    }

    const action = adminMatch[1];
    const orderId = Number(adminMatch[2]);
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const found = findOrderById(orders, orderId);
    if (!found.order) {
        await answerTelegramCallbackQuery(callbackId, 'Buyurtma topilmadi', 'admin');
        if (messageId > 0) await editTelegramMessageMarkup(chatId, messageId, null, 'admin');
        return;
    }

    const currentStatus = String(found.order?.status || '').trim().toLowerCase();
    if (isOrderClosed(found.order)) {
        await answerTelegramCallbackQuery(callbackId, 'Buyurtma yopilgan', 'admin');
        if (messageId > 0) {
            await editTelegramMessageMarkup(chatId, messageId, { inline_keyboard: [] }, 'admin');
        }
        return;
    }

    if (action === 'contact') {
        const order = found.order;
        const mapLink = buildOrderMapLink(order);
        const mapLine = mapLink
            ? `<a href="${escapeTelegramText(mapLink)}">Yandex xaritada ochish</a>`
            : 'Mavjud emas';
        await sendTelegramMessage(
            chatId,
            [
                `<b>Buyurtma #${escapeTelegramText(order.id)} bilan bog'lanish</b>`,
                `<b>Mijoz:</b> ${escapeTelegramText(getCustomerDisplayName(order))}`,
                `<b>Telefon:</b> ${escapeTelegramText(order.phone || '-')}`,
                `<b>Manzil:</b> ${escapeTelegramText(order.address || '-')}`,
                `<b>Izoh:</b> ${escapeTelegramText(getOrderCommentText(order) || '-')}`,
                `<b>Xarita:</b> ${mapLine}`
            ].join('\n'),
            {},
            'admin'
        );
        await answerTelegramCallbackQuery(callbackId, 'Kontakt yuborildi', 'admin');
        return;
    }

    if (action === 'cancel') {
        if (currentStatus !== 'yangi') {
            await answerTelegramCallbackQuery(callbackId, 'Faqat yangi buyurtma bekor qilinadi', 'admin');
            if (messageId > 0) {
                await editTelegramMessageMarkup(chatId, messageId, { inline_keyboard: [] }, 'admin');
            }
            return;
        }
        orders[found.index] = {
            ...found.order,
            status: 'bekor',
            paymentCollected: false,
            cancelledAt: new Date().toISOString()
        };
        saveOrders(orders);
        clearCourierTimer(orderId);
        await answerTelegramCallbackQuery(callbackId, 'Bekor qilindi', 'admin');
        if (messageId > 0) {
            await editTelegramMessageText(
                chatId,
                messageId,
                `<b>Buyurtma #${escapeTelegramText(orderId)} bekor qilindi.</b>`,
                { reply_markup: { inline_keyboard: [] } },
                'admin'
            );
        }
        assignQueuedOrders().catch(() => {});
        return;
    }

    if (action === 'ready' && currentStatus !== 'yangi') {
        await answerTelegramCallbackQuery(callbackId, 'Buyurtma allaqachon boshqarilgan', 'admin');
        if (messageId > 0) {
            await editTelegramMessageMarkup(chatId, messageId, { inline_keyboard: [] }, 'admin');
        }
        return;
    }

    orders[found.index] = {
        ...found.order,
        status: 'tayyorlandi',
        readyAt: new Date().toISOString()
    };
    saveOrders(orders);
    clearCourierTimer(orderId);

    const courierResult = await notifyCourierForOrder(orderId, 'admin_ready');
    let courierText = 'Yetkazib beruvchiga yuborilmadi (ulanish/parol tekshiring).';
    if (courierResult.sent) {
        courierText = 'Yetkazib beruvchiga yuborildi.';
    } else if (['queued', 'courier_busy', 'empty_queue', 'courier_not_connected'].includes(courierResult.reason)) {
        courierText = 'Navbatga qo\'yildi. Kuryer bo\'shashi bilan yuboriladi.';
    }

    await answerTelegramCallbackQuery(callbackId, 'Tayyor deb belgilandi', 'admin');
    if (messageId > 0) {
        await editTelegramMessageText(
            chatId,
            messageId,
            `<b>Buyurtma #${escapeTelegramText(orderId)} tayyorlandi.</b>\n${escapeTelegramText(courierText)}`,
            { reply_markup: { inline_keyboard: [] } },
            'admin'
        );
    }
}

async function handleAuthorizedTextMessage(text, chatKey, settings) {
    const lower = text.toLowerCase();
    const adminChatId = String(settings?.adminChatId || '');
    const courier = findCourierByChatId(settings, chatKey);
    const isAdmin = adminChatId && adminChatId === chatKey;
    const isCourier = Boolean(courier);

    if (lower === '/start' || lower === '/login' || lower === '/admin' || lower === '/courier' || lower === '/kuryer') {
        const role = lower === '/admin'
            ? 'admin'
            : (lower === '/courier' || lower === '/kuryer')
                ? 'courier'
                : 'any';
        telegramRuntime.pendingPasswordChats.set(chatKey, role);
        const prompt = role === 'admin'
            ? 'Admin parolini kiriting.'
            : role === 'courier'
                ? 'Yetkazuvchi parolini kiriting.'
                : 'Parolni kiriting.';
        await sendTelegramMessage(chatKey, prompt, {}, 'admin');
        return;
    }

    const pendingRole = telegramRuntime.pendingPasswordChats.get(chatKey);
    if (pendingRole) {
        const password = String(text || '').trim();
        if (!password) {
            await sendTelegramMessage(chatKey, 'Parolni kiriting.', {}, 'admin');
            return;
        }

        const matchingCourier = findCourierByPassword(settings, password);
        const canLoginAdmin = password === resolveTelegramAdminPassword(settings);

        if (pendingRole === 'admin') {
            if (!canLoginAdmin) {
                await sendTelegramMessage(chatKey, 'Admin paroli noto\'g\'ri. Qaytadan kiriting.', {}, 'admin');
                return;
            }
            telegramRuntime.pendingPasswordChats.delete(chatKey);
            settings.adminChatId = chatKey;
            saveBotSettings(settings);
            await sendTelegramMessage(chatKey, 'Admin sifatida ulandingiz.', {}, 'admin');
            return;
        }

        if (pendingRole === 'courier') {
            if (!matchingCourier) {
                await sendTelegramMessage(chatKey, 'Parol noto\'g\'ri yoki kuryer topilmadi.', {}, 'courier');
                return;
            }
            if (matchingCourier.chatId && String(matchingCourier.chatId) !== chatKey) {
                await sendTelegramMessage(chatKey, 'Bu parol allaqachon ishlatilgan.', {}, 'courier');
                return;
            }
            telegramRuntime.pendingPasswordChats.delete(chatKey);
            settings.couriers = (Array.isArray(settings.couriers) ? settings.couriers : []).map((item) => (
                Number(item?.id || 0) === Number(matchingCourier.id || 0)
                    ? { ...item, chatId: chatKey, connectedAt: new Date().toISOString() }
                    : (
                        String(item?.chatId || '').trim() === chatKey
                            ? { ...item, chatId: '', connectedAt: '' }
                            : item
                    )
            ));
            saveBotSettings(settings);
            const label = matchingCourier.label || matchingCourier.id;
            await sendTelegramMessage(chatKey, `Siz ${label}-raqamli yetkazuvchi sifatida ulandingiz.`, {}, 'courier');
            assignQueuedOrders().catch(() => {});
            return;
        }

        if (canLoginAdmin) {
            telegramRuntime.pendingPasswordChats.delete(chatKey);
            settings.adminChatId = chatKey;
            saveBotSettings(settings);
            await sendTelegramMessage(chatKey, 'Admin sifatida ulandingiz.', {}, 'admin');
            return;
        }
        if (matchingCourier) {
            if (matchingCourier.chatId && String(matchingCourier.chatId) !== chatKey) {
                await sendTelegramMessage(chatKey, 'Bu parol allaqachon ishlatilgan.', {}, 'courier');
                return;
            }
            telegramRuntime.pendingPasswordChats.delete(chatKey);
            settings.couriers = (Array.isArray(settings.couriers) ? settings.couriers : []).map((item) => (
                Number(item?.id || 0) === Number(matchingCourier.id || 0)
                    ? { ...item, chatId: chatKey, connectedAt: new Date().toISOString() }
                    : (
                        String(item?.chatId || '').trim() === chatKey
                            ? { ...item, chatId: '', connectedAt: '' }
                            : item
                    )
            ));
            saveBotSettings(settings);
            const label = matchingCourier.label || matchingCourier.id;
            await sendTelegramMessage(chatKey, `Siz ${label}-raqamli yetkazuvchi sifatida ulandingiz.`, {}, 'courier');
            assignQueuedOrders().catch(() => {});
            return;
        }

        await sendTelegramMessage(chatKey, 'Parol noto\'g\'ri. Qaytadan kiriting.', {}, 'admin');
        return;
    }

    if (!isAdmin && !isCourier) {
        await sendTelegramMessage(chatKey, 'Avval /start yuboring va parol bilan kiring.', {}, 'admin');
        return;
    }

    if (isAdmin) {
        if (lower === '/status') {
            const statusText = settings.enabled ? 'yoqilgan' : 'o\'chirilgan';
            const couriers = Array.isArray(settings.couriers) ? settings.couriers : [];
            const connectedCount = couriers.filter((item) => String(item?.chatId || '').trim()).length;
            await sendTelegramMessage(
                chatKey,
                `Bot: ${statusText}\nAdmin: ulangan\nKuryerlar: ${connectedCount}/${couriers.length}`,
                {},
                'admin'
            );
            return;
        }
        if (lower === '/on') {
            settings.enabled = true;
            saveBotSettings(settings);
            await sendTelegramMessage(chatKey, 'Yoqildi. Endi yangi buyurtmalar botga yuboriladi.', {}, 'admin');
            assignQueuedOrders().catch(() => {});
            return;
        }
        if (lower === '/off') {
            settings.enabled = false;
            saveBotSettings(settings);
            await sendTelegramMessage(chatKey, 'O\'chirildi. Buyurtmalar faqat saytda qoladi.', {}, 'admin');
            return;
        }
        if (lower === '/help') {
            await sendTelegramMessage(
                chatKey,
                '/status - holat\n/on - yoqish\n/off - o\'chirish\nID yuboring (masalan 23) - buyurtmani boshqarish',
                {},
                'admin'
            );
            return;
        }

        if (/^\d+$/.test(text)) {
            await handleAdminOrderLookup(chatKey, Number(text));
            return;
        }

        await sendTelegramMessage(chatKey, 'Buyurtmani boshqarish uchun ID yuboring (masalan 23).', {}, 'admin');
        return;
    }

    if (lower === '/status' || lower === '/help') {
        const label = courier?.label || courier?.id || '';
        await sendTelegramMessage(
            chatKey,
            `Siz ${label ? `${label}-raqamli ` : ''}yetkazuvchi sifatida ulandingiz. Vazifa kelsa shu botga tushadi.`,
            {},
            'courier'
        );
        return;
    }
    if (/^\d+$/.test(text)) {
        await handleCourierOrderLookup(chatKey, Number(text), settings);
        return;
    }
    await sendTelegramMessage(chatKey, 'Buyurtma ID sini yuboring, keyin "Pul oldim" tugmasi chiqadi.', {}, 'courier');
}

async function pollTelegramUpdatesOnce() {
    const botToken = getTelegramBotToken('admin');
    if (!botToken) return;
    const settings = readBotSettings();
    const updateField = 'adminLastUpdateId';
    const offset = Number(settings[updateField] || 0) + 1;
    const updatesUrl = `https://api.telegram.org/bot${botToken}/getUpdates`;

    let response;
    try {
        response = await fetch(updatesUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                offset,
                limit: 25,
                timeout: 0,
                allowed_updates: ['message', 'callback_query']
            })
        });
    } catch (err) {
        return;
    }

    if (!response.ok) return;

    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        return;
    }
    if (!payload?.ok || !Array.isArray(payload.result) || payload.result.length === 0) return;

    let dirty = false;
    for (const update of payload.result) {
        const updateId = Number(update?.update_id || 0);
        if (updateId > Number(settings[updateField] || 0)) {
            settings[updateField] = updateId;
            dirty = true;
        }

        const callbackQuery = update?.callback_query;
        if (callbackQuery?.id) {
            await handleTelegramCallbackAction(callbackQuery, settings);
            continue;
        }

        const text = String(update?.message?.text || '').trim();
        const chatId = update?.message?.chat?.id;
        if (!text || !chatId) continue;
        const chatKey = String(chatId);
        await handleAuthorizedTextMessage(text, chatKey, settings);
    }

    if (dirty) {
        saveBotSettings(settings);
    }
}

function startTelegramPolling() {
    const token = getTelegramBotToken('admin');
    if (!token) {
        console.warn('Telegram bot disabled: token topilmadi');
        return;
    }

    syncCourierTimersFromDb();
    assignQueuedOrders().catch(() => {});

    if (telegramRuntime.timer) return;
    telegramRuntime.timer = setInterval(async () => {
        if (telegramRuntime.polling) return;
        telegramRuntime.polling = true;
        try {
            await pollTelegramUpdatesOnce();
        } finally {
            telegramRuntime.polling = false;
        }
    }, TELEGRAM_POLL_INTERVAL_MS);

    pollTelegramUpdatesOnce().catch(() => {});
}

// === AUTHENTICATION ROUTES ===

// Google bilan kirishni boshlash
// Qo'shimcha: ?email=<user@gmail.com> yuborilsa, Google-ga login_hint sifatida uzatiladi
app.get('/auth/google', (req, res, next) => {
    if (!GOOGLE_OAUTH_ENABLED) {
        return res.status(503).send('Google OAuth serverda sozlanmagan. .env ichida GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET kiriting.');
    }
    const emailHint = (req.query.email || '').toString().trim().toLowerCase();
    const prompt = req.query.prompt === 'select_account' ? 'select_account' : undefined;
    const options = { scope: ['profile', 'email'] };

    if (prompt) {
        options.prompt = prompt;
    }

    if (emailHint) {
        if (!emailHint.endsWith('@gmail.com')) {
            return res.status(400).json({ message: 'Faqat @gmail.com manzili qabul qilinadi.' });
        }
        options.loginHint = emailHint;
        options.login_hint = emailHint;
        if (!options.prompt) options.prompt = 'consent';
    }

    passport.authenticate('google', options)(req, res, next);
});

// Xavfsizlik uchun manual login o'chirilgan. Login faqat Google OAuth orqali.
app.post('/auth/manual', (_req, res) => {
    res.status(410).json({ message: 'Manual login o`chirilgan. Iltimos, Google bilan kiring.' });
});

// Google'dan qaytib kelgandan so'ng
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    function(req, res) {
        authDebugLog('Google callback: req.user exists?', Boolean(req.user));
        if (req.user) {
            authDebugLog('Google callback: User ID:', req.user.id, 'Display Name:', req.user.displayName);
        }

        const rememberToken = ensureRememberToken(req.user);
        if (rememberToken) {
            authDebugLog('Google callback: Setting remember token cookie.');
            res.cookie(REMEMBER_COOKIE_NAME, rememberToken, {
                maxAge: REMEMBER_COOKIE_MAX_AGE,
                httpOnly: true,
                sameSite: 'lax'
            });
        } else {
            authDebugLog('Google callback: No remember token generated or found.');
        }
        
        // Session'ni flush qilish - cookies shu darmon orasida set bo'ladi
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            // Muvaffaqiyatli autentifikatsiya, asosiy sahifaga qaytaramiz.
            res.redirect('/');
        });
    });

// Foydalanuvchi ma'lumotlarini olish
app.get('/api/user', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    // Check authenticated
    if (!req.isAuthenticated()) {
        // Agar authenticated emas bo'lsa, status 401
        return res.status(401).json({ message: 'Not Authenticated' });
    }
    
    // User authenticated, token refresh qilish
    const rememberToken = ensureRememberToken(req.user);
    if (rememberToken) {
        res.cookie(REMEMBER_COOKIE_NAME, rememberToken, {
            maxAge: REMEMBER_COOKIE_MAX_AGE,
            httpOnly: true,
            sameSite: 'lax'
        });
    }
    res.json(req.user);
});

// Chiqish
app.get('/logout', (req, res, next) => {
    const userId = req.user?.id;
    if (userId) {
        const users = readUsers();
        const idx = users.findIndex(u => String(u.id) === String(userId));
        if (idx !== -1) {
            users[idx].rememberToken = createRememberToken();
            saveUsers(users);
        }
    }
    req.logout(function(err) {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.clearCookie(REMEMBER_COOKIE_NAME);
            res.redirect('/');
        });
    });
});


// === API ENDPOINTS ===

// 1. BARCHA FAOLLARNI OLISH
app.get('/api/foods', (req, res) => {
    const foods = readFoods();
    res.json(foods);
});

// Users: create or get by email
app.post('/api/users', (req, res) => {
    const { email, phone } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

    const users = readUsers();
    let user;
    if (email) {
        user = users.find(u => u.email === email);
        if (!user) {
            user = { id: Date.now(), email };
            users.push(user);
            saveUsers(users);
        }
    } else {
        user = users.find(u => u.phone === phone);
        if (!user) {
            user = { id: Date.now(), phone };
            users.push(user);
            saveUsers(users);
        }
    }
    res.json(user);
});

// Orders: store and list
app.get('/api/orders', (req, res) => {
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const requestedUserId = String(req.query?.userId || '').trim();
    const requestedEmail = String(req.query?.email || '').trim().toLowerCase();
    const requestedSessionId = String(req.query?.sessionId || '').trim();

    let result = orders;
    if (requestedUserId || requestedEmail) {
        result = result.filter((order) => {
            const orderUserId = String(order?.userId || '').trim();
            const orderEmail = String(order?.email || '').trim().toLowerCase();
            if (requestedUserId && orderUserId && requestedUserId === orderUserId) return true;
            return Boolean(requestedEmail && orderEmail && requestedEmail === orderEmail);
        });
    }
    if (requestedSessionId) {
        result = result.filter((order) => String(order?.sessionId || '').trim() === requestedSessionId);
    }
    res.json(result);
});

app.post('/api/orders', async (req, res) => {
    const order = req.body;
    if (!order) return res.status(400).json({ error: 'Order data required' });

    const isManualAdminOrder = String(order?.userId || '').trim() === 'admin';
    const siteState = readSiteState();
    if (!siteState.orderingEnabled && !isManualAdminOrder) {
        return res.status(409).json({
            error: 'Sayt hozir buyurtma qabul qilmayapti',
            code: 'ORDERING_DISABLED'
        });
    }

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }

    if (!isManualAdminOrder) {
        const blockingOrder = findBlockingCustomerOrder(orders, order);
        if (blockingOrder) {
            return res.status(409).json({
                error: 'Oldingi buyurtma yakunlanmagan. Avval shu buyurtmani tugating.',
                code: 'ACTIVE_ORDER_EXISTS',
                activeOrder: blockingOrder
            });
        }
    }

    if (!isManualAdminOrder) {
        const siteSettings = readSiteSettings();
        const maxDeliveryKm = Number(siteSettings?.maxDeliveryKm || 0);
        const maxItemQuantity = Number(siteSettings?.maxItemQuantity || 0);
        const deliveryType = normalizeDeliveryType(order?.deliveryType || (Number(order?.delivery || 0) > 0 ? 'home' : 'pickup'));
        if (deliveryType === 'home' && maxDeliveryKm > 0) {
            const distanceKm = Number(order?.distanceKm || 0);
            if (Number.isFinite(distanceKm) && distanceKm > maxDeliveryKm) {
                return res.status(409).json({
                    error: buildOrderBlockMessage('distance', maxDeliveryKm, siteSettings?.contactPhone),
                    code: 'ORDER_DISTANCE_LIMIT'
                });
            }
        }
        if (maxItemQuantity > 0) {
            const maxQty = getMaxItemQuantity(order?.items);
            if (Number.isFinite(maxQty) && maxQty > maxItemQuantity) {
                return res.status(409).json({
                    error: buildOrderBlockMessage('quantity', maxItemQuantity, siteSettings?.contactPhone),
                    code: 'ORDER_ITEM_LIMIT'
                });
            }
        }
    }

    const createdAtMs = parseOrderDateToMs(order) || Date.now();
    order.status = String(order.status || 'yangi').toLowerCase();
    order.id = orders.length + 1;
    order.createdAtMs = createdAtMs;
    order.createdAt = String(order.createdAt || new Date(createdAtMs).toISOString());
    order.date = String(order.date || new Date(createdAtMs).toLocaleString('uz-UZ'));
    order.deliveryType = normalizeDeliveryType(order.deliveryType || (Number(order.delivery || 0) > 0 ? 'home' : 'pickup'));
    order.prepMinutes = getOrderPrepMinutes(order);
    order.customerCoords = normalizeOrderCoords(order.customerCoords);
    order.customerMapLink = String(order.customerMapLink || '').trim();
    order.customerName = String(order.customerName || '').trim();
    order.customerComment = sanitizeOrderComment(order.customerComment || order.comment || '');
    let customerRegion = sanitizeLocationLabel(order.customerRegion);
    if (!customerRegion || customerRegion === '-') {
        const fromAddress = extractRegionFromAddress(order.address || '');
        if (fromAddress && fromAddress !== '-') {
            customerRegion = fromAddress;
        }
    }
    if ((!customerRegion || customerRegion === '-') && order.customerCoords) {
        const fromCoords = await resolveRegionFromCoords(order.customerCoords);
        if (fromCoords) {
            customerRegion = fromCoords;
        }
    }
    const detectedRegion = detectUzbekRegionLabel(customerRegion);
    order.customerRegion = detectedRegion || customerRegion || '-';
    order.paymentCollected = Boolean(order.paymentCollected) || isPaymentCollected(order);
    order.sessionId = String(order.sessionId || siteState.currentSessionId || '');
    order.deliveryConfirmedAt = order.deliveryConfirmedAt ? String(order.deliveryConfirmedAt) : '';
    order.paymentCollectedAt = order.paymentCollectedAt ? String(order.paymentCollectedAt) : '';
    orders.push(order);
    saveOrders(orders);

    notifyOrderToTelegram(order).catch((err) => {
        console.error('Telegram notify error:', err?.message || err);
    });
    notifyCourierHeadsUp(order).catch(() => {});
    if (isActiveDeliveryOrder(order)) {
        const prepMinutes = getOrderPrepMinutes(order);
        scheduleCourierNotification(order.id, prepMinutes * 60 * 1000, 'auto_prep');
    }

    res.status(201).json(order);
});

app.put('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const allowed = ['yangi', 'tayyorlandi', 'yolda', 'yakunlandi', 'bekor'];

    if (!allowed.includes(nextStatus)) {
        return res.status(400).json({ error: 'Status noto`g`ri' });
    }

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    const index = orders.findIndex(o => Number(o.id) === Number(id));
    if (index === -1) {
        return res.status(404).json({ error: 'Buyurtma topilmadi' });
    }

    const current = orders[index];
    const currentStatus = String(current?.status || '').trim().toLowerCase();
    if (isOrderClosed(current)) {
        return res.status(409).json({ error: 'Buyurtma yopilgan, qayta boshqarib bo\'lmaydi' });
    }
    if (!canTransitionOrderStatus(currentStatus, nextStatus)) {
        return res.status(409).json({
            error: `Status o'zgarishi ruxsat etilmagan: ${currentStatus || '-'} -> ${nextStatus}`
        });
    }
    if (currentStatus === nextStatus) {
        return res.json(current);
    }

    orders[index] = {
        ...current,
        status: nextStatus,
        deliveryConfirmedAt: nextStatus === 'yakunlandi'
            ? String(current?.deliveryConfirmedAt || new Date().toISOString())
            : String(current?.deliveryConfirmedAt || ''),
        paymentCollected: Boolean(current?.paymentCollected) || isPaymentCollected(current),
        cancelledAt: nextStatus === 'bekor'
            ? new Date().toISOString()
            : String(current?.cancelledAt || '')
    };
    saveOrders(orders);
    if (nextStatus === 'bekor') {
        clearCourierTimer(id);
        assignQueuedOrders().catch(() => {});
    }
    if (nextStatus === 'yakunlandi') {
        clearCourierTimer(id);
        assignQueuedOrders().catch(() => {});
    }
    if (nextStatus === 'tayyorlandi') {
        clearCourierTimer(id);
        notifyCourierForOrder(id, 'admin_ready').catch(() => {});
    }
    return res.json(orders[index]);
});

app.get('/api/site-state', (req, res) => {
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    return res.json(getSiteStateSnapshot(readSiteState(), orders));
});

app.get('/api/admin/site-state', (req, res) => {
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    return res.json(getSiteStateSnapshot(readSiteState(), orders));
});

app.get('/api/settings', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.json(getPublicSiteSettingsSnapshot());
});

app.get('/api/admin/settings', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.json(getAdminSiteSettingsSnapshot());
});

app.put('/api/admin/settings', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const siteName = String(req.body?.siteName || '').trim();
    const freeDeliveryKm = Number(req.body?.freeDeliveryKm);
    const deliveryPricePerKm = Number(req.body?.deliveryPricePerKm);
    const deliveryMinutesPerKm = Number(req.body?.deliveryMinutesPerKm);
    const maxDeliveryKm = Number(req.body?.maxDeliveryKm);
    const maxItemQuantity = Number(req.body?.maxItemQuantity);
    const contactPhone = String(req.body?.contactPhone || '').trim();
    const adminPanelPassword = String(req.body?.adminPanelPassword || '').trim();
    const restaurantName = String(req.body?.restaurantName || '').trim();
    const restaurantAddress = String(req.body?.restaurantAddress || '').trim();
    const restaurantLat = Number(req.body?.restaurantLat);
    const restaurantLon = Number(req.body?.restaurantLon);
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];

    if (!Number.isFinite(freeDeliveryKm) || freeDeliveryKm < 0) {
        return res.status(400).json({ error: 'Tekin km noto\'g\'ri' });
    }
    if (!Number.isFinite(deliveryPricePerKm) || deliveryPricePerKm < 0) {
        return res.status(400).json({ error: '1 km narxi noto\'g\'ri' });
    }
    if (!Number.isFinite(deliveryMinutesPerKm) || deliveryMinutesPerKm <= 0) {
        return res.status(400).json({ error: 'Vaqt formulasi noto\'g\'ri' });
    }
    if (!Number.isFinite(maxDeliveryKm) || maxDeliveryKm < 0) {
        return res.status(400).json({ error: 'Maksimal masofa noto\'g\'ri' });
    }
    if (!Number.isFinite(maxItemQuantity) || maxItemQuantity < 0) {
        return res.status(400).json({ error: 'Maksimal taom soni noto\'g\'ri' });
    }
    if (!restaurantAddress) {
        return res.status(400).json({ error: 'Restoran manzili bo\'sh bo\'lmasligi kerak' });
    }
    if (!Number.isFinite(restaurantLat) || restaurantLat < -90 || restaurantLat > 90) {
        return res.status(400).json({ error: 'Restoran kenglik (lat) noto\'g\'ri' });
    }
    if (!Number.isFinite(restaurantLon) || restaurantLon < -180 || restaurantLon > 180) {
        return res.status(400).json({ error: 'Restoran uzunlik (lon) noto\'g\'ri' });
    }

    const currentSettings = readSiteSettings();
    const previousSiteName = String(currentSettings.siteName || '').trim();
    const previousRestaurantName = String(currentSettings.restaurantName || '').trim();
    let finalSiteName = String(siteName || '').trim();
    let finalRestaurantName = String(restaurantName || '').trim();
    if (finalSiteName && finalSiteName !== previousSiteName && finalRestaurantName === previousRestaurantName) {
        finalRestaurantName = finalSiteName;
    }
    if (finalRestaurantName && finalRestaurantName !== previousRestaurantName && finalSiteName === previousSiteName) {
        finalSiteName = finalRestaurantName;
    }
    if (!finalSiteName) {
        return res.status(400).json({ error: 'Joy nomi bo\'sh bo\'lmasligi kerak' });
    }
    if (!finalRestaurantName) {
        return res.status(400).json({ error: 'Restoran nomi bo\'sh bo\'lmasligi kerak' });
    }
    const saved = saveSiteSettings({
        ...currentSettings,
        siteName: finalSiteName,
        freeDeliveryKm,
        deliveryPricePerKm,
        deliveryMinutesPerKm,
        maxDeliveryKm,
        maxItemQuantity,
        contactPhone,
        adminPanelPassword: adminPanelPassword || currentSettings.adminPanelPassword || '123',
        restaurantName: finalRestaurantName,
        restaurantAddress,
        restaurantLat,
        restaurantLon,
        categories
    });
    return res.json({
        siteName: saved.siteName,
        freeDeliveryKm: saved.freeDeliveryKm,
        deliveryPricePerKm: saved.deliveryPricePerKm,
        deliveryMinutesPerKm: saved.deliveryMinutesPerKm,
        maxDeliveryKm: saved.maxDeliveryKm,
        maxItemQuantity: saved.maxItemQuantity,
        contactPhone: saved.contactPhone,
        adminPanelPassword: saved.adminPanelPassword,
        restaurantName: saved.restaurantName,
        restaurantAddress: saved.restaurantAddress,
        restaurantLat: saved.restaurantLat,
        restaurantLon: saved.restaurantLon,
        categories: saved.categories
    });
});

app.post('/api/admin/site-control/start', (req, res) => {
    clearAllCourierTimers();
    const current = readSiteState();
    const currentOrders = readOrders();
    if (normalizeOrderIds(currentOrders)) {
        saveOrders(currentOrders);
    }
    const currentSnapshot = getSiteStateSnapshot(current, currentOrders);
    const preservedTotalRevenue = Math.max(0, Number(currentSnapshot?.totalRevenue || 0) || 0);
    const nextState = saveSiteState({
        ...current,
        orderingEnabled: true,
        currentSessionId: `session-${Date.now()}`,
        sessionStartedAt: new Date().toISOString(),
        sessionStoppedAt: '',
        lastSessionReport: null,
        totalRevenueCarry: preservedTotalRevenue,
        totalRevenueOffset: 0
    });
    const resetOrders = [];
    saveOrders(resetOrders);
    return res.json(getSiteStateSnapshot(nextState, resetOrders));
});

app.post('/api/admin/site-control/stop', (req, res) => {
    clearAllCourierTimers();
    const current = readSiteState();
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }

    const stoppedAt = new Date().toISOString();
    const report = buildSessionReport(orders, {
        ...current,
        sessionStoppedAt: stoppedAt
    });

    const nextState = saveSiteState({
        ...current,
        orderingEnabled: false,
        sessionStoppedAt: stoppedAt,
        lastSessionReport: report
    });
    return res.json(getSiteStateSnapshot(nextState, orders));
});

app.post('/api/admin/revenue/reset', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const current = readSiteState();
    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }

    const rawTotalRevenue = orders.reduce((sum, order) => sum + getOrderRevenueAmount(order), 0);
    const nextState = saveSiteState({
        ...current,
        totalRevenueCarry: 0,
        totalRevenueOffset: rawTotalRevenue,
        totalRevenueResetAt: new Date().toISOString()
    });
    return res.json(getSiteStateSnapshot(nextState, orders));
});

app.get('/api/users', (_req, res) => {
    const users = readUsers();
    const safeUsers = users.map((u) => ({
        id: u.id,
        displayName: u.displayName || '',
        email: u.email || '',
        phone: u.phone || '',
        googleId: u.googleId || ''
    }));
    res.json(safeUsers);
});

app.get('/api/admin/telegram-settings', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json(getTelegramSettingsSnapshot());
});

app.put('/api/admin/telegram-settings', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const enabled = Boolean(req.body?.enabled);
    const current = readBotSettings();
    current.enabled = enabled;
    saveBotSettings(current);
    return res.json(getTelegramSettingsSnapshot());
});

app.post('/api/admin/telegram-token', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const token = normalizeTelegramToken(req.body?.token);
    if (!token) {
        return res.status(400).json({ error: 'token talab qilinadi' });
    }

    const settings = readBotSettings();
    const currentAdminToken = resolveTelegramToken('admin', settings);
    const adminChanged = createTokenFingerprint(currentAdminToken) !== createTokenFingerprint(token);

    settings.adminBotToken = token;
    if (adminChanged) {
        settings.adminChatId = '';
        settings.adminLastUpdateId = 0;
        settings.couriers = (Array.isArray(settings.couriers) ? settings.couriers : []).map((courier) => ({
            ...courier,
            chatId: '',
            connectedAt: ''
        }));
    }
    saveBotSettings(settings);
    startTelegramPolling();
    return res.json(getTelegramSettingsSnapshot());
});

app.put('/api/admin/telegram-admin-password', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const password = String(req.body?.password || '').trim();
    if (!password) {
        return res.status(400).json({ error: 'Admin paroli talab qilinadi' });
    }
    const settings = readBotSettings();
    settings.telegramAdminPassword = password;
    saveBotSettings(settings);
    return res.json({ ok: true });
});

app.post('/api/admin/couriers', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const password = String(req.body?.password || '').trim();
    if (!password) {
        return res.status(400).json({ error: 'password talab qilinadi' });
    }
    const settings = readBotSettings();
    if (password === resolveTelegramAdminPassword(settings)) {
        return res.status(400).json({ error: 'Bu parol admin paroli bilan bir xil bo\'lmasin' });
    }
    const existing = findCourierByPassword(settings, password);
    if (existing) {
        return res.status(409).json({ error: 'Bu parol oldin yaratilgan' });
    }

    const nextId = getNextCourierId(settings.couriers);
    const courier = {
        id: nextId,
        label: String(nextId),
        password,
        chatId: '',
        createdAt: new Date().toISOString(),
        connectedAt: ''
    };
    settings.couriers = [...(Array.isArray(settings.couriers) ? settings.couriers : []), courier];
    saveBotSettings(settings);

    const connectedCount = settings.couriers.filter((item) => String(item?.chatId || '').trim()).length;
    return res.json({
        ok: true,
        courier: { id: courier.id, label: courier.label },
        courierTotal: settings.couriers.length,
        courierConnectedCount: connectedCount
    });
});

app.get('/api/admin/couriers', (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const settings = readBotSettings();
    const orders = readOrders();
    let changed = false;
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
        changed = true;
    }
    if (syncLegacyCourierAssignments(orders, settings.couriers)) {
        saveOrders(orders);
        changed = true;
    }
    if (changed) {
        // Ensure timers align with latest data
        syncCourierTimersFromDb();
    }

    const couriers = Array.isArray(settings.couriers) ? settings.couriers : [];
    const courierStats = couriers.map((courier) => {
        const id = Number(courier?.id || 0);
        const assignedOrders = orders.filter((order) => Number(order?.courierAssignedId || 0) === id);
        const activeOrders = assignedOrders.filter((order) => isActiveDeliveryOrder(order)).length;
        const completedOrders = assignedOrders.filter((order) => String(order?.status || '').trim().toLowerCase() === 'yakunlandi').length;
        return {
            id: courier.id,
            label: courier.label,
            password: courier.password,
            connected: Boolean(String(courier?.chatId || '').trim()),
            chatId: courier.chatId ? String(courier.chatId) : '',
            createdAt: courier.createdAt || '',
            connectedAt: courier.connectedAt || '',
            activeOrders,
            completedOrders,
            totalOrders: assignedOrders.length
        };
    });

    const totals = {
        total: couriers.length,
        connected: courierStats.filter((courier) => courier.connected).length,
        activeOrders: courierStats.reduce((sum, courier) => sum + Number(courier.activeOrders || 0), 0)
    };
    return res.json({ ok: true, couriers: courierStats, totals });
});

app.delete('/api/admin/couriers/:id', async (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const rawId = String(req.params.id || '').trim();
    if (!rawId) {
        return res.status(400).json({ error: 'courierId talab qilinadi' });
    }

    const settings = readBotSettings();
    const couriers = Array.isArray(settings.couriers) ? settings.couriers : [];
    const index = couriers.findIndex((courier) => String(courier?.id) === rawId || String(courier?.label) === rawId);
    if (index === -1) {
        return res.status(404).json({ error: 'Kuryer topilmadi' });
    }
    const removed = couriers[index];
    settings.couriers = couriers.filter((_, idx) => idx !== index);
    saveBotSettings(settings);

    const orders = readOrders();
    let changed = false;
    const now = new Date().toISOString();
    orders.forEach((order, idx) => {
        if (Number(order?.courierAssignedId || 0) !== Number(removed?.id || 0)) return;
        orders[idx] = {
            ...order,
            courierAssignedId: 0,
            courierAssignedAt: '',
            courierNotified: false,
            courierNotifiedAt: '',
            courierNotifyReason: String(order?.courierNotifyReason || 'admin_remove'),
            courierQueuedAt: order?.courierQueuedAt || now
        };
        changed = true;
    });
    if (changed) {
        saveOrders(orders);
    }

    try {
        await assignQueuedOrders();
    } catch (err) {
        console.error('Assign queued orders after courier delete error:', err?.message || err);
    }

    return res.json({ ok: true });
});

app.post('/api/admin/couriers/assign', async (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const courierId = Number(req.body?.courierId || 0);
    if (!Number.isFinite(courierId) || courierId <= 0) {
        return res.status(400).json({ error: 'courierId talab qilinadi' });
    }
    const orderIds = parseOrderIdList(req.body?.orderIds);
    if (!orderIds.length) {
        return res.status(400).json({ error: 'orderIds talab qilinadi' });
    }

    const settings = readBotSettings();
    const courier = (Array.isArray(settings.couriers) ? settings.couriers : [])
        .find((item) => Number(item?.id || 0) === courierId);
    if (!courier) {
        return res.status(404).json({ error: 'Kuryer topilmadi' });
    }
    if (!String(courier?.chatId || '').trim()) {
        return res.status(409).json({ error: 'Kuryer hali Telegramga ulanmagan' });
    }

    const orders = readOrders();
    if (normalizeOrderIds(orders)) {
        saveOrders(orders);
    }
    if (syncLegacyCourierAssignments(orders, settings.couriers)) {
        saveOrders(orders);
    }

    const assignedIds = [];
    const failedIds = [];
    const missingIds = [];
    const skippedIds = [];
    const now = new Date().toISOString();

    for (const orderId of orderIds) {
        const found = findOrderById(orders, orderId);
        if (!found.order) {
            missingIds.push(orderId);
            continue;
        }
        if (!isActiveDeliveryOrder(found.order)) {
            skippedIds.push(orderId);
            continue;
        }

        orders[found.index] = {
            ...found.order,
            courierAssignedId: courier.id,
            courierAssignedAt: now,
            courierQueuedAt: '',
            courierNotified: false,
            courierNotifiedAt: '',
            courierNotifyReason: 'admin_manual'
        };
        clearCourierTimer(orderId);

        const sent = await sendTelegramMessage(
            courier.chatId,
            formatCourierOrderForTelegram(orders[found.index], 'admin_manual'),
            { reply_markup: buildCourierPaymentControls(orderId) },
            'courier'
        );
        if (sent) {
            orders[found.index] = {
                ...orders[found.index],
                courierNotified: true,
                courierNotifiedAt: now,
                courierNotifyReason: 'admin_manual'
            };
            assignedIds.push(orderId);
        } else {
            orders[found.index] = {
                ...orders[found.index],
                courierAssignedId: 0,
                courierAssignedAt: '',
                courierNotified: false,
                courierNotifiedAt: '',
                courierNotifyReason: 'admin_manual',
                courierQueuedAt: orders[found.index]?.courierQueuedAt || now
            };
            failedIds.push(orderId);
        }
    }

    saveOrders(orders);

    try {
        await assignQueuedOrders();
    } catch (err) {
        console.error('Assign queued orders after manual assign error:', err?.message || err);
    }

    return res.json({
        ok: true,
        assignedIds,
        failedIds,
        missingIds,
        skippedIds
    });
});

app.post('/api/payments/click-url', (req, res) => {
    const { orderId, amount, phone } = req.body || {};
    const numericAmount = Number(amount);

    if (!orderId) {
        return res.status(400).json({ error: 'orderId talab qilinadi' });
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: 'amount 0 dan katta bo\'lishi kerak' });
    }
    if (!isClickConfigured()) {
        return res.status(503).json({
            error: 'CLICK serverda sozlanmagan',
            receiverCard: CLICK_RECEIVER_CARD
        });
    }

    const params = new URLSearchParams({
        service_id: CLICK_SERVICE_ID,
        merchant_id: CLICK_MERCHANT_ID,
        amount: numericAmount.toFixed(2),
        transaction_param: String(orderId),
        return_url: CLICK_RETURN_URL
    });

    const phoneDigits = String(phone || '').replace(/\D/g, '');
    if (phoneDigits) {
        params.set('phone_number', phoneDigits);
    }

    const paymentUrl = `${CLICK_PAYMENT_BASE_URL}?${params.toString()}`;
    return res.json({
        paymentUrl,
        receiverCard: CLICK_RECEIVER_CARD
    });
});

// Masofa va vaqtni hisoblash (Faqat OSRM va Fallback)
app.post('/api/ai-distance', async (req, res) => {
    const { originCoords, destinationCoords } = req.body || {};
    const fromLat = Number(originCoords?.lat);
    const fromLon = Number(originCoords?.lon);
    const toLat = Number(destinationCoords?.lat);
    const toLon = Number(destinationCoords?.lon);

    if (!Number.isFinite(fromLat) || !Number.isFinite(toLat)) {
        return res.status(400).json({ success: false, error: 'Koordinatalar yetarli emas' });
    }

    try {
        const info = await getSmartDistanceInfo(fromLat, fromLon, toLat, toLon);
        res.json({
            success: true,
            distanceKm: info.distanceKm,
            durationMin: info.durationMin,
            distanceText: info.distanceText || formatDistanceText(info.distanceKm),
            durationText: info.durationText || formatDurationText(info.durationMin),
            provider: info.provider
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Masofa hisoblab bo\'lmadi' });
    }
});

app.get('/api/location/resolve', async (req, res) => {
    const lat = Number(req.query?.lat);
    const lon = Number(req.query?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ success: false, error: 'Koordinata noto\'g\'ri' });
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ success: false, error: 'Koordinata diapazoni noto\'g\'ri' });
    }

    try {
        const resolved = await resolveLocationAddress(lat, lon);
        return res.json({
            success: true,
            address: String(resolved?.address || '').trim(),
            source: String(resolved?.source || 'nominatim')
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message || 'Manzilni aniqlab bo\'lmadi'
        });
    }
});

// Google Distance Matrix orqali masofa olish (backend proxy)
app.get('/api/gmaps-distance', async (req, res) => {
    const fromLat = Number(req.query?.fromLat);
    const fromLon = Number(req.query?.fromLon);
    const toLat = Number(req.query?.toLat);
    const toLon = Number(req.query?.toLon);

    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLon) || !Number.isFinite(toLat) || !Number.isFinite(toLon)) {
        return res.status(400).json({ success: false, error: 'Koordinatalar kerak' });
    }

    try {
        const straight = haversineKm(fromLat, fromLon, toLat, toLon);
        const googleInfo = sanitizeRouteInfo(
            await getGoogleDistanceInfo(fromLat, fromLon, toLat, toLon),
            straight
        );
        if (googleInfo) {
            return res.json({
                success: true,
                distanceKm: googleInfo.distanceKm,
                durationMin: googleInfo.durationMin,
                distanceText: googleInfo.distanceText,
                durationText: googleInfo.durationText,
                provider: googleInfo.provider || 'google'
            });
        }

        const fallbackInfo = sanitizeRouteInfo(
            await getDistanceFallbackInfo(fromLat, fromLon, toLat, toLon),
            straight
        );
        if (fallbackInfo) {
            return res.json({
                success: true,
                distanceKm: fallbackInfo.distanceKm,
                durationMin: fallbackInfo.durationMin,
                distanceText: fallbackInfo.distanceText,
                durationText: fallbackInfo.durationText,
                provider: fallbackInfo.provider || 'fallback',
                fallback: true
            });
        }

        return res.status(500).json({ success: false, error: 'No result' });
    } catch (err) {
        console.error('gmaps-distance error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// --- 7. RASM YUKLASH ENDPOINTI ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Rasm tanlanmadi' });
    }
    // Frontendga rasmning URL manzilini qaytarish
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
});

app.post('/api/upload-url', async (req, res) => {
    const sourceUrl = String(req.body?.url || '').trim();
    if (!sourceUrl) {
        return res.status(400).json({ success: false, error: 'URL yuborilmadi' });
    }

    const normalizedUrl = normalizeKnownImageWrapperUrl(sourceUrl);
    if (!isHttpUrl(normalizedUrl)) {
        return res.status(400).json({ success: false, error: 'Faqat http/https URL qabul qilinadi' });
    }

    try {
        const localUrl = await importRemoteImageToUploads(normalizedUrl);
        if (!localUrl) {
            return res.status(422).json({ success: false, error: 'URL dan rasmni yuklab bo\'lmadi' });
        }

        return res.json({
            success: true,
            url: localUrl,
            sourceUrl: normalizedUrl
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message || 'Rasm URL bo\'yicha yuklanmadi'
        });
    }
});

// 2. YANGI FAOL QOSHISH
app.post('/api/foods', async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        const price = Number(req.body?.price);
        const img = String(req.body?.img || '').trim();
        const category = String(req.body?.category || '').trim();
        const prepMinutesRaw = Number(req.body?.prepMinutes);
        const prepMinutes = Number.isFinite(prepMinutesRaw) && prepMinutesRaw > 0
            ? Math.round(prepMinutesRaw)
            : COURIER_AUTO_DELAY_MINUTES;

        if (!name || !price || !category) {
            return res.status(400).json({ error: 'Nom, narx va kategoriya zarur!' });
        }

        const normalizedImg = await normalizeFoodImageReference(img);
        const foods = readFoods();
        const newFood = {
            id: Date.now(),
            name,
            price,
            img: normalizedImg || '8.jpg',
            category,
            prepMinutes,
            status: 'active'
        };

        foods.push(newFood);
        saveFoods(foods);
        syncSiteSettingsCategoriesWithFoods(foods);

        return res.status(201).json(newFood);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Taomni saqlashda xatolik' });
    }
});

// 3. FAOLNI YANGILASH
app.put('/api/foods/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const name = String(req.body?.name || '').trim();
        const price = req.body?.price;
        const img = String(req.body?.img || '').trim();
        const status = String(req.body?.status || '').trim();
        const category = String(req.body?.category || '').trim();
        const prepMinutesRaw = Number(req.body?.prepMinutes);
        const prepMinutes = Number.isFinite(prepMinutesRaw) && prepMinutesRaw > 0
            ? Math.round(prepMinutesRaw)
            : null;

        const foods = readFoods();
        const index = foods.findIndex(f => f.id === parseInt(id));

        if (index === -1) {
            return res.status(404).json({ error: 'Faol topilmadi!' });
        }

        const normalizedImg = img ? await normalizeFoodImageReference(img) : '';
        foods[index] = {
            ...foods[index],
            name: name || foods[index].name,
            price: price !== undefined ? Number(price) : foods[index].price,
            img: normalizedImg || img || foods[index].img,
            category: category || foods[index].category,
            status: status || foods[index].status,
            prepMinutes: prepMinutes || foods[index].prepMinutes || COURIER_AUTO_DELAY_MINUTES
        };

        saveFoods(foods);
        syncSiteSettingsCategoriesWithFoods(foods);
        return res.json(foods[index]);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Taomni yangilashda xatolik' });
    }
});

// 4. FAOLNI O'CHIRISH
app.delete('/api/foods/:id', (req, res) => {
    const { id } = req.params;

    const foods = readFoods();
    const index = foods.findIndex(f => f.id === parseInt(id));

    if (index === -1) {
        return res.status(404).json({ error: 'Faol topilmadi!' });
    }

    const deletedFood = foods.splice(index, 1);
    saveFoods(foods);
    syncSiteSettingsCategoriesWithFoods(foods);

    res.json(deletedFood[0]);
});

// 5. BUYURTMALARNI OLISH
// Mijoz buyurtmasining holatini olish
app.get('/api/customer/order-status/:id', (req, res) => {
    const { id } = req.params;
    const orders = readOrders();
    const order = orders.find(o => String(o.id) === String(id));

    if (!order) {
        return res.status(404).json({ error: 'Buyurtma topilmadi' });
    }

    // Mijozga ko'rsatiladigan ma'lumotlarni filtrlash
    const publicOrderInfo = {
        id: order.id,
        status: normalizeStatus(order.status),
        total: order.total,
        deliveryType: order.deliveryType,
        prepMinutes: order.prepMinutes,
        courierAssigned: Boolean(order.courierAssignedId),
        courierNotified: Boolean(order.courierNotified),
        paymentCollected: Boolean(order.paymentCollected),
        // Qolgan maxfiy ma'lumotlarni oshkor qilmaymiz
    };
    
    // Statusga qarab qo'shimcha ma'lumotlar
    if (publicOrderInfo.status === 'tayyorlandi') {
        publicOrderInfo.message = 'Buyurtmangiz tayyorlanmoqda.';
    } else if (publicOrderInfo.status === 'yolda') {
        publicOrderInfo.message = 'Buyurtmangiz yo\'lga chiqdi va sizga yetib kelmoqda.';
    } else if (publicOrderInfo.status === 'yakunlandi') {
        publicOrderInfo.message = 'Buyurtmangiz yetib keldi. Iltimos, to\'lov qilib taomingizni olib qoling.';
    } else if (publicOrderInfo.status === 'bekor') {
        publicOrderInfo.message = 'Buyurtmangiz bekor qilindi.';
    } else {
        publicOrderInfo.message = 'Buyurtmangiz qabul qilindi. Tayyorlanishini kuting.';
    }

    res.json(publicOrderInfo);
});


// 6. MASOFANI HISOBLASH (OSRM - Open Source Routing Machine)
app.get('/api/distance', async (req, res) => {
    const { fromLat, fromLon, toLat, toLon } = req.query;
    
    if (!fromLat || !fromLon || !toLat || !toLon) {
        return res.status(400).json({ error: 'Koordinatalar talab qilinadi' });
    }
    
    try {
        // OSRM API dan masofani olish (bepul, copyright chatisiz)
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`
        );
        
        if (!response.ok) {
            throw new Error('OSRM API error');
        }
        
        const data = await response.json();
        
        if (data.routes && data.routes[0] && data.routes[0].distance) {
            const distanceInMeters = data.routes[0].distance;
            const distanceInKm = distanceInMeters / 1000;
            
            res.json({ 
                distance: distanceInKm,
                distanceMeters: distanceInMeters,
                success: true 
            });
        } else {
            res.status(500).json({ error: 'API javobida masafa topilmadi', success: false });
        }
    } catch (err) {
        console.error('Distance API error:', err.message);
        res.status(500).json({ 
            error: err.message, 
            success: false 
        });
    }
});

// Server boshlash
const httpServer = app.listen(PORT, () => {
    console.log(`рџљЂ Server ${PORT} portda ishlamoqda!`);
    console.log(`рџ“Ќ Sayt: http://localhost:${PORT}`);
    console.log(`рџ“Љ API: http://localhost:${PORT}/api/foods`);
    startTelegramPolling();
});

httpServer.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} allaqachon band. Server oldinroq ishga tushirilgan bo'lishi mumkin.`);
        console.error('Eski serverni to\'xtatib qayta ishga tushiring: netstat -ano | findstr :3000  va  taskkill /PID <PID> /F');
        process.exit(0);
        return;
    }
    console.error('Server start xatosi:', err?.message || err);
    process.exit(1);
});

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('вљ пёЏ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Put values into .env or environment variables.');
}
