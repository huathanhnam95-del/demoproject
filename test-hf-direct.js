
const { HfInference } = require('@huggingface/inference');
require('dotenv').config();

const apiKey = process.env.HUGGINGFACE_API_KEY;
console.log('API Key exists:', !!apiKey);

async function test() {
    try {
        const hf = new HfInference(apiKey);
        const result = await hf.chatCompletion({
            model: 'mistralai/Mistral-7B-Instruct-v0.2',
            messages: [{ role: 'user', content: 'Say hello' }],
            max_tokens: 10
        });
        console.log('Success:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Direct HF Error:', error.message);
        if (error.cause) console.error('Cause:', error.cause.message);
    }
}

test();
