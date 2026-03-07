process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
fetch('https://localhost:8443/api/reading-journey/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: ['space', 'exploration'], level: 'B1', language: 'en' })
})
    .then(res => res.json())
    .then(data => console.log('Response JSON:', JSON.stringify(data, null, 2)))
    .catch(err => console.error('Fetch error:', err));
