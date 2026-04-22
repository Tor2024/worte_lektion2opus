'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { storage } from '@/lib/storage';
import { StudyQueueItem } from '@/lib/types';
import { useCustomFolders } from './use-custom-folders';
import { generateMnemonic } from '@/ai/flows/generate-mnemonic';

export function useStudyQueue() {
    const [localQueue, setLocalQueue] = useState<StudyQueueItem[]>([]);
    const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
    const [dailyStats, setDailyStats] = useState<{ lastSessionDate: number, sessionCount: number }>({ lastSessionDate: 0, sessionCount: 0 });
    const { folders, updateWordInFolder } = useCustomFolders();

    useEffect(() => {
        setLocalQueue(storage.getStudyQueue());
        setDailyStats(storage.getDailySessionData());
        setIsInitialLoadDone(true);

        const handleStorageChange = (event: StorageEvent) => {
            if (event.key === 'deutsch-learning-study-queue-v1' && event.newValue) {
                try {
                    const next = JSON.parse(event.newValue);
                    setLocalQueue(prev => {
                        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
                        return next;
                    });
                } catch (e) {
                    console.error("Failed to sync queue from storage", e);
                }
            }
            if (event.key === 'deutsch-daily-session-v1' && event.newValue) {
                try {
                    const next = JSON.parse(event.newValue);
                    setDailyStats(next);
                } catch (e) {
                    console.error("Failed to sync session data", e);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const syncWithFolders = useCallback(() => {
        if (!isInitialLoadDone) return;
        if (folders.length === 0) return;

        const existingQueue = storage.getStudyQueue();
        const newItems: StudyQueueItem[] = [];
        const existingIds = new Set(existingQueue.map((item: StudyQueueItem) => item.id));
        let hasChanges = false;

        folders.forEach(folder => {
            const folderWords = folder.words || [];
            folderWords.forEach(userWord => {
                const german = userWord?.word?.german?.trim();
                const wordId = german || userWord.id || `unknown-${Math.random()}`;

                if (!existingIds.has(wordId)) {
                    const sm2 = userWord.sm2State || {};
                    const hasHistory = (sm2.repetitions || 0) > 0;

                    newItems.push({
                        id: wordId,
                        word: userWord.word || { german: '?', russian: '?', type: 'other' },
                        status: hasHistory ? (sm2.interval > 7 ? 'review' : 'learning') : 'new',
                        currentStage: 'priming',
                        nextReviewNum: sm2.nextReviewDate || Date.now(),
                        interval: sm2.interval || 0,
                        easeFactor: sm2.easeFactor || 2.5,
                        tags: [folder.id],
                        consecutiveMistakes: 0
                    });
                    hasChanges = true;
                }
            });
        });

        if (hasChanges) {
            const updatedQueue = [...existingQueue, ...newItems];
            setLocalQueue(updatedQueue);
            storage.setStudyQueue(updatedQueue);
        }
    }, [folders, isInitialLoadDone]);

    useEffect(() => {
        if (isInitialLoadDone && folders.length > 0) {
            syncWithFolders();
        }
    }, [folders, isInitialLoadDone, syncWithFolders]);

    // Session mode type for UI display
    type SessionMode = 'learning' | 'review-only';

    const getDailySession = useCallback((folderId?: string, productionMode?: string): { items: StudyQueueItem[], mode: SessionMode, sessionNumber: number } => {
        let queueToProcess = localQueue;

        // FILTER BY FOLDER ID IF PROVIDED
        if (folderId) {
            queueToProcess = localQueue.filter(item => item.tags && item.tags.includes(folderId));
        }

        if (queueToProcess.length === 0) return { items: [], mode: 'learning', sessionNumber: 1 };

        const dailyData = storage.getDailySessionData();
        const sessionNumber = dailyData.sessionCount + 1; // Next session number
        const now = Date.now();

        // 1. Get ALL overdue words (past due date)
        const overdueCount = queueToProcess
            .filter((item: StudyQueueItem) =>
                item.status !== 'new' && item.nextReviewNum < now
            ).length;

        // 2. DYNAMIC LIMITS based on database size, production mode and BACKLOG
        const isBacklogCritical = overdueCount > 120;
        const isBacklogWarning = overdueCount > 50;

        const isLargeDB = queueToProcess.length > 2000;
        let baseLimit = productionMode === 'skip' ? 100 : 70;
        
        // If backlog is critical, increase limit for Fast Recovery Mode
        if (isBacklogCritical) baseLimit = 120; 

        const DAILY_LIMIT = isLargeDB ? baseLimit + 20 : baseLimit; 

        // 3. ADAPTIVE NEW WORD QUOTA
        // If everything is fine, add 20. If feeling pressure, add 5. If drowning, add 0.
        let NEW_WORDS_QUOTA = 20;
        if (isBacklogCritical) {
            NEW_WORDS_QUOTA = 0;
        } else if (isBacklogWarning) {
            NEW_WORDS_QUOTA = 5;
        }

        const LEVEL_PRIORITY: Record<string, number> = {
            'Beruf': 100, 'B2': 90, 'B1': 80, 'A2': 70, 'A1': 60, 'A0': 50
        };

        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        // 1. Get ALL overdue words (past due date)
        const overdueWords = queueToProcess
            .filter((item: StudyQueueItem) =>
                item.status !== 'new' && item.nextReviewNum < now
            )
            .sort((a, b) => (a.nextReviewNum || 0) - (b.nextReviewNum || 0));

        // 2. Get words due TODAY (not overdue)
        const dueTodayWords = queueToProcess
            .filter((item: StudyQueueItem) =>
                item.status !== 'new' &&
                item.nextReviewNum >= now &&
                item.nextReviewNum <= todayEnd.getTime()
            )
            .sort((a, b) => (a.nextReviewNum || 0) - (b.nextReviewNum || 0));

        // 3. Get new words
        const newWords = queueToProcess
            .filter((item: StudyQueueItem) => item.status === 'new');

        // 4. Get leech words 
        const leechWords = queueToProcess
            .filter((item: StudyQueueItem) => item.status === 'leech' || (item.consecutiveMistakes || 0) >= 3)
            .sort((a, b) => (b.consecutiveMistakes || 0) - (a.consecutiveMistakes || 0));

        // Review-only mode triggers ONLY if there is nothing else left to learn or review
        const totalPending = leechWords.length + overdueWords.length + dueTodayWords.length + newWords.length;

        if (totalPending === 0) {
            // FALLBACK: When everything is done, pick random words from "Mastered" (interval > 30)
            // instead of just repeating today's words over and over.
            let reviewPool = queueToProcess
                .filter((item: StudyQueueItem) => item.interval >= 30)
                .sort(() => Math.random() - 0.5)
                .slice(0, DAILY_LIMIT);
                
            if (reviewPool.length > 0) {
                return { items: reviewPool, mode: 'review-only', sessionNumber };
            }
        }

        // 5. Build the session pool (HYBRID STRATEGY)
        let mainPool: StudyQueueItem[] = [];
        let remainingSlots = DAILY_LIMIT;

        // 5a. Leeches (Priority 1: Up to 10 slots max to avoid getting stuck)
        const leechesToAdd = leechWords.slice(0, Math.min(leechWords.length, remainingSlots, 10));
        mainPool = [...mainPool, ...leechesToAdd];
        remainingSlots -= leechesToAdd.length;

        // 5b. New Words Quota (Priority 2: THE GUARANTEE)
        // This ensures progress even with a massive backlog
        if (remainingSlots > 0 && newWords.length > 0) {
            const quotaToAddCount = Math.min(newWords.length, NEW_WORDS_QUOTA, remainingSlots);
            const quotaToAdd = newWords.slice(0, quotaToAddCount);
            mainPool = [...mainPool, ...quotaToAdd];
            remainingSlots -= quotaToAdd.length;
        }

        // 5c. Due Today (Priority 3: Keep regular SRS moving)
        if (remainingSlots > 0 && dueTodayWords.length > 0) {
            const dueTodayFiltered = dueTodayWords.filter(w => !mainPool.some(m => m.id === w.id));
            const dueTodayToAdd = dueTodayFiltered.slice(0, remainingSlots);
            mainPool = [...mainPool, ...dueTodayToAdd];
            remainingSlots -= dueTodayToAdd.length;
        }

        // 5d. Overdue Words (Priority 4: Clearing the backlog with sampling)
        if (remainingSlots > 0 && overdueWords.length > 0) {
            const overdueFiltered = overdueWords.filter(w => !mainPool.some(m => m.id === w.id));
            
            // SAMPLING: 70% oldest, 30% random from the rest of the backlog
            const oldestPoolSize = Math.ceil(remainingSlots * 0.7);
            const oldestOnes = overdueFiltered.slice(0, oldestPoolSize);
            
            let randomOnes: StudyQueueItem[] = [];
            if (overdueFiltered.length > oldestPoolSize) {
                const poolForRandom = overdueFiltered.slice(oldestPoolSize);
                randomOnes = poolForRandom
                    .sort(() => Math.random() - 0.5)
                    .slice(0, remainingSlots - oldestOnes.length);
            }

            const overdueToAdd = [...oldestOnes, ...randomOnes];
            mainPool = [...mainPool, ...overdueToAdd];
            remainingSlots -= overdueToAdd.length;
        }

        // 5e. Final Filler: More New Words if slots remain
        if (remainingSlots > 0 && newWords.length > 0) {
            const extraNewWords = newWords.filter(w => !mainPool.some(m => m.id === w.id));
            const extraToAdd = extraNewWords.slice(0, Math.min(extraNewWords.length, remainingSlots));
            mainPool = [...mainPool, ...extraToAdd];
            remainingSlots -= extraToAdd.length;
        }

        // Fast Recovery Mode: If user has a critical backlog (> 120 overdue)
        // Force the session into 'review-only' mode. This skips the heavy "Narrative/Production" 
        // phases and lets the user quickly drill (Recognition) through 100 words in 10 minutes.
        if (isBacklogCritical && mainPool.length > 0) {
             // We still deduplicate
             const uniqueMap = new Map();
             mainPool.forEach(item => {
                 if (!uniqueMap.has(item.id)) uniqueMap.set(item.id, item);
             });
             return { items: Array.from(uniqueMap.values()), mode: 'review-only', sessionNumber };
        }

        // Fallback Review-only 
        if (mainPool.length === 0) {
            let reviewPool = queueToProcess
                .filter((item: StudyQueueItem) => item.interval >= 30)
                .sort(() => Math.random() - 0.5)
                .slice(0, DAILY_LIMIT);

            if (reviewPool.length > 0) {
                return { items: reviewPool, mode: 'review-only', sessionNumber };
            }
        }

        // Final session
        let finalItems = [...mainPool];

        // 6. MORPHEME CLUSTERING (Semantic Association)
        // If we have words with a specified 'root', try to pull in their "relatives" 
        // to build a stronger neural branch.
        const rootsInPool = new Set(finalItems.map(i => i.word.root).filter(Boolean));
        
        if (rootsInPool.size > 0 && remainingSlots > 0) {
            const relatives: StudyQueueItem[] = [];
            queueToProcess.forEach(item => {
                if (remainingSlots <= 0) return;
                if (item.word.root && rootsInPool.has(item.word.root)) {
                    // If this "relative" is not already in the pool
                    if (!finalItems.some(f => f.id === item.id)) {
                        relatives.push(item);
                        remainingSlots--;
                    }
                }
            });
            finalItems = [...finalItems, ...relatives];
        }

        // CRITICAL FIX: Deduplicate items by ID to strictly prevent repeats in the same session
        const uniqueMap = new Map();
        finalItems.forEach(item => {
            if (!uniqueMap.has(item.id)) {
                uniqueMap.set(item.id, item);
            }
        });
        finalItems = Array.from(uniqueMap.values());

        if (finalItems.length === 0) return { items: [], mode: 'learning', sessionNumber };

        // Group by level for better distribution
        const levelGroups: Record<number, StudyQueueItem[]> = {};
        finalItems.forEach((item: any) => {
            const level = item.word?.level ? LEVEL_PRIORITY[item.word.level as keyof typeof LEVEL_PRIORITY] : 0;
            if (!levelGroups[level]) levelGroups[level] = [];
            levelGroups[level].push(item);
        });

        const sortedLevels = Object.keys(levelGroups).map(Number).sort((a, b) => b - a);
        const finalSelection: StudyQueueItem[] = [];

        for (const level of sortedLevels) {
            const itemsInLevel = levelGroups[level];
            const typeGroups: Record<string, StudyQueueItem[]> = {};

            itemsInLevel.forEach(item => {
                const type = item.word?.type || 'other';
                if (!typeGroups[type]) typeGroups[type] = [];
                typeGroups[type].push(item);
            });

            Object.values(typeGroups).forEach((group: any) => group.sort(() => Math.random() - 0.5));
            const types = Object.keys(typeGroups);
            let hasItems = true;
            const groupIterators: Record<string, number> = {};
            types.forEach(t => groupIterators[t] = 0);

            while (hasItems) {
                hasItems = false;
                for (const type of types) {
                    const idx = groupIterators[type];
                    if (idx < typeGroups[type].length) {
                        finalSelection.push(typeGroups[type][idx]);
                        groupIterators[type]++;
                        hasItems = true;
                        if (finalSelection.length >= DAILY_LIMIT) break;
                    }
                }
                if (finalSelection.length >= DAILY_LIMIT) break;
            }
            if (finalSelection.length >= DAILY_LIMIT) break;
        }
        return { items: finalSelection, mode: 'learning' as SessionMode, sessionNumber };
    }, [localQueue]);

    const updateItemStatus = useCallback(async (wordId: string, result: 'success' | 'fail', confusedWithId?: string) => {
        const item = localQueue.find((i: any) => i.id === wordId);
        if (!item) return;

        let newStatus = item.status;
        let newMistakes = item.consecutiveMistakes;
        let nextInterval = item.interval || 0;
        let nextEase = item.easeFactor || 2.5;
        let currentConfusedWith = { ...(item.confusedWith || {}) };

        if (result === 'fail') {
            newMistakes++;
            newStatus = newMistakes >= 3 ? 'leech' : 'learning';
            nextInterval = 0; // Reset to 0 days for immediate re-learning
            nextEase = Math.max(1.3, nextEase - 0.2); // Decrease ease factor

            if (confusedWithId) {
                currentConfusedWith[confusedWithId] = (currentConfusedWith[confusedWithId] || 0) + 1;
            }

            // Generate mnemonic if it becomes a leech and doesn't have one
            if (newStatus === 'leech' && !item.mnemonic) {
                try {
                    const { mnemonic } = await generateMnemonic({
                        german: item.word.german,
                        russian: item.word.russian
                    });
                    item.mnemonic = mnemonic;

                    // Persist mnemonic back to the source folder if it's a custom word
                    const folder = folders.find(f => f.id === item.tags[0]);
                    if (folder) {
                        const originalWord = folder.words.find(w => w.id === item.id || w.word.german === item.word.german);
                        if (originalWord) {
                            updateWordInFolder(folder.id, { ...originalWord, mnemonic });
                        }
                    }
                } catch (e) {
                    console.error("Failed to generate mnemonic", e);
                }
            }
        } else {
            newMistakes = 0;
            if (item.status === 'new') {
                newStatus = 'learning';
                nextInterval = 1;
            } else if (item.status === 'learning') {
                newStatus = 'review';
                nextInterval = 3;
            } else {
                newStatus = 'review';
                // User-defined sequence: 1 -> 3 -> 7 -> 15 -> 30 -> 45 -> 60+
                if (nextInterval <= 1) nextInterval = 3;
                else if (nextInterval <= 3) nextInterval = 7;
                else if (nextInterval <= 7) nextInterval = 15;
                else if (nextInterval <= 15) nextInterval = 30;
                else if (nextInterval <= 30) nextInterval = 45;
                else if (nextInterval <= 45) nextInterval = 60;
                else {
                    // Success calculations (SM2 based) for long-term retention
                    nextInterval = Math.ceil(nextInterval * nextEase);
                }
            }
        }

        // Jitter on longer intervals (>= 14 days): ±15% uniform noise.
        // Without it, a batch of words promoted on the same day all come back
        // on exactly the same future day — defeating distributed practice and
        // causing "review cliffs". Short intervals stay exact so daily/weekly
        // rhythms remain predictable.
        let effectiveInterval = nextInterval;
        if (result === 'success' && nextInterval >= 14) {
            const jitter = (Math.random() * 0.3) - 0.15; // [-0.15, +0.15]
            effectiveInterval = Math.max(
                Math.round(nextInterval * 0.85),
                Math.round(nextInterval * (1 + jitter)),
            );
        }
        const nextDate = Date.now() + (1000 * 60 * 60 * 24 * effectiveInterval);

        const nextQueue = localQueue.map((i: StudyQueueItem) =>
            i.id === wordId
                ? {
                    ...item,
                    status: newStatus,
                    consecutiveMistakes: newMistakes,
                    nextReviewNum: nextDate,
                    interval: nextInterval,
                    easeFactor: nextEase,
                    mnemonic: item.mnemonic,
                    confusedWith: currentConfusedWith
                }
                : i
        );
        setLocalQueue(nextQueue);
        storage.setStudyQueue(nextQueue);
    }, [localQueue]);

    const updateMnemonic = useCallback(async (wordId: string, mnemonic: string) => {
        const item = localQueue.find((i: any) => i.id === wordId);
        if (!item) return;

        // 1. Update local state & storage
        const nextQueue = localQueue.map((i: StudyQueueItem) =>
            i.id === wordId ? { ...i, mnemonic } : i
        );
        setLocalQueue(nextQueue);
        storage.setStudyQueue(nextQueue);

        // 2. Persist to source folder
        const folderId = item.tags?.[0];
        if (folderId) {
            const folder = folders.find(f => f.id === folderId);
            if (folder) {
                const originalWord = folder.words.find(w => w.id === item.id || w.word.german === item.word.german);
                if (originalWord) {
                    updateWordInFolder(folderId, { ...originalWord, mnemonic });
                }
            }
        }
    }, [localQueue, folders, updateWordInFolder]);

    const setAsKnown = useCallback(async (wordId: string) => {
        const item = localQueue.find((i: any) => i.id === wordId);
        if (!item) return;

        // Set to a very long interval (6 months) and mark as review
        const nextInterval = 180;
        const nextDate = Date.now() + (1000 * 60 * 60 * 24 * nextInterval);

        const nextQueue = localQueue.map((i: StudyQueueItem) =>
            i.id === wordId
                ? {
                    ...i,
                    status: 'review' as const,
                    consecutiveMistakes: 0,
                    nextReviewNum: nextDate,
                    interval: nextInterval,
                    easeFactor: 2.5
                }
                : i
        );
        setLocalQueue(nextQueue);
        storage.setStudyQueue(nextQueue);

        // Also update SM2 state in folder if possible
        const folderId = item.tags?.[0];
        if (folderId) {
            const folder = folders.find(f => f.id === folderId);
            if (folder) {
                const originalWord = folder.words.find(w => w.id === item.id || w.word.german === item.word.german);
                if (originalWord) {
                    updateWordInFolder(folderId, {
                        ...originalWord,
                        sm2State: {
                            repetitions: 10, // Simulate mastery
                            interval: nextInterval,
                            easeFactor: 2.5,
                            nextReviewDate: nextDate
                        }
                    });
                }
            }
        }
    }, [localQueue, folders, updateWordInFolder]);

    const stats = useMemo(() => {
        const now = Date.now();
        const dueCount = localQueue.filter((i: StudyQueueItem) => i.nextReviewNum <= now && i.status !== 'new').length;
        const overdueCount = localQueue.filter((i: StudyQueueItem) => i.nextReviewNum < now && i.status !== 'new').length;
        const newCount = localQueue.filter((i: StudyQueueItem) => i.status === 'new').length;
        const learningCount = localQueue.filter((i: StudyQueueItem) => i.status === 'learning' || i.status === 'leech').length;
        const reviewCount = localQueue.filter((i: StudyQueueItem) => i.status === 'review').length;

        // Global limit (Synced with getDailySession logic)
        const isLargeDB = localQueue.length > 2000;
        const appSettings = storage.getSettings();
        const baseLimit = appSettings.productionMode === 'skip' ? 100 : 70;
        const dailyLimit = isLargeDB ? baseLimit + 20 : baseLimit;
        
        const availableTotal = Math.min(localQueue.length, dailyLimit);

        return {
            totalDue: dueCount,
            overdueCount,
            totalNew: newCount,
            totalLearning: learningCount,
            totalReview: reviewCount,
            totalLeeches: localQueue.filter((i: StudyQueueItem) => i.status === 'leech').length,
            totalAvailable: availableTotal,
            learnedTodayCount: storage.getDailySessionData().learnedTodayIds.length,
            dailyLimit
        };
    }, [localQueue]);

    return useMemo(() => ({
        queue: localQueue,
        isLoading: !isInitialLoadDone,
        getDailySession,
        updateItemStatus,
        updateMnemonic,
        setAsKnown,
        syncWithFolders,
        dailyStats,
        ...stats
    }), [localQueue, isInitialLoadDone, getDailySession, updateItemStatus, updateMnemonic, setAsKnown, syncWithFolders, stats]);
}
