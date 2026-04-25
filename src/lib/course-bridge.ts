import { storage } from './storage';
import { CustomFolder, INITIAL_SM2_STATE, VocabularyWord } from './types';

function getKnownGermanSet(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        return new Set(storage.getKnownWords());
    } catch {
        return new Set();
    }
}

/**
 * Adds the topic's vocabulary into a dedicated "Курс: ..." custom folder.
 * useStudyQueue.syncWithFolders will pick the new entries up automatically and
 * merge them into the daily SRS queue. Existing entries (matched by german)
 * are preserved as-is.
 *
 * @returns number of newly added entries (0 means nothing new).
 */
export function addTopicWordsToQueue(
    levelId: string | undefined,
    topicTitle: string,
    words: VocabularyWord[]
): number {
    if (typeof window === 'undefined') return 0;
    if (!Array.isArray(words) || words.length === 0) return 0;

    const levelTag = levelId ? levelId.toUpperCase() : '?';
    const folderName = `Курс: ${levelTag} — ${topicTitle}`;

    const folders: CustomFolder[] = storage.getCustomFolders();
    let folder = folders.find(f => f.name === folderName);
    let isNewFolder = false;
    if (!folder) {
        folder = {
            id: Math.random().toString(36).slice(2, 11),
            name: folderName,
            words: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        isNewFolder = true;
    }

    const existingGerman = new Set(folder.words.map(w => w.word.german));
    const knownGerman = getKnownGermanSet();
    let added = 0;
    for (const w of words) {
        if (!w?.german) continue;
        if (existingGerman.has(w.german)) continue;
        // Active vocabulary: skip words the user marked as already known.
        if (knownGerman.has(w.german)) continue;
        folder.words.unshift({
            id: w.german,
            word: w,
            sm2State: { ...INITIAL_SM2_STATE },
            addedAt: Date.now(),
        });
        existingGerman.add(w.german);
        added += 1;
    }

    if (added === 0 && !isNewFolder) return 0;

    folder.updatedAt = Date.now();
    const next = isNewFolder ? [...folders, folder] : folders.map(f => f.id === folder!.id ? folder! : f);
    storage.setCustomFolders(next);
    return added;
}
