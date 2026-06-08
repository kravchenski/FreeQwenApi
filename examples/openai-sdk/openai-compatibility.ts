
import OpenAI from 'openai';

const openai = new OpenAI({
    baseURL: 'http://localhost:3264/api',
    apiKey: 'dummy-key',
});

async function openaiCompatibilityExample() {
    try {
        console.log('Демонстрация совместимости с OpenAI API\n');

        console.log('1. Стандартный запрос в формате OpenAI...');

        const completion = await openai.chat.completions.create({
            model: 'qwen-max-latest',
            messages: [
                { role: 'system', content: 'Ты полезный ассистент, который дает краткие и четкие ответы.' },
                { role: 'user', content: 'Что такое искусственный интеллект?' }
            ],
            temperature: 0.7,
        });

        console.log('Ответ:');
        console.log(completion.choices[0].message.content);

        console.log('\n2. Потоковый запрос в формате OpenAI...');

        console.log('Ответ (потоковый режим):');
        const stream = await openai.chat.completions.create({
            model: 'qwen-max-latest',
            messages: [
                { role: 'system', content: 'Ты полезный ассистент, который отвечает кратко.' },
                { role: 'user', content: 'Перечисли 5 самых популярных языков программирования' }
            ],
            stream: true,
        });

        let streamedContent = '';
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            streamedContent += content;
            process.stdout.write(content);
        }
        console.log('\n');

        console.log('\n3. Структура ответа в формате OpenAI:');

        const responseDemo = await openai.chat.completions.create({
            model: 'qwen-max-latest',
            messages: [{ role: 'user', content: 'Привет!' }],
        });

        const { choices, ...responseWithoutChoices } = responseDemo;
        console.log(JSON.stringify({
            ...responseWithoutChoices,
            choices: [{
                ...choices[0],
                message: { role: choices[0].message.role, content: '[содержимое сообщения скрыто для краткости]' }
            }]
        }, null, 2));



    } catch (error) {
        console.error('Ошибка при выполнении примера:', error);
    }
}

openaiCompatibilityExample();
