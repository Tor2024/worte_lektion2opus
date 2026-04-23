
'use client';

import { use, useState, useMemo } from 'react';
import { useCustomFolders } from '@/hooks/use-custom-folders';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, Loader2, Sparkles, AlertCircle, X, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { enrichWord } from '@/ai/flows/enrich-word';
import { UserVocabularyWord, INITIAL_SM2_STATE } from '@/lib/types';
import { isWordStandardized } from '@/lib/german-utils';
import { v4 as uuidv4 } from 'uuid';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FlippableWordCard } from '@/components/flippable-word-card';
import { LearningDashboard } from '@/components/learning-dashboard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SystemGuideModal } from '@/components/system-guide-modal';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function FolderDetailsPage({ params }: { params: Promise<{ folderId: string }> }) {
    const { folderId } = use(params);
    const { getFolder, addWordToFolder, removeWordFromFolder, updateWordInFolder, isLoading } = useCustomFolders();
    const folder = getFolder(folderId);

    const router = useRouter();

    const [newWordInput, setNewWordInput] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAddWord, setShowAddWord] = useState(false);
    const [reverseMode, setReverseMode] = useState(false);

    // Batch Refresh State
    const [isBatchRefreshing, setIsBatchRefreshing] = useState(false);
    const [refreshProgress, setRefreshProgress] = useState('');

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }

    const handleAddWord = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newWordInput.trim() || isAdding) return;

        setIsAdding(true);
        setError(null);

        try {
            const enriched: any = await enrichWord({ word: newWordInput.trim(), context: folder?.name });

            // Защита от сохранения поломанной карточки при ошибках AI (любой природы).
            // Больше НЕ считаем все ошибки «превышением лимита» — `enrichWord` теперь
            // возвращает поле `__enrichmentError.kind`, которое чётко разделяет
            // real rate-limit от прочих сбоев (schema / safety / network).
            if (enriched?.__enrichmentError || enriched?.russian === 'Ошибка обогащения AI') {
                const kind = enriched?.__enrichmentError?.kind;
                throw new Error(kind === 'rate_limit' ? 'AI_LIMIT' : 'AI_ERROR');
            }

            const newWord: UserVocabularyWord = {
                id: uuidv4(),
                word: enriched as any,
                sm2State: { ...INITIAL_SM2_STATE },
                addedAt: Date.now(),
                context: enriched.example,
                contextTranslation: enriched.exampleMeaning,
                synonyms: enriched.synonyms,
                antonyms: enriched.antonyms
            };

            await addWordToFolder(folderId, newWord);
            setNewWordInput('');
        } catch (err: any) {
            console.error("Failed to add word:", err);
            // Показываем сообщение про лимит ТОЛЬКО при реальном 429 от Google AI,
            // а не при любом сбое (schema, safety filter, сеть), как было раньше.
            const msg: string = err?.message || '';
            const isRealRateLimit =
                msg === 'AI_LIMIT' ||
                /\b429\b/.test(msg) ||
                /RESOURCE_EXHAUSTED/i.test(msg) ||
                /rateLimitExceeded/i.test(msg) ||
                /quota exceeded/i.test(msg);

            if (isRealRateLimit) {
                setError("Лимит AI исчерпан. Пожалуйста, подождите минуту перед добавлением новых слов.");
            } else {
                setError("Не удалось добавить слово. Проверьте соединение или попробуйте ещё раз.");
            }
        } finally {
            setIsAdding(false);
        }
    };

    const startSession = () => {
        if (!folder) return;
        router.push(`/daily-session?folderId=${folderId}`);
    };

    if (!folder) {
        return (
            <div className="container mx-auto py-8 text-center">
                <h1 className="text-2xl font-bold mb-4">Папка не найдена</h1>
                <Button asChild variant="secondary">
                    <Link href="/my-lectures"><ArrowLeft className="mr-2 h-4 w-4" /> Вернуться к списку</Link>
                </Button>
            </div>
        )
    }

    const displayWords = folder.words;

    const handleRefreshWord = async (userWord: UserVocabularyWord) => {
        try {
            const german = userWord.word.german;
            const enriched: any = await enrichWord({
                word: german,
                context: `Focus on B2 Beruf primary meaning. Folder: ${folder?.name}`
            });

            // If the flow returned its error sentinel, surface the real kind of error
            // (rate-limit vs generic) instead of silently saving a broken card.
            if (enriched?.__enrichmentError || enriched?.russian === 'Ошибка обогащения AI') {
                const kind = enriched?.__enrichmentError?.kind;
                throw new Error(kind === 'rate_limit' ? 'AI_LIMIT' : 'AI_ERROR');
            }

            // Robust mapping of AI fields to our internal types
            const baseWordData: any = {
                ...enriched,
                needsUpdate: false
            };

            // Fix field naming inconsistencies
            if (enriched.type === 'noun') {
                baseWordData.exampleSingular = enriched.example;
                baseWordData.examplePlural = enriched.example; // Fallback
            }

            if (enriched.type === 'verb' && enriched.verbTenses) {
                baseWordData.praeteritum = enriched.verbTenses.praeteritum;
                baseWordData.futur1 = enriched.verbTenses.futur1;
                baseWordData.futur2 = enriched.verbTenses.futur2;
            }

            const updatedWord: UserVocabularyWord = {
                ...userWord,
                word: baseWordData as any,
                synonyms: enriched.synonyms, // Ensure these are top-level too
                antonyms: enriched.antonyms,
                context: enriched.example,
                contextTranslation: enriched.exampleMeaning,
                needsUpdate: false
            };

            updateWordInFolder(folderId, updatedWord);
        } catch (e: any) {
            console.error("Refresh failed", e);
            const msg: string = e?.message || '';
            if (
                msg === 'AI_LIMIT' ||
                /\b429\b/.test(msg) ||
                /RESOURCE_EXHAUSTED/i.test(msg) ||
                /rateLimitExceeded/i.test(msg) ||
                /quota exceeded/i.test(msg)
            ) {
                throw new Error("AI_LIMIT");
            }
            throw e;
        }
    };

    // Parallel batch processing: we fan out enrich calls in small chunks so the
    // Gemini key-pool can be exercised in parallel instead of strictly serially.
    // Previously we waited for each word to finish (~8s avg * N words). With a
    // pool of 15+ keys available, running CHUNK_SIZE requests concurrently
    // gives a near-linear speed-up without exhausting any single key's RPM
    // (Gemini free tier is 15 RPM per key, so 8 concurrent across 15 keys is
    // comfortable and leaves headroom for retries / other enrich paths).
    const CHUNK_SIZE = 8;
    const processBatchQueue = async (wordsToProcess: UserVocabularyWord[], _startIndex: number = 0, _initialSkipped: number = 0) => {
        let completed = 0;
        let skipped = 0;
        let rateLimitHit = false;

        for (let i = 0; i < wordsToProcess.length && !rateLimitHit; i += CHUNK_SIZE) {
            const chunk = wordsToProcess.slice(i, i + CHUNK_SIZE);

            // Pre-filter: standardized words don't need re-enrichment.
            const needsEnrich = chunk.filter(w => !(isWordStandardized(w) && !w.needsUpdate));
            skipped += chunk.length - needsEnrich.length;

            setRefreshProgress(`${Math.min(i + CHUNK_SIZE, wordsToProcess.length)} / ${wordsToProcess.length} (Пропущено: ${skipped})`);

            const results = await Promise.allSettled(
                needsEnrich.map(w => handleRefreshWord(w))
            );

            for (const r of results) {
                if (r.status === 'fulfilled') {
                    completed += 1;
                } else {
                    const msg = (r.reason && r.reason.message) || '';
                    if (msg === 'AI_LIMIT') {
                        rateLimitHit = true;
                    } else {
                        console.error('[batch-refresh] word failed', r.reason);
                    }
                }
            }
        }

        setIsBatchRefreshing(false);
        setRefreshProgress('');

        if (rateLimitHit) {
            setError('Лимит AI исчерпан. Обновление приостановлено.');
        } else if (skipped > 0) {
            alert(`Обновление завершено. ${completed} обновлено, ${skipped} пропущено.`);
        }
    };

    const handleBatchRefresh = async () => {
        // Only trigger for words that actually need it or aren't standardized
        const allPending = folder.words;
        const toProcess = allPending.filter(w => w.needsUpdate || !isWordStandardized(w));

        if (toProcess.length === 0) {
            alert("Все слова в этой папке уже соответствуют стандарту B2 Beruf.");
            return;
        }

        if (!confirm(`Обновить ${toProcess.length} слов, требующих внимания, с помощью AI? \n\nОстальные слова будут пропущены для экономии лимитов.`)) return;

        setIsBatchRefreshing(true);
        setError(null);
        processBatchQueue(toProcess, 0, 0);
    };

    return (
        <div className="container mx-auto py-8">
            <div className="mb-6">
                <Link href="/my-lectures" className="text-sm text-primary hover:underline flex items-center mb-4">
                    <ArrowLeft className="mr-1 h-3 w-3" /> Назад к папкам
                </Link>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                    <div>
                        <Link href="/my-lectures" className="text-sm text-primary hover:underline mb-2 inline-block">
                            &larr; Назад к папкам
                        </Link>
                        <h1 className="text-3xl font-bold font-headline">{folder.name}</h1>
                        <p className="text-muted-foreground">{folder.words.length} слов</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        {isBatchRefreshing ? (
                            <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 rounded-md">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <span className="text-sm font-medium">{refreshProgress}</span>
                            </div>
                        ) : (
                            <Button variant="outline" onClick={handleBatchRefresh} disabled={folder.words.length === 0}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Обновить все
                            </Button>
                        )}

                        <Button variant="default" className="bg-gradient-to-r from-blue-600 to-purple-600 text-white" onClick={() => router.push(`/my-lectures/${folderId}/deep-dive`)}>
                            Start Deep Dive
                        </Button>
                        <SystemGuideModal />
                        <Button onClick={() => setShowAddWord(!showAddWord)}>
                            {showAddWord ? 'Закрыть' : 'Добавить слово'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* LEARNING DASHBOARD */}
            <LearningDashboard
                totalWords={folder.words.length}
                onStartSession={startSession}
                onGenerateStory={() => router.push(`/my-lectures/${folderId}/story`)}
                onUsageCoach={() => router.push(`/my-lectures/${folderId}/coach`)}
                onRoleplay={() => router.push(`/my-lectures/${folderId}/roleplay`)}
                onPodcast={() => router.push(`/my-lectures/${folderId}/podcast`)}
                onInterivew={() => router.push(`/my-lectures/${folderId}/interview`)}
                onCollocation={() => router.push(`/my-lectures/${folderId}/collocation`)}
                onSynonymSwap={() => router.push(`/my-lectures/${folderId}/synonym`)}
                onStartDrill={() => router.push(`/my-lectures/${folderId}/drill`)}
                onRektionDrill={() => router.push(`/my-lectures/${folderId}/rektion`)}
            />



            {/* ADD WORD (Only in normal mode) */}
            {showAddWord && (
                <Card className="mb-8 border-primary/20 bg-primary/5">
                    <CardContent className="pt-6">
                        <form onSubmit={handleAddWord} className="flex gap-2 items-center">
                            <div className="relative flex-grow">
                                <Sparkles className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-primary" />
                                <Input
                                    placeholder="Введите немецкое слово (например, 'laufen')..."
                                    className="pl-9"
                                    value={newWordInput}
                                    onChange={(e) => setNewWordInput(e.target.value)}
                                    disabled={isAdding}
                                />
                            </div>
                            <Button type="submit" disabled={isAdding || !newWordInput.trim()}>
                                {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                                Добавить
                            </Button>
                        </form>
                        {error && (
                            <Alert variant="destructive" className="mt-4">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Ошибка</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* VIEW OPTIONS & FILTERS */}
            <div className="flex justify-between items-center mb-4 px-1">
                <div className="flex items-center space-x-2">
                    <Switch id="reverse-mode" checked={reverseMode} onCheckedChange={setReverseMode} />
                    <Label htmlFor="reverse-mode" className="cursor-pointer">Режим перевода (RU &rarr; DE)</Label>
                </div>
            </div>

            {/* WORD GRID With Flip Cards */}
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                {displayWords.map((userWord) => (
                    <div key={userWord.id} className="relative group/wrapper">
                        <FlippableWordCard
                            userWord={userWord}
                            reverse={reverseMode}
                            onRefresh={() => handleRefreshWord(userWord)}
                            onTranslationSelect={(translation) => {
                                const updatedWord = {
                                    ...userWord,
                                    word: {
                                        ...userWord.word,
                                        russian: translation
                                    }
                                };
                                updateWordInFolder(folderId, updatedWord);
                            }}
                        />

                        <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-2 right-2 z-10 opacity-0 group-hover/wrapper:opacity-100 transition-opacity h-8 w-8 rounded-full shadow-md"
                            onClick={() => {
                                if (confirm('Удалить слово?')) removeWordFromFolder(folderId, userWord.id);
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                ))}

                {folder.words.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground">
                        <p>В этой папке пока нет слов.</p>
                        <p>Добавьте первое слово сверху!</p>
                    </div>
                )}
            </div>
        </div >
    );
}
