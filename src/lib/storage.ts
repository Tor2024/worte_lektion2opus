import localforage from 'localforage';
import { CustomFolder, SM2State, StudyQueueItem } from './types';

// Configure localforage
localforage.config({
    name: 'DeutschApp',
    storeName: 'learning_data'
});

const KEYS = {
    PROGRESS: 'userProgress',
    SRS: 'deutsch-curriculum-srs-v1',
    CUSTOM_FOLDERS: 'deutsch-learning-custom-folders',
    STUDY_QUEUE: 'deutsch-learning-study-queue-v1',
    KNOWN_WORDS: 'knownWords',
    EXAM_TEXTS: 'custom_exam_texts',
    DAILY_SESSION: 'deutsch-daily-session-v1',
    SETTINGS: 'deutsch-app-settings-v1',
} as const;

export type ProgressData = { [key: string]: number };

export interface AppSettings {
    productionMode: 'full' | 'cloze' | 'skip';
    /**
     * Audio-first recognition: hide the prompt word until the user answers,
     * so they must rely on the spoken form. Strengthens listening/retrieval
     * at B1+ where orthography is no longer the main cue.
     */
    audioFirst?: boolean;
}

const defaultSettings: AppSettings = {
    productionMode: 'full',
    audioFirst: false,
};

// In-memory cache for synchronous reads
const memoryCache: Record<string, any> = {};
let activeStorageEngine: 'LocalStorage' | 'IndexedDB' = 'LocalStorage';

// Marker that the seed has been applied at least once on this device. This is
// distinct from the actual data keys so that if the user manually deletes
// everything we do NOT silently re-seed on top (they explicitly asked for a
// wipe). "Reset to seed" from the UI clears this marker too.
const SEED_APPLIED_KEY = 'deutsch-seed-applied-v1';
const SEED_ASSET_URL = '/seed.json';

/**
 * On a fresh device (no custom folders yet and no "seed applied" marker),
 * pull the bundled default dataset from `/seed.json` and populate every
 * storage key it contains. Called from `initStorage` after the regular
 * load/migrate step. Safe to call multiple times — subsequent calls no-op.
 */
async function applyDefaultSeedIfFresh(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
        const alreadyApplied = window.localStorage.getItem(SEED_APPLIED_KEY);
        const hasFolders = Array.isArray(memoryCache[KEYS.CUSTOM_FOLDERS]) && memoryCache[KEYS.CUSTOM_FOLDERS].length > 0;
        const hasQueue = Array.isArray(memoryCache[KEYS.STUDY_QUEUE]) && memoryCache[KEYS.STUDY_QUEUE].length > 0;
        if (alreadyApplied || hasFolders || hasQueue) {
            // Either we already seeded this device, or the user has real data
            // (imported, migrated from another device, or manually added).
            // In both cases we leave things alone.
            return;
        }

        const res = await fetch(SEED_ASSET_URL, { cache: 'force-cache' });
        if (!res.ok) {
            console.warn(`[seed] /seed.json fetch failed: ${res.status}`);
            return;
        }
        const seed = await res.json() as Record<string, unknown>;

        const validKeys = Object.values(KEYS);
        for (const [key, value] of Object.entries(seed)) {
            if (!validKeys.includes(key as any)) continue;
            memoryCache[key] = value;
            if (activeStorageEngine === 'IndexedDB') {
                try { await localforage.setItem(key, value); } catch (e) { console.warn('[seed] IDB write failed', e); }
            } else {
                try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('[seed] LS write failed', e); }
            }
        }

        window.localStorage.setItem(SEED_APPLIED_KEY, String(Date.now()));
        console.info('[seed] Default dataset applied to fresh device.');
    } catch (e) {
        // Never let a seed failure block the app. The user can still add
        // words manually or import a backup from settings.
        console.warn('[seed] Failed to apply default seed', e);
    }
}

