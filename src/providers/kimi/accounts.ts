import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd(), process.env.KIMI_SESSION_DIR || 'session/kimi');
const accountsDir = path.join(root, 'accounts');
const accountsFile = path.join(root, 'accounts.json');
let pointer = 0;

export type KimiAccount = {
    id: string;
    token: string;
    invalid?: boolean;
    resetAt?: string | null;
};

function ensureStorage() {
    fs.mkdirSync(accountsDir, { recursive: true });
}

export function loadKimiAccounts(): KimiAccount[] {
    ensureStorage();
    if (!fs.existsSync(accountsFile)) return [];
    try {
        const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
        return Array.isArray(accounts) ? accounts.filter(isKimiAccount) : [];
    } catch {
        return [];
    }
}

function isKimiAccount(value: unknown): value is KimiAccount {
    const account = value as Partial<KimiAccount>;
    return Boolean(account && typeof account.id === 'string' && typeof account.token === 'string');
}

function saveKimiAccounts(accounts: KimiAccount[]) {
    ensureStorage();
    const temporary = `${accountsFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, accountsFile);
    fs.chmodSync(accountsFile, 0o600);
}

export function addKimiAccount(account: KimiAccount) {
    const accounts = loadKimiAccounts().filter(item => item.id !== account.id);
    accounts.push(account);
    saveKimiAccounts(accounts);
}

export function removeKimiAccount(id: string) {
    saveKimiAccounts(loadKimiAccounts().filter(account => account.id !== id));
    fs.rmSync(path.join(accountsDir, id), { recursive: true, force: true });
}

export function markKimiAccountInvalid(id: string) {
    const accounts = loadKimiAccounts();
    const account = accounts.find(item => item.id === id);
    if (account) account.invalid = true;
    saveKimiAccounts(accounts);
}

export function hasValidKimiAccounts() {
    return loadKimiAccounts().some(account =>
        !account.invalid && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now())
    );
}

export function getAvailableKimiAccount() {
    const available = loadKimiAccounts().filter(account =>
        !account.invalid && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now())
    );
    if (!available.length) return null;
    const account = available[pointer % available.length];
    pointer = (pointer + 1) % available.length;
    return account;
}
