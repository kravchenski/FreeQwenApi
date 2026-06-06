import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { prompt } from '../../utils/prompt.ts';
import {
    addDeepSeekAccount,
    loadDeepSeekAccounts,
    removeDeepSeekAccount,
    type DeepSeekAccount
} from './accounts.ts';

puppeteer.use(StealthPlugin());

const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://chat.deepseek.com';

async function extractToken(page: any) {
    const storageToken = await page.evaluate(() => {
        const stores = [localStorage, sessionStorage];
        const preferred = ['token', 'auth_token', 'access_token', 'userToken'];
        for (const store of stores) {
            for (const key of preferred) {
                const value = store.getItem(key);
                if (value) return value;
            }
            for (let index = 0; index < store.length; index++) {
                const key = store.key(index);
                if (!key || !/token|auth/i.test(key)) continue;
                const value = store.getItem(key);
                if (value) return value;
            }
        }
        return null;
    });
    if (storageToken) return storageToken;

    return page.evaluate(async () => {
        const response = await fetch('/api/v0/users/current');
        const body = await response.json().catch(() => null);
        return body?.data?.biz_data?.token || body?.data?.token || null;
    });
}

export async function addDeepSeekAccountInteractive(replaceId?: string) {
    console.log('\n======================================================');
    console.log(replaceId ? `Повторный вход DeepSeek: ${replaceId}` : 'Добавление нового аккаунта DeepSeek');
    console.log('Войдите на chat.deepseek.com и после загрузки чата нажмите Enter.');
    console.log('======================================================');

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    try {
        const page = await browser.newPage();
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await prompt('После успешного входа нажмите Enter...');
        const token = await extractToken(page);
        const cookies = await page.cookies();
        if (!token) throw new Error('Не удалось извлечь DeepSeek Bearer token');
        const id = replaceId || `deepseek_${Date.now()}`;
        addDeepSeekAccount({ id, token, cookies, invalid: false, resetAt: null });
        console.log(`Аккаунт DeepSeek ${id} сохранён.`);
        return id;
    } finally {
        await browser.close();
    }
}

function printAccounts(accounts: DeepSeekAccount[]) {
    console.log('\nСписок аккаунтов DeepSeek:');
    if (!accounts.length) console.log('  (пусто)');
    accounts.forEach((account, index) => {
        const status = account.invalid ? '❌ Недействителен' : '✅ OK';
        console.log(`${String(index + 1).padStart(2, ' ')} | ${account.id} | ${status}`);
    });
}

async function pickAccount(question: string) {
    const accounts = loadDeepSeekAccounts();
    printAccounts(accounts);
    if (!accounts.length) return null;
    const choice = Number(await prompt(question));
    return Number.isInteger(choice) && choice >= 1 && choice <= accounts.length ? accounts[choice - 1] : null;
}

export async function reloginDeepSeekAccountInteractive() {
    const account = await pickAccount('Номер аккаунта для повторного входа: ');
    if (account) await addDeepSeekAccountInteractive(account.id);
}

export async function removeDeepSeekAccountInteractive() {
    const account = await pickAccount('Номер аккаунта для удаления: ');
    if (!account) return;
    const confirmation = await prompt(`Удалить ${account.id}? (y/N): `);
    if (confirmation.toLowerCase() === 'y') removeDeepSeekAccount(account.id);
}

export async function runDeepSeekAccountMenu() {
    while (true) {
        const accounts = loadDeepSeekAccounts();
        printAccounts(accounts);
        console.log('\n=== Меню DeepSeek ===');
        console.log('1 - Добавить новый аккаунт');
        console.log('2 - Перелогинить аккаунт');
        console.log('3 - Запустить прокси (по умолчанию)');
        console.log('4 - Удалить аккаунт');
        let choice = await prompt('Ваш выбор (Enter = 3): ');
        if (!choice) choice = '3';
        if (choice === '1') await addDeepSeekAccountInteractive();
        else if (choice === '2') await reloginDeepSeekAccountInteractive();
        else if (choice === '4') await removeDeepSeekAccountInteractive();
        else if (choice === '3') {
            if (accounts.some(account => !account.invalid)) return;
            console.log('Нужен хотя бы один валидный аккаунт DeepSeek.');
        }
    }
}
