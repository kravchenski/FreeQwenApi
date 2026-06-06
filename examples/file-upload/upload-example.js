import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_URL = 'http://localhost:3264/api';

async function uploadTestFile(filePath) {
    try {
        console.log(`Загрузка файла: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Файл не найден: ${filePath}`);
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));

        const response = await axios.post(`${API_URL}/files/upload`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('Файл успешно загружен:');
        console.log(JSON.stringify(response.data, null, 2));

        return response.data;
    } catch (error) {
        console.error('Ошибка при загрузке файла:');
        if (error.response) {
            console.error(error.response.data);
        } else {
            console.error(error.message);
        }
        throw error;
    }
}

async function getTestStsToken(fileInfo) {
    try {
        console.log(`Запрос STS токена для файла: ${fileInfo.filename}`);

        const response = await axios.post(`${API_URL}/files/getstsToken`, fileInfo);

        console.log('Получен STS токен:');
        console.log(JSON.stringify(response.data, null, 2));

        return response.data;
    } catch (error) {
        console.error('Ошибка при получении STS токена:');
        if (error.response) {
            console.error(error.response.data);
        } else {
            console.error(error.message);
        }
        throw error;
    }
}

async function directUploadFile(filePath, stsData) {
    try {
        console.log(`Прямая загрузка файла: ${filePath}`);

        if (!stsData || !stsData.file_url || !stsData.file_path) {
            throw new Error('Некорректные данные STS токена');
        }

        const OSS = (await import('ali-oss')).default;

        if (!stsData.access_key_id || !stsData.access_key_secret || !stsData.security_token ||
            !stsData.region || !stsData.bucketname) {
            throw new Error('Неполные данные STS токена для OSS');
        }

        console.log(`Создание OSS клиента: регион ${stsData.region}, бакет ${stsData.bucketname}`);

        const client = new OSS({
            region: stsData.region,
            accessKeyId: stsData.access_key_id,
            accessKeySecret: stsData.access_key_secret,
            stsToken: stsData.security_token,
            bucket: stsData.bucketname,
            secure: true,
            timeout: 60000
        });

        const objectName = stsData.file_path;

        console.log(`Загрузка файла в OSS: ${objectName}`);

        const result = await client.put(objectName, filePath);

        console.log('Файл успешно загружен в OSS:');
        console.log(`URL: ${stsData.file_url}`);
        console.log(`Ответ OSS: ${JSON.stringify(result)}`);

        try {
            const verifyResponse = await axios.get(stsData.file_url);
            console.log(`Файл успешно проверен, статус: ${verifyResponse.status}`);
        } catch (error) {
            console.log(`Не удалось проверить файл: ${error.message}`);
        }

        return {
            success: true,
            fileName: path.basename(filePath),
            url: stsData.file_url,
            fileId: stsData.file_id,
            ossResponse: result
        };
    } catch (error) {
        console.error('Ошибка при загрузке файла в OSS:');
        if (error.response) {
            console.error(`Статус: ${error.response.status}`);
            console.error(error.response.data);
        } else {
            console.error(error.message);
        }
        throw error;
    }
}

async function runTest() {
    try {
        const testFilePath = path.join(__dirname, 'test-image.jpg');

        if (!fs.existsSync(testFilePath)) {
            console.log('Тестовый файл не найден, создаем текстовый файл для теста...');

            const textFilePath = path.join(__dirname, 'test-file.txt');
            fs.writeFileSync(textFilePath, 'Это тестовый файл для загрузки.');

            console.log(`Создан тестовый файл: ${textFilePath}`);

            const fileInfo = {
                filename: 'test-file.txt',
                filesize: fs.statSync(textFilePath).size,
                filetype: 'file'
            };

            const stsData = await getTestStsToken(fileInfo);

            console.log('\n--- Тестирование прямой загрузки файла ---');
            await directUploadFile(textFilePath, stsData);

            console.log('\n--- Тестирование загрузки через API ---');
            await uploadTestFile(textFilePath);
        } else {
            const fileInfo = {
                filename: 'test-image.jpg',
                filesize: fs.statSync(testFilePath).size,
                filetype: 'image'
            };

            const stsData = await getTestStsToken(fileInfo);

            console.log('\n--- Тестирование прямой загрузки файла ---');
            await directUploadFile(testFilePath, stsData);

            console.log('\n--- Тестирование загрузки через API ---');
            await uploadTestFile(testFilePath);
        }

        console.log('\nТестирование завершено успешно!');
    } catch (error) {
        console.error('Ошибка при выполнении теста:', error.message);
    }
}

runTest();