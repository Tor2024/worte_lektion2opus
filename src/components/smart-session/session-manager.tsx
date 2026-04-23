"use client";

import { useState, useEffect, useMemo } from 'react';
import { useStudyQueue } from '@/hooks/use-study-queue';
import { useSettings } from '@/hooks/use-settings';
import { StudyQueueItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { storage } from '@/lib/storage';
import { NeuralMap } from '../neural-map';
import { Progress } from '@/components/ui/progress';
import { BrainCircuit, CheckCircle, XCircle, ArrowRight, Layers, Target, PenTool, Siren, Loader2, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { PrimingView } from '@/components/smart-session/priming-view';
import { RecognitionView } from '@/components/smart-session/recognition-view';
import { ProductionView } from '@/components/smart-session/production-view';
import { RemedialView } from '@/components/smart-session/remedial-view';
import { ConsolidationView } from '@/components/smart-session/consolidation-view';
import { SpeakButton } from '@/components/speak-button';
import { formatGermanWord } from '@/lib/german-utils';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { generateStory, type GenerateStoryOutput } from '@/ai/flows/generate-story';
import { InteractiveText } from './interactive-text';
import { TooltipProvider } from '@/components/ui/tooltip';

import { decomposeGermanWord, type DecomposeOutput } from '@/ai/flows/decompose-german-word';
import { Edit2, Save, X, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { QuickRecallTest } from './quick-recall-test';

type GlobalPhase = 'priming' | 'recognition' | 'narrative' | 'production' | 'remedial';
type SessionState = 'loading' | 'intro' | 'warmup' | 'active' | 'consolidation' | 'summary';

interface SmartSessionManagerProps {
    folderId?: string;
}

export function SmartSessionManager({ folderId }: SmartSessionManagerProps) {
    const { getDailySession, updateItemStatus, updateMnemonic, setAsKnown, overdueCount, dailyLimit, isLoading } = useStudyQueue();
    const { settings } = useSettings();
    const [sessionQueue, setSessionQueue] = useState<StudyQueueItem[]>([]);
    const [sessionState, setSessionState] = useState<SessionState>('loading');
    const [sessionMode, setSessionMode] = useState<'learning' | 'review-only'>('learning');
    const [sessionNumber, setSessionNumber] = useState(1);

    // Adaptive Batch Management
    const getAdaptiveBatchSize = (items: StudyQueueItem[], batchIdx: number, defaultSize: number) => {
        const start = batchIdx * defaultSize;
        const batch = items.slice(start, start + defaultSize);
        const hasLeeches = batch.some(w => (w.consecutiveMistakes || 0) >= 3 || w.status === 'leech');
        const allEasy = batch.every(w => (w.interval || 0) > 15);
        if (hasLeeches) return 3;
        if (allEasy) return 6;
        return 4;
    };
    const BASE_BATCH_SIZE = 4;
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);

    // Phase Management
    const [currentPhase, setCurrentPhase] = useState<GlobalPhase>('priming');
    const [phaseIndex, setPhaseIndex] = useState(0); // Index within the current batch

    // Drill State (Phase 2)
    const [recognitionHits, setRecognitionHits] = useState<Record<string, number>>({});

    // Refresh State: Words that were forgotten and need re-priming
    const [refreshWords, setRefreshWords] = useState<Set<string>>(new Set());

    // Score/Results
    const [results, setResults] = useState<Record<string, 'success' | 'fail'>>({});

    // Narrative Anchoring: Story for each batch
    const [batchStories, setBatchStories] = useState<Record<number, GenerateStoryOutput & { wordMap: Record<string, string> }>>({});
    const [isNarrativeGenerating, setIsNarrativeGenerating] = useState(false);

    // Warm-up State
    const [warmupIndex, setWarmupIndex] = useState(0);
    const [isEditingMnemonic, setIsEditingMnemonic] = useState(false);
    const [editingMnemonicValue, setEditingMnemonicValue] = useState("");
    const [decomposition, setDecomposition] = useState<DecomposeOutput | null>(null);
    const [isDecomposing, setIsDecomposing] = useState(false);
    const [showQuickRecall, setShowQuickRecall] = useState(false);

    const leeches = useMemo(() => sessionQueue.filter(w => (w.consecutiveMistakes || 0) >= 3), [sessionQueue]);

    // Decomposition Effect for Warmup
    useEffect(() => {
        if (sessionState !== 'warmup' || !leeches[warmupIndex]) return;

        const currentLeech = leeches[warmupIndex];
        setIsEditingMnemonic(false);
        setEditingMnemonicValue(currentLeech.mnemonic || "");
        setDecomposition(null);

        // Decompose word if it's long (more than one word or long compound)
        if (currentLeech.word.german.includes(' ') || currentLeech.word.german.length > 10) {
            setIsDecomposing(true);
            decomposeGermanWord({ german: currentLeech.word.german })
                .then(setDecomposition)
                .catch(err => console.error("Decomposition failed", err))
                .finally(() => setIsDecomposing(false));
        }
    }, [sessionState, warmupIndex, leeches]);

    useEffect(() => {
        // Only load session if we are in 'loading' state
        if (sessionState !== 'loading') return;

        // CRITICAL FIX: Wait for queue to load from storage
        if (isLoading) return;

        // New session structure: { items, mode, sessionNumber }
        const session = getDailySession(folderId, settings.productionMode);

        // Wait for queue to be ready (if empty, retry later or show empty state if truly empty)
        // For now, getDailySession returns empty array if not ready

        setSessionQueue(session.items);
        setSessionMode(session.mode);
        setSessionNumber(session.sessionNumber);

        // Only transition state if we actually have items
        // If items are empty but we expect them, stay in loading?
        // getDailySession returns [] if localQueue is empty.
        // But localQueue loads async.
        // We should check if studyQueue is loaded.
        // For now, let's assume it loads fast enough or returns valid empty array.

        setSessionState(session.items.length > 0 ? 'intro' : 'summary');
    }, [getDailySession, sessionState, folderId, isLoading]);

    // Derived: Current batch words with adaptive sizing
    const BATCH_SIZE = useMemo(() => {
        return getAdaptiveBatchSize(sessionQueue, currentBatchIndex, BASE_BATCH_SIZE);
    }, [sessionQueue, currentBatchIndex]);

    const currentBatchWords = useMemo(() => {
        // Calculate actual start position using adaptive sizes
        let start = 0;
        for (let i = 0; i < currentBatchIndex; i++) {
            start += getAdaptiveBatchSize(sessionQueue, i, BASE_BATCH_SIZE);
        }
        return sessionQueue.slice(start, start + BATCH_SIZE);
    }, [sessionQueue, currentBatchIndex, BATCH_SIZE]);

    const totalBatches = Math.ceil(sessionQueue.length / BATCH_SIZE);

    // Words actually shown during the current Priming sub-phase. We mirror the
    // smart-skip filter from `currentItem` so the counter doesn't display
    // "1/4" when only 2 of 4 words actually visit Priming this session.
    // NOTE: must live above the early returns below — React requires a stable
    // hook count across renders.
    const primingWords = useMemo(() => currentBatchWords.filter(w => {
        const isNew = w.status === 'new';
        const isRefresh = refreshWords.has(w.id);
        const isShortInterval = (w.interval || 0) < 7;
        return isNew || isRefresh || isShortInterval;
    }), [currentBatchWords, refreshWords]);

    // Derived: Current item based on phaseIndex within current batch
    const currentItem = useMemo(() => {
        if (currentPhase === 'priming') {
            // SMART SKIP LOGIC:
            // 1. Always show Priming for NEW words or words in REFRESH mode.
            // 2. Show Priming for words with interval < 7 (Check-in).
            // 3. Skip for words with interval >= 7.
            const needsPriming = currentBatchWords.filter(w => {
                const isNew = w.status === 'new';
                const isRefresh = refreshWords.has(w.id);
                const isShortInterval = (w.interval || 0) < 7;
                return isNew || isRefresh || isShortInterval;
            });

            if (needsPriming.length === 0) return null; // Phase will auto-advance in useEffect or handleNext
            return needsPriming[phaseIndex] || null;
        }

        if (currentPhase === 'recognition') {
            // In recognition, we filter for words that haven't reached 2 hits yet
            const pendingWords = currentBatchWords.filter(w => (recognitionHits[w.id] || 0) < 2);
            if (pendingWords.length === 0) {
                // If all done but phase hasn't transitioned yet, show the last word to avoid null flash
                return currentBatchWords[currentBatchWords.length - 1] || null;
            }
            return pendingWords[phaseIndex % pendingWords.length];
        }

        if (currentPhase === 'narrative' || currentPhase === 'production') {
            return currentBatchWords[phaseIndex] || null;
        }

        return currentBatchWords[phaseIndex];
    }, [currentBatchWords, phaseIndex, currentPhase, recognitionHits, refreshWords]);

    // AUTO-ADVANCE phase if no items need current phase
    useEffect(() => {
        if (sessionState !== 'active') return;

        if (currentPhase === 'priming') {
            // SKIP PRIMING IN REVIEW-ONLY MODE (as per user request: "only selection/translations")
            if (sessionMode === 'review-only') {
                setCurrentPhase('recognition');
                setPhaseIndex(0);
                return;
            }

            const needsPriming = currentBatchWords.filter(w => {
                const isNew = w.status === 'new';
                const isRefresh = refreshWords.has(w.id);
                const isShortInterval = (w.interval || 0) < 7;
                return isNew || isRefresh || isShortInterval;
            });

            if (needsPriming.length === 0) {
                setCurrentPhase('recognition');
                setPhaseIndex(0);
            } else if (phaseIndex >= needsPriming.length) {
                setCurrentPhase('recognition');
                setPhaseIndex(0);
            }
        }

        // AUTO-ADVANCE RECOGNITION PHASE
        if (currentPhase === 'recognition') {
            const allDone = currentBatchWords.length > 0 && currentBatchWords.every(w => (recognitionHits[w.id] || 0) >= 2);
            if (allDone) {
                if (sessionMode === 'review-only') {
                    if (currentBatchIndex < totalBatches - 1) {
                        setCurrentBatchIndex(i => i + 1);
                        setCurrentPhase('recognition');
                        setPhaseIndex(0);
                        setRefreshWords(new Set());
                    } else {
                        setSessionState('consolidation');
                    }
                } else {
                    setCurrentPhase('narrative');
                    setPhaseIndex(0);
                }
            }
        }
    }, [currentPhase, currentBatchWords, phaseIndex, sessionState, refreshWords, sessionMode, recognitionHits, currentBatchIndex, totalBatches]);

    // Narrative Story Generation Effect
    useEffect(() => {
        if (sessionState !== 'active' || currentPhase !== 'narrative') return;
        if (batchStories[currentBatchIndex]) return; // Already generated

        const genStory = async () => {
            setIsNarrativeGenerating(true);
            try {
                const germanWords = currentBatchWords.map(w => w.id);
                const data = await generateStory({
                    words: germanWords,
                    topic: "Beruf und Alltag (Focus on learning context)"
                });

                // ENHANCEMENT: Rebuild the wordMap from the new vocabulary array format
                const enrichedWordMap: Record<string, string> = {};

                // 1. Add AI-generated vocabulary
                if (data.vocabulary && Array.isArray(data.vocabulary)) {
                    data.vocabulary.forEach(item => {
                        if (item.g && item.r) {
                            enrichedWordMap[item.g] = item.r;
                        }
                    });
                }

                // 2. Pre-seed/Fallback with keywords from currentBatchWords
                currentBatchWords.forEach(w => {
                    const german = w.word.german.toLowerCase().trim();
                    if (!enrichedWordMap[german]) {
                        enrichedWordMap[german] = w.word.russian;
                    }
                    // Handle words with articles like "die Reinigung"
                    const parts = german.split(/\s+/);
                    parts.forEach(p => {
                        const pLower = p.toLowerCase();
                        if (p.length > 2 && !enrichedWordMap[pLower]) {
                            enrichedWordMap[pLower] = w.word.russian;
                        }
                    });
                });

                setBatchStories(prev => ({
                    ...prev,
                    [currentBatchIndex]: {
                        ...data,
                        wordMap: enrichedWordMap
                    }
                }));
            } catch (err) {
                console.error("Failed to generate batch story", err);
                setBatchStories(prev => ({
                    ...prev,
                    [currentBatchIndex]: {
                        story: "Не удалось сгенерировать историю, но мы продолжим дрилл!",
                        title: "Ошибка синхронизации",
                        russianTitle: "Error sync",
                        russianTranslation: "Failed to generate story",
                        usedWords: [],
                        vocabulary: [],
                        wordMap: {}
                    }
                }));
            }
            finally {
                setIsNarrativeGenerating(false);
            }
        };

        genStory();
    }, [currentPhase, currentBatchIndex, currentBatchWords, sessionState]);

    const handleNext = (result: 'success' | 'fail', confusedWithId?: string) => {
        if (!currentItem) return;

        if (currentPhase === 'priming') {
            const needsPriming = currentBatchWords.filter(w => {
                const isNew = w.status === 'new';
                const isRefresh = refreshWords.has(w.id);
                const isShortInterval = (w.interval || 0) < 7;
                return isNew || isRefresh || isShortInterval;
            });

            if (phaseIndex < needsPriming.length - 1) {
                setPhaseIndex(i => i + 1);
            } else {
                // Move to Recognition for this batch
                setCurrentPhase('recognition');
                setPhaseIndex(0);
            }
        }
        else if (currentPhase === 'recognition') {
            if (result === 'success') {
                const newHits = (recognitionHits[currentItem.id] || 0) + 1;
                setRecognitionHits(prev => ({ ...prev, [currentItem.id]: newHits }));

                // In review-only mode, we treat 2 hits as a final success for the word
                if (newHits >= 2 && sessionMode === 'review-only') {
                    const finalResult = results[currentItem.id] === 'fail' ? 'fail' : 'success';
                    setResults(prev => ({ ...prev, [currentItem.id]: finalResult }));
                    updateItemStatus(currentItem.id, finalResult as 'success' | 'fail');
                }

                // Check if all words in current batch reached 2 hits
                const allDone = currentBatchWords.every(w => {
                    const hits = w.id === currentItem.id ? newHits : (recognitionHits[w.id] || 0);
                    return hits >= 2;
                });

                if (allDone) {
                    if (sessionMode === 'review-only') {
                        // All words in batch done, move to next batch or end
                        if (currentBatchIndex < totalBatches - 1) {
                            setCurrentBatchIndex(i => i + 1);
                            setCurrentPhase('recognition');
                            setPhaseIndex(0);
                            setRefreshWords(new Set());
                        } else {
                            setSessionState('consolidation');
                        }
                    } else {
                        setCurrentPhase('narrative');
                        setPhaseIndex(0);
                    }
                } else {
                    // Move to next pending word in batch
                    setPhaseIndex(i => i + 1);
                }
            } else {
                // FORGOT WORD LOGIC:
                // We always reset this word's recognition hits so it gets re-drilled
                // inside the current phase, and record the fail for SRS.
                setRecognitionHits(prev => ({ ...prev, [currentItem.id]: 0 }));
                setResults(prev => ({ ...prev, [currentItem.id]: 'fail' }));

                // In review-only mode, update status as fail immediately if failed in recognition
                if (sessionMode === 'review-only') {
                    updateItemStatus(currentItem.id, 'fail', confusedWithId);
                }

                // Only bounce the WHOLE batch back to Priming when the failed word
                // is genuinely new — i.e. we still owe the user a first exposure.
                // For already-seen words, sending the whole batch back through
                // Priming → Recognition × 2 directions multiplies session length
                // without improving retention; keep drilling inside Recognition
                // and let SRS lower the interval for the failed word.
                const isTrulyNew = currentItem.status === 'new';
                if (isTrulyNew) {
                    setRefreshWords(prev => new Set(prev).add(currentItem.id));
                    setCurrentPhase('priming');
                    setPhaseIndex(0);
                } else {
                    // Stay in recognition, advance to next pending word so the
                    // failed item cycles back via the `pendingWords` selector.
                    setPhaseIndex(i => i + 1);
                }
            }
        }
        else if (currentPhase === 'narrative') {
            if (settings.productionMode === 'skip') {
                // Skip Production: Auto-Succeed all words in the batch
                const updatedResults: Record<string, 'success' | 'fail'> = { ...results };
                currentBatchWords.forEach(w => {
                    const finalResult = results[w.id] === 'fail' ? 'fail' : 'success';
                    updatedResults[w.id] = finalResult;
                    updateItemStatus(w.id, finalResult as 'success' | 'fail');
                });
                setResults(updatedResults);

                // Move to next batch, start with priming
                if (currentBatchIndex < totalBatches - 1) {
                    setCurrentBatchIndex(i => i + 1);
                    setCurrentPhase('priming');
                    setPhaseIndex(0);
                    // Clear refresh flags for the new batch
                    setRefreshWords(new Set());
                } else {
                    // All batches finished, move to consolidation
                    setSessionState('consolidation');
                }
            } else {
                // One click for the whole batch story, move to production
                setCurrentPhase('production');
                setPhaseIndex(0);
            }
        }
        else if (currentPhase === 'production') {
            const finalResult = result === 'fail' ? 'fail' : (results[currentItem.id] === 'fail' ? 'fail' : 'success');
            const updatedResults: Record<string, 'success' | 'fail'> = { ...results, [currentItem.id]: finalResult };
            setResults(updatedResults);

            // SAVE PROGRESS IMMEDIATELY for this word
            updateItemStatus(currentItem.id, finalResult as 'success' | 'fail', result === 'fail' ? confusedWithId : undefined);

            if (phaseIndex < currentBatchWords.length - 1) {
                setPhaseIndex(i => i + 1);
            } else {
                // Production finished for this batch
                if (currentBatchIndex < totalBatches - 1) {
                    // Move to next batch, start with priming
                    setCurrentBatchIndex(i => i + 1);
                    setCurrentPhase('priming');
                    setPhaseIndex(0);
                    // Clear refresh flags for the new batch
                    setRefreshWords(new Set());
                } else {
                    // All batches finished, move to consolidation
                    setSessionState('consolidation');
                }
            }
        }
    };

    const updateBatchStory = (newSentence: string) => {
        setBatchStories(prev => {
            const current = prev[currentBatchIndex];
            if (!current) return prev;

            return {
                ...prev,
                [currentBatchIndex]: {
                    ...current,
                    story: current.story + " " + newSentence
                }
            };
        });
    };

    if (sessionState === 'loading') return <div className="p-10 text-center animate-pulse text-primary font-bold">Синхронизация нейро-слоев...</div>;

    if (sessionState === 'intro') {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 max-w-lg mx-auto mt-10">
                <div className="relative">
                    <BrainCircuit className="h-24 w-24 text-primary animate-pulse" />
                    <Badge className="absolute -top-2 -right-2 bg-green-500">v2.2</Badge>
                </div>

                {sessionMode === 'review-only' ? (
                    <>
                        <h1 className="text-4xl font-black tracking-tighter">РЕЖИМ ПОВТОРЕНИЯ</h1>
                        <p className="text-muted-foreground text-lg leading-relaxed">
                            Сессия #{sessionNumber}. Дневной лимит достигнут (2 сессии).
                            <br />Повторяем <strong>{sessionQueue.length}</strong> слов, изученных сегодня.
                        </p>
                        <div className="w-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 rounded-xl">
                            <span className="text-blue-700 dark:text-blue-400 font-bold">
                                🔄 Только повторение — новых слов нет
                            </span>
                        </div>
                    </>
                ) : (
                    <>
                        <h1 className="text-4xl font-black tracking-tighter">ПАКЕТНЫЙ РЕЖИМ</h1>
                        <p className="text-muted-foreground text-lg leading-relaxed">
                            Сессия #{sessionNumber}/2. Подготовлено <strong>{sessionQueue.length}</strong> объектов.
                            <br />Разбито на <strong>{totalBatches} этапа</strong> по {BATCH_SIZE} слов.
                            <br /><span className="block mt-2 font-mono text-sm">ЗНАКОМСТВО → ДРИЛЛ (x2) → КОНТЕКСТ</span>
                        </p>

                        {/* Overdue words warning */}
                        {overdueCount > 0 && (
                            <div className="w-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-4 rounded-xl text-center">
                                <span className="text-amber-700 dark:text-amber-400 font-bold">
                                    ⚠️ + {Math.min(overdueCount, 40)} просроченных слов в конце
                                </span>
                            </div>
                        )}
                    </>
                )}

                <Button size="lg" className="w-full text-xl h-16 shadow-xl hover:scale-[1.02] transition-transform" onClick={() => {
                    if (leeches.length > 0) {
                        setSessionState('warmup');
                    } else {
                        setSessionState('active');
                    }
                }}>
                    {sessionMode === 'review-only' ? 'Начать Повторение' : 'Начать Сессию'}
                </Button>
            </div>
        );
    }
    if (sessionState === 'warmup') {
        const currentLeech = leeches[warmupIndex];
        return (
            <div className="flex flex-col items-center justify-center p-8 space-y-8 max-w-lg mx-auto mt-10">
                <div className="flex items-center gap-2 text-red-500 font-bold uppercase tracking-widest text-sm">
                    <Siren className="h-5 w-5 animate-pulse" />
                    Разминка: Вход в поток
                </div>
                <Card className="w-full border-2 border-red-500/20 shadow-2xl bg-red-50/30">
                    <CardContent className="p-8 text-center space-y-6">
                        <div className="text-4xl font-black text-red-600">{formatGermanWord(currentLeech.word)}</div>
                        <div className="text-2xl italic text-slate-600 border-t pt-4">{currentLeech.word.russian}</div>

                        {/* Word Breakdown (Decomposition) */}
                        {isDecomposing && (
                            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse">
                                <Loader2 className="h-3 w-3 animate-spin" /> Разбираем слово на части...
                            </div>
                        )}

                        {decomposition && (
                            <div className="bg-white/50 p-4 rounded-xl border border-dashed border-red-200 text-left space-y-2 animate-in fade-in slide-in-from-top-2">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 flex items-center gap-1">
                                    <Info className="h-3 w-3" /> Разбор конструкции:
                                </div>
                                <div className="grid grid-cols-1 gap-1">
                                    {decomposition.components.map((c, i) => (
                                        <div key={i} className="text-sm flex justify-between gap-4">
                                            <span className="font-bold text-slate-700">{c.word} <span className="text-[10px] text-muted-foreground font-normal">[{c.pronunciation}]</span></span>
                                            <span className="text-slate-500">{c.translation}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Mnemonic Section with Editing */}
                        <div className="mt-4 p-4 bg-amber-100/50 rounded-lg text-sm text-amber-900 border border-amber-200 relative group">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">💡 Ассоциация (Для памяти):</span>
                                {!isEditingMnemonic && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => setIsEditingMnemonic(true)}
                                    >
                                        <Edit2 className="h-3 w-3" />
                                    </Button>
                                )}
                            </div>

                            {isEditingMnemonic ? (
                                <div className="space-y-2">
                                    <Input
                                        value={editingMnemonicValue}
                                        onChange={(e) => setEditingMnemonicValue(e.target.value)}
                                        className="bg-white border-amber-300 focus:border-amber-500"
                                        autoFocus
                                    />
                                    <div className="flex gap-1 justify-end">
                                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setIsEditingMnemonic(false)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                        <Button size="sm" className="h-8 px-2 bg-amber-600 hover:bg-amber-700" onClick={() => {
                                            updateMnemonic(currentLeech.id, editingMnemonicValue);
                                            // Update local sessionQueue so the UI reflects the change immediately
                                            setSessionQueue(prev => prev.map(item =>
                                                item.id === currentLeech.id ? { ...item, mnemonic: editingMnemonicValue } : item
                                            ));
                                            setIsEditingMnemonic(false);
                                        }}>
                                            <Save className="h-4 w-4 mr-1" /> Сохранить
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-left italic">
                                    {currentLeech.mnemonic || "Ассоциация пока не создана."}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Button size="lg" className="w-full h-16 text-xl" onClick={() => {
                    if (warmupIndex < leeches.length - 1) {
                        setWarmupIndex(i => i + 1);
                    } else {
                        setSessionState('active');
                    }
                }}>
                    Вспомнил ({warmupIndex + 1}/{leeches.length})
                </Button>
            </div>
        );
    }

    if (sessionState === 'summary') {
        const finalScore = Object.values(results).filter(r => r === 'success').length;
        const percentage = Math.round((finalScore / sessionQueue.length) * 100);

        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center p-4 text-center space-y-10 max-w-4xl mx-auto min-h-[80vh]"
            >
                <div className="space-y-4">
                    <div className="flex justify-center mb-6">
                        <div className="relative">
                            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 animate-pulse" />
                            <div className="bg-slate-950 border-2 border-primary/20 p-8 rounded-[2.5rem] shadow-2xl relative z-10 select-none">
                                <Trophy className="h-16 w-16 text-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]" />
                                <div className="absolute -bottom-4 -right-4 bg-green-500 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg border-2 border-slate-950 uppercase tracking-widest">
                                    Done
                                </div>
                            </div>
                        </div>
                    </div>

                    <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic">
                        Синхронизация <span className="text-primary not-italic">Завершена</span>
                    </h1>
                    <p className="text-slate-400 text-xl font-medium max-w-2xl">
                        Уровень усвоения: <span className="text-white font-black">{percentage}%</span>.
                        Ваши нейронные связи перестроены и готовы к работе.
                    </p>

                    {/* Quick Recall Test Integration */}
                    <QuickRecallTest
                        sessionWords={sessionQueue}
                        onComplete={(correct, total) => {
                            console.log(`Quick recall completed: ${correct}/${total}`);
                        }}
                        onDismiss={() => setShowQuickRecall(false)}
                    />
                </div>

                <div className="w-full bg-slate-950/50 p-6 rounded-[3rem] border border-white/5 shadow-inner backdrop-blur-sm">
                    <NeuralMap
                        items={sessionQueue}
                        title="Ваша обновленная нейронная сеть"
                    />
                </div>

                <div className="flex flex-col items-center gap-6 w-full max-w-md">
                    <div className="flex items-center gap-8">
                        <div className="text-center">
                            <div className="text-4xl font-black text-white">{finalScore}</div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Слов освоено</div>
                        </div>
                        <div className="w-px h-12 bg-white/10" />
                        <div className="text-center">
                            <div className="text-4xl font-black text-primary">{percentage}%</div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Точность</div>
                        </div>
                    </div>

                    <Button asChild size="lg" className="w-full h-16 text-xl shadow-[0_0_30px_rgba(var(--primary),0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all rounded-[1.5rem] font-black uppercase tracking-widest">
                        <Link href="/">Вернуться в штаб <ArrowRight className="ml-3 h-6 w-6" /></Link>
                    </Button>
                </div>
            </motion.div>
        );
    }

    if (sessionState === 'consolidation') {
        return (
            <div className="min-h-[500px] flex flex-col justify-center">
                <ConsolidationView
                    items={sessionQueue}
                    onComplete={() => {
                        // SAVE SESSION PROGRESS
                        const successIds = Object.entries(results)
                            .filter(([_, result]) => result === 'success')
                            .map(([id]) => id);

                        storage.incrementSession(successIds);
                        setSessionState('summary');
                    }}
                />
            </div>
        );
    }

    // From here on, sessionState MUST be 'active'

    // Active View Calculations
    const getPhaseTitle = () => {
        switch (currentPhase) {
            case 'priming': return 'Фаза 1: Знакомство';
            case 'recognition': return 'Фаза 2: Дрилл (x2)';
            case 'narrative': return 'Контекстная прелюдия';
            case 'production': return 'Фаза 3: Контекст (Письмо)';
            default: return '';
        }
    };

    const getPhaseIcon = () => {
        switch (currentPhase) {
            case 'priming': return <Layers className="h-5 w-5" />;
            case 'recognition': return <Target className="h-5 w-5" />;
            case 'production': return <PenTool className="h-5 w-5" />;
            default: return null;
        }
    };

    const progressValue = ((currentBatchIndex * 3 + (currentPhase === 'priming' ? 0 : currentPhase === 'recognition' ? 1 : 2)) / (totalBatches * 3)) * 100;

    // Phase relative progress
    const phaseProgressValue = currentPhase === 'priming'
        ? (phaseIndex / (primingWords.length || 1)) * 100
        : currentPhase === 'recognition'
            ? (currentBatchWords.filter(w => (recognitionHits[w.id] || 0) >= 2).length / (currentBatchWords.length || 1)) * 100
            : (phaseIndex / (currentBatchWords.length || 1)) * 100;

    return (
        <div className="max-w-2xl mx-auto p-4 space-y-8">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2 text-primary font-bold">
                            {getPhaseIcon()}
                            {getPhaseTitle()}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-tighter">
                            Этап {currentBatchIndex + 1} из {totalBatches}
                        </div>
                    </div>
                    <Badge variant="outline" className="font-mono">
                        {currentPhase === 'recognition'
                            ? `${currentBatchWords.filter(w => (recognitionHits[w.id] || 0) >= 2).length} / ${currentBatchWords.length} ГОТОВО`
                            : currentPhase === 'priming'
                                ? `${Math.min(phaseIndex + 1, primingWords.length || 1)} / ${primingWords.length || currentBatchWords.length}`
                                : `${Math.min(phaseIndex + 1, currentBatchWords.length)} / ${currentBatchWords.length}`
                        }
                    </Badge>
                </div>
                <Progress value={progressValue} className="h-2 shadow-inner" />
                <Progress value={phaseProgressValue} className="h-1 bg-primary/10" />
            </div>

            <div className="min-h-[500px] flex flex-col justify-center">
                {currentItem ? (
                    <>
                        {currentPhase === 'priming' && (
                            <PrimingView
                                key={currentItem.id}
                                item={currentItem}
                                onNext={() => handleNext('success')}
                                onMarkAsKnown={() => {
                                    setAsKnown(currentItem.id);
                                    handleNext('success');
                                }}
                                isRefresh={refreshWords.has(currentItem.id)}
                            />
                        )}
                        {currentPhase === 'recognition' && (
                            <div className="space-y-4">
                                <div className="flex justify-center gap-2 mb-4">
                                    {[1, 2].map(h => (
                                        <div
                                            key={h}
                                            className={cn(
                                                "w-12 h-2 rounded-full",
                                                (recognitionHits[currentItem.id] || 0) >= h ? "bg-green-500 shadow-[0_0_10px_purple-400]" : "bg-muted"
                                            )}
                                        />
                                    ))}
                                </div>
                                <RecognitionView
                                    key={`${currentItem.id}-${recognitionHits[currentItem.id] || 0}`}
                                    item={currentItem}
                                    onResult={handleNext}
                                    onMarkAsKnown={() => {
                                        setAsKnown(currentItem.id);
                                        handleNext('success');
                                    }}
                                    direction={(recognitionHits[currentItem.id] || 0) % 2 === 0 ? 0 : 1}
                                    distractorPool={sessionQueue}
                                    audioFirst={!!settings.audioFirst}
                                    // Variety: first hit is classic MCQ (DE→RU), second hit
                                    // uses cloze over the example sentence so the learner
                                    // meets the word in its natural context instead of
                                    // answering the same shape twice in a row. Cloze
                                    // transparently falls back to MCQ if no example exists.
                                    format={(recognitionHits[currentItem.id] || 0) % 2 === 1 ? 'cloze' : 'mcq'}
                                />
                            </div>
                        )}
                        {currentPhase === 'narrative' && (
                            <div className="space-y-6">
                                <div className="p-10 bg-[#f4ecd8] border border-[#d6c7a1] rounded-[2.5rem] relative shadow-2xl group min-h-[300px] ring-8 ring-[#f4ecd8]/50 ring-offset-4 ring-offset-slate-900/10">
                                    {/* Background Subtle Texture/Effect */}
                                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

                                    <div className="absolute -top-5 left-8 flex items-center gap-3 z-10">
                                        <div className="bg-[#2c1810] text-[#f4ecd8] px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl border border-[#d6c7a1]/30">
                                            Контекстная прелюдия
                                        </div>
                                        {!isNarrativeGenerating && batchStories[currentBatchIndex] && (
                                            <div className="flex items-center gap-2">
                                                <SpeakButton
                                                    text={batchStories[currentBatchIndex].story}
                                                    size="sm"
                                                    variant="secondary"
                                                    className="bg-white/80 hover:bg-white text-[#2c1810] shadow-xl transition-all rounded-full h-9 px-4 border border-[#d6c7a1]"
                                                    showText
                                                />
                                                <span className="text-[10px] text-[#2c1810]/40 font-mono">
                                                    [{Object.keys(batchStories[currentBatchIndex].wordMap).length}w]
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="text-xl leading-relaxed text-[#2c1810] font-sans font-medium drop-shadow-sm relative z-0">
                                        {isNarrativeGenerating ? (
                                            <div className="flex flex-col items-center justify-center py-12 space-y-4 text-[#2c1810]/40">
                                                <Loader2 className="h-10 w-10 animate-spin" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] animate-pulse">
                                                    Синхронизация контекстных полей...
                                                </span>
                                            </div>
                                        ) : batchStories[currentBatchIndex] ? (
                                            <TooltipProvider delayDuration={0}>
                                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                                                    <InteractiveText
                                                        text={batchStories[currentBatchIndex].story}
                                                        wordMap={batchStories[currentBatchIndex].wordMap}
                                                    />
                                                </div>
                                            </TooltipProvider>
                                        ) : (
                                            <div className="text-center py-12 text-[#2c1810]/40 italic text-sm font-sans">
                                                История не найдена.
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <Button size="lg" className="w-full h-16 text-xl bg-[#2c1810] hover:bg-[#3d2419] text-[#f4ecd8] rounded-2xl shadow-xl transition-all active:scale-[0.98]" onClick={() => handleNext('success')}>
                                    {settings.productionMode === 'skip' ? "Продолжить →" : "К упражнениям →"}
                                </Button>
                            </div>
                        )}
                        {currentPhase === 'production' && (
                            <ProductionView
                                key={currentItem.id}
                                item={currentItem}
                                storyContext={batchStories[currentBatchIndex]?.story || ""}
                                onStoryUpdate={updateBatchStory}
                                onResult={handleNext}
                                mode={settings.productionMode}
                            />
                        )}
                    </>
                ) : (
                    /* Fallback UI when currentItem is NULL - fixes stuck UI bug */
                    <div className="text-center space-y-4 p-8">
                        <BrainCircuit className="h-16 w-16 mx-auto text-muted-foreground animate-pulse" />
                        <p className="text-muted-foreground">Переход к следующему этапу...</p>
                        <Button
                            variant="outline"
                            onClick={() => {
                                // Auto-advance to next phase if stuck
                                if (currentPhase === 'recognition') {
                                    if (sessionMode === 'review-only') {
                                        if (currentBatchIndex < totalBatches - 1) {
                                            setCurrentBatchIndex(i => i + 1);
                                            setCurrentPhase('recognition');
                                            setPhaseIndex(0);
                                        } else {
                                            setSessionState('consolidation');
                                        }
                                    } else {
                                        setCurrentPhase('production');
                                        setPhaseIndex(0);
                                    }
                                } else if (currentBatchIndex < totalBatches - 1) {
                                    setCurrentBatchIndex(i => i + 1);
                                    setCurrentPhase('priming');
                                    setPhaseIndex(0);
                                } else {
                                    setSessionState('consolidation');
                                }
                            }}
                        >
                            Продолжить →
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