export const storage = {
    getActiveEngine: () => activeStorageEngine,

    initStorage: async (): Promise<void> => {
        if (typeof window === 'undefined') return;

        try {
            // Check if indexedDB is available
            await localforage.ready();

            for (const [keyName, keyValue] of Object.entries(KEYS)) {
                let val = await localforage.getItem(keyValue);

                if (val !== null) {
                    memoryCache[keyValue] = val;
                } else {
                    // Try migrating from LocalStorage
                    const lsVal = window.localStorage.getItem(keyValue);
                    if (lsVal) {
                        try {
                            const parsed = JSON.parse(lsVal);
                            memoryCache[keyValue] = parsed;
                            await localforage.setItem(keyValue, parsed);
                        } catch (e) {
                            console.error(`Failed to parse ${keyValue} during migration`, e);
                        }
                    }
                }
            }

            activeStorageEngine = 'IndexedDB';
        } catch (e) {
            console.error("Storage initialization failed, falling back to LocalStorage", e);
            activeStorageEngine = 'LocalStorage';
            // Fallback: load everything from LS
            for (const [keyName, keyValue] of Object.entries(KEYS)) {
                const lsVal = window.localStorage.getItem(keyValue);
                if (lsVal) {
                    try {
                        memoryCache[keyValue] = JSON.parse(lsVal);
                    } catch { }
                }
            }
        }

        // After the regular load, if this device has never been seeded and
        // is still empty, populate the bundled default dataset so the user
        // lands in an already-useful state on every fresh install.
        await applyDefaultSeedIfFresh();
    },

    /**
     * Force-reapply the bundled seed, wiping any existing learning data on
     * this device. Used by the "Сбросить до seed" action in the UI.
     */
    resetToSeed: async (): Promise<void> => {
        if (typeof window === 'undefined') return;
        const validKeys = Object.values(KEYS);
        for (const key of validKeys) {
            delete memoryCache[key];
            try {
                if (activeStorageEngine === 'IndexedDB') await localforage.removeItem(key);
                window.localStorage.removeItem(key);
            } catch { /* noop */ }
        }
        try { window.localStorage.removeItem(SEED_APPLIED_KEY); } catch { /* noop */ }
        await applyDefaultSeedIfFresh();
        window.location.reload();
    },

    isCloudSyncEnabled: (): boolean => false,
    setCloudSyncEnabled: (enabled: boolean) => {
        // No-op in local-only mode
    },

    _get: <T>(key: string, defaultValue: T): T => {
        if (typeof window === 'undefined') return defaultValue;
        if (memoryCache[key] !== undefined) return memoryCache[key] as T;
        return defaultValue;
    },

    _set: <T>(key: string, value: T) => {
        if (typeof window === 'undefined') return;
        memoryCache[key] = value;
        const jsonString = JSON.stringify(value);

        // Save to active engine
        if (activeStorageEngine === 'IndexedDB') {
            localforage.setItem(key, value).catch(e => console.error("IndexedDB write error", e));
        } else {
            try {
                window.localStorage.setItem(key, jsonString);
            } catch (e) {
                console.warn('LS Write Error', e);
            }
        }

        // Dispatch event for cross-tab sync
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: jsonString }));
    },

    getProgress: (): ProgressData => storage._get(KEYS.PROGRESS, {}),
    setProgress: (data: ProgressData) => storage._set(KEYS.PROGRESS, data),

    getSRS: (): Record<string, SM2State> => storage._get(KEYS.SRS, {}),
    setSRS: (data: Record<string, SM2State>) => storage._set(KEYS.SRS, data),

    getCustomFolders: (): CustomFolder[] => storage._get(KEYS.CUSTOM_FOLDERS, []),
    setCustomFolders: (data: CustomFolder[]) => storage._set(KEYS.CUSTOM_FOLDERS, data),

    getStudyQueue: (): StudyQueueItem[] => storage._get(KEYS.STUDY_QUEUE, []),
    setStudyQueue: (data: StudyQueueItem[]) => storage._set(KEYS.STUDY_QUEUE, data),

    getKnownWords: (): string[] => storage._get(KEYS.KNOWN_WORDS, []),
    setKnownWords: (words: string[]) => storage._set(KEYS.KNOWN_WORDS, words),

    getExamTexts: (): any[] => storage._get(KEYS.EXAM_TEXTS, []),
    setExamTexts: (texts: any[]) => storage._set(KEYS.EXAM_TEXTS, texts),

    getSettings: (): AppSettings => {
        const raw = storage._get(KEYS.SETTINGS, defaultSettings) as any;
        if (raw.skipProductionPhase === true) raw.productionMode = 'skip';
        else if (raw.skipProductionPhase === false && !raw.productionMode) raw.productionMode = 'full';
        return { ...defaultSettings, ...raw };
    },
    setSettings: (settings: AppSettings) => storage._set(KEYS.SETTINGS, settings),

    getDailySessionData: (): DailySessionData => {
        const data = storage._get(KEYS.DAILY_SESSION, getDefaultDailySession());
        if (shouldResetDailySession(data.lastSessionDate)) {
            return getDefaultDailySession();
        }
        return data;
    },
    setDailySessionData: (data: DailySessionData) => storage._set(KEYS.DAILY_SESSION, data),

    incrementSession: (learnedWordIds: string[]): DailySessionData => {
        const current = storage.getDailySessionData();
        const updated: DailySessionData = {
            lastSessionDate: Date.now(),
            sessionCount: current.sessionCount + 1,
            learnedTodayIds: [...new Set([...current.learnedTodayIds, ...learnedWordIds])]
        };
        storage.setDailySessionData(updated);
        return updated;
    },

    resetAllProgress: async () => {
        if (typeof window === 'undefined') return;

        delete memoryCache[KEYS.PROGRESS];
        delete memoryCache[KEYS.SRS];
        delete memoryCache[KEYS.STUDY_QUEUE];
        delete memoryCache[KEYS.KNOWN_WORDS];
        delete memoryCache[KEYS.DAILY_SESSION];

        if (activeStorageEngine === 'IndexedDB') {
            await Promise.all([
                localforage.removeItem(KEYS.PROGRESS),
                localforage.removeItem(KEYS.SRS),
                localforage.removeItem(KEYS.STUDY_QUEUE),
                localforage.removeItem(KEYS.KNOWN_WORDS),
                localforage.removeItem(KEYS.DAILY_SESSION)
            ]);
        } else {
            window.localStorage.removeItem(KEYS.PROGRESS);
            window.localStorage.removeItem(KEYS.SRS);
            window.localStorage.removeItem(KEYS.STUDY_QUEUE);
            window.localStorage.removeItem(KEYS.KNOWN_WORDS);
            window.localStorage.removeItem(KEYS.DAILY_SESSION);
        }

        const folders = storage.getCustomFolders();
        const resetFolders = folders.map(folder => ({
            ...folder,
            updatedAt: Date.now(),
            words: (folder.words || []).map(word => ({
                ...word,
                sm2State: {
                    interval: 0,
                    repetitions: 0,
                    easeFactor: 2.5,
                    nextReviewDate: null,
                },
                deepDiveStage: 0
            }))
        }));
        storage.setCustomFolders(resetFolders);

        window.location.reload();
    },

    exportData: () => {
        if (typeof window === 'undefined') return;
        const data: Record<string, any> = {};
        for (const [keyName, keyValue] of Object.entries(KEYS)) {
            if (memoryCache[keyValue] !== undefined) {
                data[keyValue] = memoryCache[keyValue];
            }
        }

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = `deutsch-backup-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    importData: async (file: File): Promise<boolean> => {
        if (typeof window === 'undefined') return false;
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const validKeys = Object.values(KEYS);
            const importedKeys = Object.keys(data);
            const hasValidKeys = importedKeys.some(key => validKeys.includes(key as any));

            if (!hasValidKeys) {
                return false;
            }

            for (const [key, value] of Object.entries(data)) {
                if (validKeys.includes(key as any)) {
                    memoryCache[key] = value;
                    if (activeStorageEngine === 'IndexedDB') {
                        await localforage.setItem(key, value);
                    } else {
                        window.localStorage.setItem(key, JSON.stringify(value));
                    }
                }
            }

            window.location.reload();
            return true;
        } catch (error) {
            console.error("Failed to import data", error);
            return false;
        }
    }
};

export interface DailySessionData {
    lastSessionDate: number;
    sessionCount: number;
    learnedTodayIds: string[];
}

function getDefaultDailySession(): DailySessionData {
    return {
        lastSessionDate: 0,
        sessionCount: 0,
        learnedTodayIds: []
    };
}

function shouldResetDailySession(lastSessionDate: number): boolean {
    if (lastSessionDate === 0) return false;

    const now = new Date();
    const last = new Date(lastSessionDate);

    const todayReset = new Date(now);
    todayReset.setHours(4, 0, 0, 0);

    if (now < todayReset) {
        todayReset.setDate(todayReset.getDate() - 1);
    }

    return last < todayReset;
}
