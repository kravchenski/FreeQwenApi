import { authDeepSeekInteractive, closeDeepSeekBrowser } from '../src/deepseek/officialWebClient.js';
import { logError } from '../src/logger/index.js';

try {
    await authDeepSeekInteractive();
} catch (error) {
    logError('DeepSeek auth failed', error);
    process.exitCode = 1;
} finally {
    await closeDeepSeekBrowser();
}
