const assert = require('assert');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildRes() {
    return {
        _status: 200,
        _json: null,
        status(code) {
            this._status = code;
            return this;
        },
        json(payload) {
            this._json = payload;
            return this;
        }
    };
}

function getRouteHandlers(router, routePath, method) {
    const normalizedMethod = String(method || '').toLowerCase();
    const layer = (router.stack || []).find((entry) =>
        entry.route
        && entry.route.path === routePath
        && Array.isArray(entry.route.stack)
        && entry.route.stack.some((step) => step.method === normalizedMethod)
    );
    assert(layer, `Route ${routePath} not found.`);
    return (layer.route.stack || [])
        .filter((step) => step.method === normalizedMethod)
        .map((step) => step.handle);
}

async function invokeHandlers(handlers, req, res) {
    for (const handler of handlers) {
        if (handler.length >= 3) {
            await new Promise((resolve, reject) => {
                handler(req, res, (err) => (err ? reject(err) : resolve()));
            });
            continue;
        }

        const result = handler(req, res);
        if (result && typeof result.then === 'function') {
            await result;
        }
    }
}

function createReq({ params = {}, body = {}, query = {}, headers = {}, ip = '127.0.0.1' } = {}) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
    );
    return {
        params,
        body,
        query,
        headers: normalizedHeaders,
        protocol: normalizedHeaders['x-forwarded-proto'] || 'https',
        ip,
        get(name) {
            return normalizedHeaders[String(name || '').toLowerCase()];
        }
    };
}

function createFakeDb(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs).map(([key, value]) => [key, clone(value)]));
    let autoId = 0;

    function docKey(collectionName, docId) {
        return `${collectionName}/${docId}`;
    }

    function listCollectionDocs(collectionName) {
        return Array.from(docs.entries())
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, value]) => ({
                id: key.slice(collectionName.length + 1),
                data: clone(value)
            }));
    }

    function compare(op, left, right) {
        if (op === '==') return left === right;
        if (op === '>=') return left >= right;
        if (op === '<=') return left <= right;
        if (op === '>') return left > right;
        if (op === '<') return left < right;
        if (op === 'in') return Array.isArray(right) && right.includes(left);
        if (op === 'array-contains') return Array.isArray(left) && left.includes(right);
        if (op === 'array-contains-any') {
            return Array.isArray(left) && Array.isArray(right) && right.some((item) => left.includes(item));
        }
        throw new Error(`Unsupported operator in fake db: ${op}`);
    }

    function makeSnapshot(ref, collectionName, docId) {
        const key = docKey(collectionName, docId);
        const exists = docs.has(key);
        return {
            exists,
            id: docId,
            ref,
            data: () => clone(docs.get(key) || null)
        };
    }

    function makeDocRef(collectionName, docId) {
        const key = docKey(collectionName, docId);
        const ref = {
            id: docId,
            async get() {
                return makeSnapshot(ref, collectionName, docId);
            },
            async set(patch, options = {}) {
                const current = docs.get(key) || {};
                const next = options.merge ? { ...current, ...clone(patch) } : clone(patch);
                docs.set(key, next);
            },
            async update(patch) {
                if (!docs.has(key)) {
                    throw new Error(`Missing fake doc: ${key}`);
                }
                docs.set(key, { ...(docs.get(key) || {}), ...clone(patch) });
            },
            collection(subcollectionName) {
                return makeCollectionRef(`${collectionName}/${docId}/${subcollectionName}`);
            }
        };
        return ref;
    }

    function makeQuery(collectionName, filters = [], sortField = null, sortDirection = 'asc', limitCount = null) {
        return {
            where(field, op, value) {
                return makeQuery(collectionName, filters.concat([{ field, op, value }]), sortField, sortDirection, limitCount);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(collectionName, filters, field, direction, limitCount);
            },
            limit(count) {
                return makeQuery(collectionName, filters, sortField, sortDirection, count);
            },
            async get() {
                let rows = listCollectionDocs(collectionName);

                for (const filter of filters) {
                    rows = rows.filter((row) => compare(filter.op, row.data?.[filter.field], filter.value));
                }

                if (sortField) {
                    rows.sort((left, right) => {
                        const a = left.data?.[sortField];
                        const b = right.data?.[sortField];
                        if (a === b) return 0;
                        const direction = sortDirection === 'desc' ? -1 : 1;
                        return a > b ? direction : -direction;
                    });
                }

                if (Number.isInteger(limitCount) && limitCount >= 0) {
                    rows = rows.slice(0, limitCount);
                }

                const mappedDocs = rows.map((row) => {
                    const ref = makeDocRef(collectionName, row.id);
                    return {
                        id: row.id,
                        ref,
                        data: () => clone(row.data)
                    };
                });

                return {
                    docs: mappedDocs,
                    empty: mappedDocs.length === 0,
                    size: mappedDocs.length
                };
            }
        };
    }

    function makeCollectionRef(collectionName) {
        return {
            doc(docId) {
                const resolvedId = docId || `${collectionName.replace(/[^\w-]+/g, '-')}-auto-${++autoId}`;
                return makeDocRef(collectionName, resolvedId);
            },
            where(field, op, value) {
                return makeQuery(collectionName, [{ field, op, value }]);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(collectionName, [], field, direction);
            },
            limit(count) {
                return makeQuery(collectionName, [], null, 'asc', count);
            },
            async get() {
                return makeQuery(collectionName).get();
            }
        };
    }

    return {
        docs,
        collection: makeCollectionRef,
        batch() {
            const operations = [];
            return {
                set(ref, patch, options = {}) {
                    operations.push({ type: 'set', ref, patch, options });
                },
                update(ref, patch) {
                    operations.push({ type: 'update', ref, patch });
                },
                async commit() {
                    for (const operation of operations) {
                        if (operation.type === 'update') {
                            await operation.ref.update(operation.patch);
                        } else {
                            await operation.ref.set(operation.patch, operation.options);
                        }
                    }
                }
            };
        },
        async runTransaction(callback) {
            const tx = {
                get(ref) {
                    return ref.get();
                },
                set(ref, patch, options = {}) {
                    return ref.set(patch, options);
                },
                update(ref, patch) {
                    return ref.update(patch);
                }
            };
            return callback(tx);
        }
    };
}

async function callRoute(router, routePath, method, reqOptions) {
    const handlers = getRouteHandlers(router, routePath, method);
    const res = buildRes();
    await invokeHandlers(handlers, createReq(reqOptions), res);
    return res;
}

module.exports = {
    buildRes,
    callRoute,
    clone,
    createFakeDb,
    createReq,
    getRouteHandlers,
    invokeHandlers
};
