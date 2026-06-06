import crypto from 'crypto';

import { getApiKeys } from '../api/chat.ts';
import {
    CORS_ALLOWED_ORIGINS,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS
} from '../config.ts';
import { logWarn } from '../logger/index.ts';

const rateLimitBuckets = new Map();

function digest(value) {
    return crypto.createHash('sha256').update(value).digest();
}

function apiKeyMatches(token, apiKeys) {
    const tokenDigest = digest(token);
    return apiKeys.some(apiKey => crypto.timingSafeEqual(tokenDigest, digest(apiKey)));
}

function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (CORS_ALLOWED_ORIGINS.includes('*')) return true;
    return CORS_ALLOWED_ORIGINS.includes(origin);
}

export function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.removeHeader('X-Powered-By');
    next();
}

export function corsMiddleware(req, res, next) {
    const origin = req.get('origin');
    if (!isAllowedOrigin(origin)) {
        return res.status(403).json({ error: 'Источник запроса не разрешён' });
    }

    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', CORS_ALLOWED_ORIGINS.includes('*') ? '*' : origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}

export function rateLimitMiddleware(req, res, next) {
    if (RATE_LIMIT_MAX_REQUESTS <= 0) return next();

    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const current = rateLimitBuckets.get(key);
    const bucket = !current || current.resetAt <= now
        ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
        : current;

    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
        res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
        logWarn(`Rate limit exceeded for ${key}`);
        return res.status(429).json({ error: 'Слишком много запросов' });
    }

    next();
}

export function apiKeyAuth(req, res, next) {
    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) return next();

    const authHeader = req.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.slice(7).trim();
    if (!token || !apiKeyMatches(token, apiKeys)) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }

    next();
}

export function normalizeApiVersion(req, res, next) {
    req.url = req.url.replace(/\/v[12](?=\/|$)/g, '').replace(/\/+/g, '/');
    next();
}

const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets.entries()) {
        if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
    }
}, RATE_LIMIT_WINDOW_MS);

cleanupTimer.unref?.();
