/**
 * Final Polished Logger Utility
 * Optimized for production stability, consistent namespaces, and unified error monitoring.
 */
const Logger = (function () {
    const hostname = window.location.hostname;
    const IS_DEV = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');

    // 1. Session Tracking using crypto
    const SESSION_ID = sessionStorage.getItem('SESSION_ID') || (() => {
        try {
            const id = crypto.randomUUID().slice(0, 8);
            sessionStorage.setItem('SESSION_ID', id);
            return id;
        } catch (e) {
            const id = Math.random().toString(36).substring(2, 8);
            sessionStorage.setItem('SESSION_ID', id);
            return id;
        }
    })();

    let CURRENT_USER_ID = null;
    const DEFAULT_PREFIX = '[Dictation App]';

    // 2. Deterministic Log Level Configuration
    const LEVELS = { debug: 0, log: 1, warn: 2, error: 3, silent: 4 };
    const DEFAULT_LEVEL = IS_DEV ? 'debug' : 'error';
    const EFFECTIVE_LEVEL_NAME = (window.LOG_LEVEL in LEVELS) ? window.LOG_LEVEL : DEFAULT_LEVEL;
    const EFFECTIVE_LEVEL_VALUE = LEVELS[EFFECTIVE_LEVEL_NAME];

    function isAllowed(level) {
        return LEVELS[level] >= EFFECTIVE_LEVEL_VALUE;
    }

    // 3. Metadata Prefixing (dev only)
    function getMetadataPrefix() {
        if (!IS_DEV) return '';
        const userPart = CURRENT_USER_ID ? `[user:${CURRENT_USER_ID.substring(0, 5)}]` : '[guest]';
        return `[sess:${SESSION_ID}]${userPart}`;
    }

    // 4. Preserve Original Console Methods
    const originalLog = console.log;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalGroup = console.group;
    const originalGroupEnd = console.groupEnd;

    // 5. Unified Error Capture
    function captureError(args, namespace = 'global') {
        if (!window.Sentry || IS_DEV) return;

        Sentry.withScope((scope) => {
            scope.setTag("namespace", namespace);
            scope.setTag("session_id", SESSION_ID);

            const err = args[0] instanceof Error
                ? args[0]
                : new Error(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]));

            Sentry.captureException(err);
        });
    }

    /**
     * Core logging logic
     */
    const internal = {
        setUserId(uid) {
            CURRENT_USER_ID = uid;
            if (window.Sentry && !IS_DEV) {
                Sentry.setUser({ id: uid });
            }
            if (IS_DEV) originalLog(DEFAULT_PREFIX, `User context updated: ${uid}`);
        },

        create(namespace) {
            const nsPrefix = `[${namespace}]`;
            const fullPrefix = () => `${DEFAULT_PREFIX}${getMetadataPrefix()}${nsPrefix}`;

            return {
                debug: (...args) => { if (isAllowed('debug')) originalDebug(fullPrefix(), ...args); },
                log: (...args) => { if (isAllowed('log')) originalLog(fullPrefix(), ...args); },
                warn: (...args) => { if (isAllowed('warn')) originalWarn(fullPrefix(), ...args); },
                error: (...args) => {
                    if (isAllowed('error')) {
                        originalError(fullPrefix(), ...args);
                        captureError(args, namespace);
                    }
                },
                group: (label) => { if (isAllowed('debug')) originalGroup(`${fullPrefix()} ${label}`); },
                groupEnd: () => { if (isAllowed('debug')) originalGroupEnd(); }
            };
        },

        debug: (...args) => { if (isAllowed('debug')) originalDebug(DEFAULT_PREFIX, ...args); },
        log: (...args) => { if (isAllowed('log')) originalLog(DEFAULT_PREFIX, ...args); },
        warn: (...args) => { if (isAllowed('warn')) originalWarn(DEFAULT_PREFIX, ...args); },
        error: (...args) => {
            if (isAllowed('error')) {
                originalError(DEFAULT_PREFIX, ...args);
                captureError(args);
            }
        }
    };

    // Initial Production Guard
    if (!IS_DEV) {
        console.log = () => { };
        console.debug = () => { };
    }

    return internal;
})();

window.Logger = Logger;
