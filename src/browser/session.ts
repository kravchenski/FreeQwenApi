import fs from 'fs';
import path from 'path';
import { logInfo, logError } from '../logger/index.ts';
import { SESSION_DIR } from '../config.ts';

const SESSION_PATH = path.resolve(process.cwd(), SESSION_DIR);
const TOKEN_FILE = path.join(SESSION_PATH, 'auth_token.txt');

function getSessionFilePath(accountId, fileName) {
    return accountId
        ? path.join(SESSION_PATH, 'accounts', accountId, fileName)
        : path.join(SESSION_PATH, fileName);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function initSessionDirectory() {
    ensureDir(SESSION_PATH);
}

export async function saveSession(context, accountId = null) {
    try {
        initSessionDirectory();
        const isPuppeteer = context && typeof context.goto === 'function';
        const isPlaywright = context && typeof context.storageState === 'function';

        if (isPuppeteer) {
            const cookies = await context.cookies();
            const sessionPath = getSessionFilePath(accountId, 'cookies.json');
            ensureDir(path.dirname(sessionPath));
            fs.writeFileSync(sessionPath, JSON.stringify(cookies, null, 2));
            logInfo('Сессия Puppeteer сохранена');
            return true;
        }

        if (isPlaywright && context.browser()) {
            const sessionPath = getSessionFilePath(accountId, 'state.json');
            ensureDir(path.dirname(sessionPath));
            await context.storageState({ path: sessionPath });
            logInfo('Сессия Playwright сохранена');
            return true;
        }

        logError('Неизвестный тип контекста браузера');
        return false;
    } catch (error) {
        logError('Ошибка при сохранении сессии', error);
        return false;
    }
}

export function saveAuthToken(token) {
    try {
        initSessionDirectory();
        if (token) {
            fs.writeFileSync(TOKEN_FILE, token, 'utf8');
            logInfo('Токен авторизации сохранен');
            return true;
        }
    } catch (error) {
        logError('Ошибка при сохранении токена авторизации', error);
    }
    return false;
}

export function loadAuthToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const token = fs.readFileSync(TOKEN_FILE, 'utf8');
            logInfo('Токен авторизации загружен');
            return token;
        }
    } catch (error) {
        logError('Ошибка при загрузке токена авторизации', error);
    }
    return null;
}
