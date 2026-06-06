import winston from 'winston';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { LOG_LEVEL, LOG_MAX_SIZE, LOG_MAX_FILES, LOGS_DIR } from '../config.js';

const LOG_DIR = path.resolve(process.cwd(), LOGS_DIR);
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const { combine, timestamp, printf, colorize } = winston.format;

const consoleFormat = combine(
    colorize({ all: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ level, message, timestamp }) => `${timestamp} [${level}]: ${message}`)
);

const fileFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ level, message, timestamp }) => `${timestamp} [${level}]: ${message}`)
);

const customLevels = {
    levels: { error: 0, warn: 1, info: 2, http: 3, debug: 4, raw: 5 },
    colors: { error: 'red', warn: 'yellow', info: 'green', http: 'cyan', debug: 'blue', raw: 'magenta' }
};

const logger = winston.createLogger({
    levels: customLevels.levels,
    level: LOG_LEVEL,
    format: fileFormat,
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'http.log'),
            level: 'http',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'raw-responses.log'),
            level: 'raw',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES
        }),
        new winston.transports.Console({ format: consoleFormat })
    ]
});

winston.addColors(customLevels.colors);

const morganStream = {
    write: (message) => logger.http(message.trim())
};

const morganFormat = ':remote-addr :method :url :status :res[content-length] - :response-time ms';
const httpLogger = morgan(morganFormat, { stream: morganStream });

export const logHttpRequest = httpLogger;
export const logInfo = (message) => logger.info(message);
export const logError = (message, error) => {
    if (error) {
        logger.error(`${message}: ${error.message}`);
        logger.error(error.stack);
    } else {
        logger.error(message);
    }
};
export const logWarn = (message) => logger.warn(message);
export const logDebug = (message) => logger.debug(message);
export const logRaw = (message) => logger.raw(message);
export const logHttp = (message) => logger.http(message);

export default { logHttpRequest, logInfo, logError, logWarn, logDebug, logRaw, logHttp };
