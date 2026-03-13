const axios = require('axios');
const https = require('https');

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

module.exports = aiClient;
