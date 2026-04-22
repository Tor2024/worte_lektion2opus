import { useState, useEffect, useCallback, useMemo } from 'react';
import { CustomFolder, UserVocabularyWord } from '@/lib/types';
import { storage } from '@/lib/storage';

export function useCustomFolders() {
    const [localFolders, setLocalFolders] = useState<CustomFolder[]>([]);
    const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);

    useEffect(() => {
        setLocalFolders(storage.getCustomFolders());
        setIsInitialLoadDone(true);
    }, []);

    useEffect(() => {
        const handleStorageChange = (event: StorageEvent) => {
            if (event.key === 'deutsch-learning-custom-folders' && event.newValue) {
                try {
                    const next = JSON.parse(event.newValue);
                    // Avoid identity change if values are same
                    setLocalFolders(prev => {
                        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
                        return next;
                    });
                } catch (e) {
                    console.error("Failed to sync folders from storage", e);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const createFolder = useCallback(async (name: string) => {
        const current = storage.getCustomFolders();
        const nextFolders = [...current, {
            id: Math.random().toString(36).substr(2, 9),
            name,
            words: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        }];
        setLocalFolders(nextFolders);
        storage.setCustomFolders(nextFolders);
        return nextFolders[nextFolders.length - 1].id;
    }, []);

    const deleteFolder = useCallback(async (id: string) => {
        const nextFolders = storage.getCustomFolders().filter((f: any) => f.id !== id);
        setLocalFolders(nextFolders);
        storage.setCustomFolders(nextFolders);
    }, []);

    const getFolder = useCallback((id: string) => {
        return localFolders.find(f => f.id === id);
    }, [localFolders]);

    const addWordToFolder = useCallback(async (folderId: string, userWord: UserVocabularyWord) => {
        const nextFolders = storage.getCustomFolders().map((f: any) => {
            if (f.id === folderId) {
                return { ...f, words: [userWord, ...f.words] };
            }
            return f;
        });
        setLocalFolders(nextFolders);
        storage.setCustomFolders(nextFolders);
    }, []);

    const updateWordInFolder = useCallback(async (folderId: string, updatedWord: UserVocabularyWord, globalSync: boolean = true) => {
        const currentFolders = storage.getCustomFolders();
        let nextFolders;

        if (globalSync) {
            // Update ALL instances of this word across ALL folders
            nextFolders = currentFolders.map((f: any) => ({
                ...f,
                words: f.words.map((w: any) =>
                    w.word.german === updatedWord.word.german ? { ...updatedWord, id: w.id } : w
                )
            }));
        } else {
            // Update only in specific folder
            nextFolders = currentFolders.map((f: any) => {
                if (f.id === folderId) {
                    return { ...f, words: f.words.map((w: any) => w.id === updatedWord.id ? updatedWord : w) };
                }
                return f;
            });
        }

        setLocalFolders(nextFolders);
        storage.setCustomFolders(nextFolders);
    }, []);

    const searchWords = useCallback((query: string) => {
        if (!query.trim()) return [];
        const normalizedQuery = query.toLowerCase().trim();
        const results: { word: UserVocabularyWord, folderName: string, folderId: string }[] = [];

        localFolders.forEach(folder => {
            folder.words.forEach(userWord => {
                if (
                    userWord.word.german.toLowerCase().includes(normalizedQuery) ||
                    userWord.word.russian.toLowerCase().includes(normalizedQuery)
                ) {
                    results.push({
                        word: userWord,
                        folderName: folder.name,
                        folderId: folder.id
                    });
                }
            });
        });

        return results;
    }, [localFolders]);

    const removeWordFromFolder = useCallback(async (folderId: string, wordId: string) => {
        const nextFolders = storage.getCustomFolders().map((f: any) => {
            if (f.id === folderId) {
                return { ...f, words: f.words.filter((w: any) => w.id !== wordId) };
            }
            return f;
        });
        setLocalFolders(nextFolders);
        storage.setCustomFolders(nextFolders);
    }, []);

    const reindexAllRoots = useCallback(async (onProgress?: (current: number, total: number) => void) => {
        const currentFolders = storage.getCustomFolders();
        
        // 1. Map to track unique German words needing indexing
        const uniqueWords = new Set<string>();
        currentFolders.forEach(f => {
            f.words.forEach(w => {
                if (!w.word.root) {
                    uniqueWords.add(w.word.german);
                }
            });
        });

        const wordsToProcessList = Array.from(uniqueWords);

        if (wordsToProcessList.length === 0) return 0;

        const total = wordsToProcessList.length;
        let processed = 0;
        const batchSize = 10;

        // Call progress immediately to show the total in the UI
        onProgress?.(0, total);

        let i = 0;
        let retryCount = 0;
        const MAX_RETRIES_PER_BATCH = 3;

        while (i < wordsToProcessList.length) {
            const batchGermanWords = wordsToProcessList.slice(i, i + batchSize);

            try {
                const res = await fetch('/api/batch-roots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ words: batchGermanWords })
                });

                if (!res.ok) throw new Error(`Batch failed with status ${res.status}`);
                const { rootMap } = await res.json();

                if (rootMap) {
                    if ((rootMap as any).error) {
                        throw new Error((rootMap as any).error);
                    }

                    console.log("[Roots] Batch words sent:", batchGermanWords);
                    console.log("[Roots] AI Response keys:", Object.keys(rootMap));

                    // DEEP CLONE to ensure React and Storage see new references
                    const foldersToSave = JSON.parse(JSON.stringify(storage.getCustomFolders()));
                    let matchesInBatch = 0;
                    
                    // Helper to strip German articles + punctuation for robust comparison
                    const normalizeForMatch = (s: string) => {
                        if (!s) return "";
                        return s.toLowerCase()
                            .replace(/^(der|die|das|die \(pl\))\s+/i, '') // Remove articles including plural
                            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // Remove punctuation
                            .trim();
                    }

                    const rootMapEntries = Object.entries(rootMap);
                    
                    rootMapEntries.forEach(([germanWord, detectedRoot]) => {
                        if (detectedRoot) {
                            const rootToApply = detectedRoot as string;
                            const targetNormalized = normalizeForMatch(germanWord);

                            foldersToSave.forEach((f: any) => {
                                f.words.forEach((w: any) => {
                                    const localWordNormalized = normalizeForMatch(w.word.german);
                                    if (localWordNormalized === targetNormalized) {
                                        if (!w.word.root) matchesInBatch++;
                                        w.word.root = rootToApply;
                                    }
                                });
                            });
                        }
                    });

                    if (matchesInBatch > 0) {
                        console.log(`[Roots] ✅ Saved ${matchesInBatch} matches for this batch.`);
                        storage.setCustomFolders(foldersToSave);
                        setLocalFolders(foldersToSave);
                    } else {
                        console.warn(`[Roots] ⚠️ Batch finished but 0 matches found in folders. Sample AI key: "${Object.keys(rootMap)[0]}" vs Sample local: "${foldersToSave[0]?.words[0]?.word?.german}"`);
                    }

                    processed += batchGermanWords.length;
                    i += batchGermanWords.length;
                    retryCount = 0;
                    onProgress?.(processed, total);
                }

                // Throttle to respect API limits
                await new Promise(r => setTimeout(r, 4500));
            } catch (e: any) {
                retryCount++;
                const errorMessage = (e as Error).message || "";
                // Only treat as rate-limit when the Google API actually reports 429 /
                // RESOURCE_EXHAUSTED. A bare "quota" substring in a fallback message
                // used to trigger a 25-second pause for unrelated errors.
                const isRateLimit =
                    /\b429\b/.test(errorMessage) ||
                    /RESOURCE_EXHAUSTED/i.test(errorMessage) ||
                    /rateLimitExceeded/i.test(errorMessage) ||
                    /quota exceeded/i.test(errorMessage);

                console.error(`Batch failed at index ${i} (attempt ${retryCount}/${MAX_RETRIES_PER_BATCH})`, e);
                
                if (retryCount >= MAX_RETRIES_PER_BATCH) {
                    console.warn(`Skipping problematic batch at index ${i} after ${MAX_RETRIES_PER_BATCH} failures.`);
                    i += batchGermanWords.length;
                    processed += batchGermanWords.length;
                    retryCount = 0;
                    onProgress?.(processed, total);
                } else {
                    // On rate limit, wait MUCH longer (20s) to let quota reset
                    const waitTime = isRateLimit ? 25000 : 12000;
                    console.log(`[Roots] Waiting ${waitTime/1000}s before retry...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        }

        return total;
    }, []);

    return useMemo(() => ({
        folders: localFolders,
        isLoading: !isInitialLoadDone,
        createFolder,
        deleteFolder,
        getFolder,
        addWordToFolder,
        updateWordInFolder,
        removeWordFromFolder,
        searchWords,
        reindexAllRoots
    }), [localFolders, isInitialLoadDone, createFolder, deleteFolder, getFolder, addWordToFolder, updateWordInFolder, removeWordFromFolder, searchWords, reindexAllRoots]);
}
