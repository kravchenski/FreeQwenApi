#!/usr/bin/env bun

import {
    addKimiAccountInteractive,
    reloginKimiAccountInteractive,
    removeKimiAccountInteractive,
    runKimiAccountMenu
} from '../src/providers/kimi/auth.ts';
import { loadKimiAccounts } from '../src/providers/kimi/accounts.ts';

const args = new Set(process.argv.slice(2));

if (args.has('--list')) {
    const accounts = loadKimiAccounts();
    if (!accounts.length) console.log('Нет сохранённых аккаунтов Kimi.');
    accounts.forEach((account, index) =>
        console.log(`${index + 1} | ${account.id} | ${account.invalid ? 'Недействителен' : 'OK'}`)
    );
} else if (args.has('--add')) {
    await addKimiAccountInteractive();
} else if (args.has('--relogin')) {
    await reloginKimiAccountInteractive();
} else if (args.has('--remove')) {
    await removeKimiAccountInteractive();
} else {
    await runKimiAccountMenu();
}
