import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd(), process.env.DEEPSEEK_SESSION_DIR || 'session/deepseek');
const accountsDir = path.join(root, 'accounts');
const accountsFile = path.join(root, 'accounts.json');
let pointer = 0;

export type DeepSeekAccount = {
    id: string;
    token: string;
    cookies: Array<Record<string, any>>;
    invalid?: boolean;
    resetAt?: string | null;
};

function ensureStorage() {
    fs.mkdirSync(accountsDir, { recursive: true });
}

export function loadDeepSeekAccounts(): DeepSeekAccount[] {
    ensureStorage();
    if (!fs.existsSync(accountsFile)) return [];
    try {
        return JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
    } catch {
        return [];
    }
}

export function saveDeepSeekAccounts(accounts: DeepSeekAccount[]) {
    ensureStorage();
    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), 'utf8');
}

export function addDeepSeekAccount(account: DeepSeekAccount) {
    const accounts = loadDeepSeekAccounts().filter(item => item.id !== account.id);
    accounts.push(account);
    saveDeepSeekAccounts(accounts);
}

export function removeDeepSeekAccount(id: string) {
    saveDeepSeekAccounts(loadDeepSeekAccounts().filter(account => account.id !== id));
    fs.rmSync(path.join(accountsDir, id), { recursive: true, force: true });
}

export function markDeepSeekAccountInvalid(id: string) {
    const accounts = loadDeepSeekAccounts();
    const account = accounts.find(item => item.id === id);
    if (account) account.invalid = true;
    saveDeepSeekAccounts(accounts);
}

export function hasValidDeepSeekAccounts() {
    return loadDeepSeekAccounts().some(account =>
        !account.invalid && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now())
    );
}

export function getAvailableDeepSeekAccount() {
    const available = loadDeepSeekAccounts().filter(account =>
        !account.invalid && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now())
    );
    if (!available.length) return null;
    const account = available[pointer % available.length];
    pointer = (pointer + 1) % available.length;
    return account;
}
