
const https = require('https');

const postData = JSON.stringify({
    prompt: 'Write a short poem about coding.',
    model: 'meta-llama/Llama-3.1-8B-Instruct'
});

const options = {
    hostname: 'localhost',
    port: 8443,
    path: '/api/ai-feedback-stream',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    },
    rejectUnauthorized: false
};

const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (chunk) => {
        console.log('Chunk:', chunk.toString());
    });
    res.on('end', () => {
        console.log('Stream ended');
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(postData);
req.end();
