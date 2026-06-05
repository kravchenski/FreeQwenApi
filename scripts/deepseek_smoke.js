const baseUrl = process.env.DEEPSEEK_PROXY_URL || 'http://localhost:3265/api';
const model = process.env.DEEPSEEK_SMOKE_MODEL || 'deepseek-chat';

async function main() {
    const health = await fetch(`${baseUrl}/health`).then(r => r.json());
    console.log('health:', health);

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Ответь одним коротким предложением: что такое DeepSeek?' }],
            stream: false
        })
    });

    const text = await res.text();
    if (!res.ok) {
        console.error(text);
        process.exit(1);
    }
    const data = JSON.parse(text);
    console.log(data.choices?.[0]?.message?.content || data);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
