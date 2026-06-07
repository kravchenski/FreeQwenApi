import fs from 'fs';
import path from 'path';
import { logInfo, logError, logDebug } from '../logger/index.ts';
import { SESSION_DIR } from '../config.ts';

const HISTORY_DIR = path.resolve(process.cwd(), SESSION_DIR, 'history');

function initHistoryDirectory() {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
        logInfo(`Создана директория для истории чатов: ${HISTORY_DIR}`);
    }
}

export function isValidChatId(chatId) {
    return typeof chatId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(chatId);
}

function getHistoryFilePath(chatId) {
    if (!isValidChatId(chatId)) {
        throw new Error('Некорректный идентификатор чата');
    }
    return path.join(HISTORY_DIR, `${chatId}.json`);
}

export function saveHistory(chatId, data) {
    try {
        initHistoryDirectory();
        const historyFilePath = getHistoryFilePath(chatId);
        fs.writeFileSync(historyFilePath, JSON.stringify(data, null, 2), 'utf8');
        logDebug(`История чата ${chatId} успешно сохранена`);
        return true;
    } catch (error) {
        logError(`Ошибка при сохранении истории чата ${chatId}`, error);
        return false;
    }
}

export function loadHistory(chatId) {
    try {
        const historyFilePath = getHistoryFilePath(chatId);
        if (fs.existsSync(historyFilePath)) {
            const rawData = fs.readFileSync(historyFilePath, 'utf8');
            logDebug(`Данные чата ${chatId} успешно загружены`);

            let data;
            try {
                data = JSON.parse(rawData);
                logDebug(`Данные чата ${chatId} успешно распарсены`);
            } catch (parseErr) {
                logError(`Ошибка при парсинге данных чата ${chatId}`, parseErr);
                return {
                    id: chatId,
                    name: `Восстановленный чат ${new Date().toLocaleString()}`,
                    created: Date.now(),
                    messages: []
                };
            }

            if (Array.isArray(data)) {
                logDebug(`Чат ${chatId} использует устаревший формат, выполняется конвертация`);
                return {
                    id: chatId,
                    name: `Чат от ${new Date().toLocaleString()}`,
                    created: Date.now(),
                    messages: data,
                    wasConverted: true
                };
            }

            if (!data.messages) {
                logInfo(`Чат ${chatId} не содержит сообщений, инициализируем пустой массив`);
                data.messages = [];
            }

            if (!data.name) {
                data.name = `Чат ${chatId.substring(0, 6)}`;
            }

            if (!data.created) {
                data.created = Date.now();
            }

            if (!data.id) {
                data.id = chatId;
            }

            return data;
        } else {
            logInfo(`Файл истории для чата ${chatId} не найден`);
        }
    } catch (error) {
        logError(`Ошибка при загрузке истории чата ${chatId}`, error);
    }

    logInfo(`Создаем новую историю для чата ${chatId}`);
    return {
        id: chatId,
        name: `Новый чат ${new Date().toLocaleString()}`,
        created: Date.now(),
        messages: []
    };
}
