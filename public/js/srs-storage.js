import { SRS_STORAGE_KEYS } from './srs-constants.js';

export function getStoredAlgorithmPreference(storage = localStorage) {
    return storage.getItem(SRS_STORAGE_KEYS.ALGORITHM)
        || storage.getItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM)
        || null;
}

export function setStoredAlgorithmPreference(algorithm, storage = localStorage) {
    storage.setItem(SRS_STORAGE_KEYS.ALGORITHM, algorithm);
    storage.removeItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM);
}

export function migrateLegacyAlgorithmPreference(storage = localStorage) {
    const current = storage.getItem(SRS_STORAGE_KEYS.ALGORITHM);
    if (current) {
        if (storage.getItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM)) {
            storage.removeItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM);
        }
        return current;
    }

    const legacy = storage.getItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM);
    if (legacy) {
        storage.setItem(SRS_STORAGE_KEYS.ALGORITHM, legacy);
        storage.removeItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM);
        return legacy;
    }

    return null;
}
