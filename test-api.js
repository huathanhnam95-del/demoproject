
const https = require('https');

const postData = JSON.stringify({
    prompt: 'Write a sentence using the word "make".',
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    max_tokens: 50
});

const options = {
    hostname: 'localhost',
    port: 8443,
    path: '/api/ai-proxy',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    },
    rejectUnauthorized: false
};

const req = https.request(options, (res) => {
    let body = '';
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (chunk) => {
        body += chunk;
    });
    res.on('end', () => {
        try {
            console.log(JSON.stringify(JSON.parse(body), null, 2));
        } catch (e) {
            console.log(body);
        }
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(postData);
req.end();
