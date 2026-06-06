import { saveSession } from './session.ts';
import { setAuthenticationStatus, getAuthenticationStatus, restartBrowserInHeadlessMode } from './browser.ts';
import { extractAuthToken } from '../api/chat.ts';
import { logInfo, logError, logWarn } from '../logger/index.ts';
import { CHAT_PAGE_URL, AUTH_SIGNIN_URL, PAGE_TIMEOUT, RETRY_DELAY } from '../config.ts';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isPlaywright(context) {
    return context && typeof context.newPage === 'function';
}

async function getPage(context) {
    if (context && typeof context.goto === 'function') return context;
    if (context && typeof context.newPage === 'function') return await context.newPage();
    throw new Error('Неверный контекст: не страница Puppeteer, не контекст Playwright');
}

async function promptUser(question) {
    return new Promise(resolve => {
        process.stdout.write(question);
        const onData = (data) => {
            process.stdin.removeListener('data', onData);
            process.stdin.pause();
            resolve(data.toString().trim());
        };
        process.stdin.resume();
        process.stdin.once('data', onData);
    });
}

async function countLoginContainers(page, isPW) {
    if (isPW) return page.locator('.login-container').count();
    return (await page.$$('.login-container')).length;
}

export async function checkAuthentication(context) {
    try {
        if (getAuthenticationStatus()) return true;

        const page = await getPage(context);
        const isPW = isPlaywright(context);

        logInfo('Проверка авторизации...');

        try {
            await page.goto(CHAT_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
            if (isPW) await page.waitForLoadState('domcontentloaded');
            await delay(RETRY_DELAY);

            const pageTitle = await page.title();
            if (pageTitle.includes('Verification')) {
                logWarn('Обнаружена страница верификации. Пожалуйста, пройдите верификацию вручную.');
                await promptUser('После прохождения верификации нажмите ENTER для продолжения...');
                logInfo('Верификация подтверждена пользователем.');
            }

            const loginCount = await countLoginContainers(page, isPW);

            if (loginCount === 0) {
                logInfo('Авторизация обнаружена');
                setAuthenticationStatus(true);
                try {
                    await extractAuthToken(context, true);
                    await saveSession(context);
                    logInfo('Сессия обновлена');
                } catch (e) { logError('Не удалось обновить сессию', e); }
                if (isPW) await page.close();
                return true;
            }

            console.log('------------------------------------------------------');
            console.log('               НЕОБХОДИМА АВТОРИЗАЦИЯ');
            console.log('------------------------------------------------------');
            console.log('1. Войдите в систему через GitHub или другой способ в открытом браузере');
            console.log('2. Дождитесь завершения процесса авторизации');
            console.log('3. Нажмите ENTER в этой консоли');
            console.log('------------------------------------------------------');

            await promptUser('После успешной авторизации нажмите ENTER для продолжения...');
            logInfo('Пользователь подтвердил завершение авторизации.');

            await page.reload({ waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
            await delay(3000);

            const loginCountAfter = await countLoginContainers(page, isPW);

            if (loginCountAfter === 0) {
                logInfo('Авторизация подтверждена.');
                setAuthenticationStatus(true);
                await saveSession(context);
                await extractAuthToken(context, true);
                if (isPW) await page.close();
                return true;
            }

            logWarn('Авторизация не обнаружена.');
            setAuthenticationStatus(false);
            return false;
        } catch (error) {
            if (isPW) await page.close().catch(() => {});
            throw error;
        }
    } catch (error) {
        logError('Ошибка при проверке авторизации', error);
        setAuthenticationStatus(false);
        return false;
    }
}

export async function startManualAuthentication(context, skipRestart = false) {
    try {
        const page = await getPage(context);
        const isPW = isPlaywright(context);

        logInfo('Открытие страницы для ручной авторизации...');

        try {
            await page.goto(AUTH_SIGNIN_URL, { waitUntil: 'load', timeout: PAGE_TIMEOUT });

            console.log('------------------------------------------------------');
            console.log('               НЕОБХОДИМА АВТОРИЗАЦИЯ');
            console.log('------------------------------------------------------');
            console.log('1. Войдите в систему в открытом браузере');
            console.log('2. Дождитесь завершения процесса авторизации');
            console.log('3. Нажмите ENTER в этой консоли');
            console.log('------------------------------------------------------');

            await promptUser('После успешной авторизации нажмите ENTER для продолжения...');

            await page.goto(CHAT_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
            await delay(RETRY_DELAY);

            const loginCount = await countLoginContainers(page, isPW);

            if (loginCount === 0) {
                logInfo('Авторизация подтверждена.');
                setAuthenticationStatus(true);
                await saveSession(context);
                await extractAuthToken(context, true);
                logInfo('Сессия сохранена успешно!');
                if (isPW) await page.close();
                if (!skipRestart) await restartBrowserInHeadlessMode();
                return true;
            }

            logWarn('Авторизация не удалась.');
            setAuthenticationStatus(false);
            return false;
        } catch (error) {
            if (isPW) await page.close().catch(() => {});
            throw error;
        }
    } catch (error) {
        logError('Ошибка при ручной авторизации', error);
        setAuthenticationStatus(false);
        return false;
    }
}

export async function checkVerification(page) {
    try {
        const pageTitle = await page.title();
        if (pageTitle.includes('Verification')) {
            logWarn('Обнаружена страница верификации');
            await promptUser('Пройдите верификацию и нажмите ENTER...');
            return true;
        }
        return false;
    } catch { return false; }
}
