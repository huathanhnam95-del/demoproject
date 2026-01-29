
const https = require('https');

const options = {
    hostname: 'localhost',
    port: 8443,
    path: '/api/tracau?word=make',
    method: 'GET',
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

req.end();
