const axios = require('axios');
const https = require('https');
const rax = require('retry-axios');

const aiClient = axios.create({
    baseURL: 'https://router.huggingface.co/v1/chat/completions',
    timeout: 10000,
    httpsAgent: new https.Agent({ family: 4 }), // Force IPv4
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
});

aiClient.defaults.raxConfig = {
    instance: aiClient,
    retry: 3,
    noResponseRetries: 3,
    retryDelay: 1000,
    backoffType: 'exponential',
    onRetryAttempt: err => {
        const cfg = rax.getConfig(err);
        console.log(`[AI-Retry] Attempt ${cfg.currentRetryAttempt} for ${err.config.url}`);
    }
};

rax.attach(aiClient);

module.exports = aiClient;
