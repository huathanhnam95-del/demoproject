
async function test() {
    try {
        const res = await fetch('https://api.tracau.vn');
        console.log('Tracau status:', res.status);
    } catch (e) {
        console.error('Google fetch failed:', e.message);
    }
}
test();
