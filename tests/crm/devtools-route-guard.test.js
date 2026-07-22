/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
    const helperUrl = pathToFileURL(path.join(process.cwd(), 'public/js/crm/devtools-access.js')).href;
    await import(helperUrl);
    const helper = globalThis.CrmDevToolsAccess;

    const normalizedFallback = helper.resolveDevToolsRoute({
        main: 'devtools',
        sub: '',
        fallbackRoute: { main: 'dashboard', sub: '' },
        devToolsAvailable: false
    });

    assert.deepStrictEqual(
        normalizedFallback,
        { main: 'dashboard', sub: '' },
        'devtools route should fall back when backend capability is unavailable'
    );

    const normalizedAccessible = helper.resolveDevToolsRoute({
        main: 'devtools',
        sub: '',
        fallbackRoute: { main: 'dashboard', sub: '' },
        devToolsAvailable: true
    });

    assert.deepStrictEqual(
        normalizedAccessible,
        { main: 'devtools', sub: '' },
        'devtools route should remain accessible when capability is available'
    );

    assert.strictEqual(
        helper.shouldShowDevToolsNav({ devToolsAvailable: false }),
        false,
        'nav should stay hidden until backend capability is confirmed'
    );
    assert.strictEqual(
        helper.shouldShowDevToolsNav({ devToolsAvailable: true }),
        true,
        'nav should show when backend capability is available'
    );

    const pronunciationFallback = helper.resolveDevToolsRoute({
        main: 'pronunciation-samples',
        sub: '',
        fallbackRoute: { main: 'dashboard', sub: '' },
        pronunciationSamplesAvailable: false
    });
    assert.deepStrictEqual(
        pronunciationFallback,
        { main: 'dashboard', sub: '' },
        'pronunciation samples route should fall back when the admin capability is unavailable'
    );

    const pronunciationAccessible = helper.resolveDevToolsRoute({
        main: 'pronunciation-samples',
        sub: '',
        fallbackRoute: { main: 'dashboard', sub: '' },
        pronunciationSamplesAvailable: true
    });
    assert.deepStrictEqual(
        pronunciationAccessible,
        { main: 'pronunciation-samples', sub: '' },
        'pronunciation samples route should remain accessible for a capable admin'
    );

    assert.strictEqual(
        helper.shouldShowPronunciationSamplesNav({
            accessMode: 'admin',
            pronunciationSamplesAvailable: true
        }),
        true,
        'pronunciation samples nav should show for a capable admin in production'
    );
    assert.strictEqual(
        helper.shouldShowPronunciationSamplesNav({
            accessMode: 'teacher',
            pronunciationSamplesAvailable: true
        }),
        false,
        'pronunciation samples nav should remain hidden for teachers'
    );
    assert.strictEqual(
        helper.shouldShowPronunciationSamplesNav({
            accessMode: 'admin',
            pronunciationSamplesAvailable: false
        }),
        false,
        'pronunciation samples nav should remain hidden when the capability is disabled'
    );

    console.log('devtools route guard passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
