
'use client';

import { StudyQueueItem } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SpeakButton } from '@/components/speak-button';
import { formatGermanWord, getGenderColorClass, getRussianType } from '@/lib/german-utils';
import { BrainCircuit, Siren } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { useSpeech } from '@/hooks/use-speech';
import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { commonWords } from '@/lib/common-words';
import { decomposeGermanWord, type DecomposeOutput } from '@/ai/flows/decompose-german-word';
import { getVerbFamily, type VerbFamilyOutput } from '@/ai/flows/get-verb-family';
import { getRektionLogic, type RektionLogicOutput } from '@/ai/flows/get-rektion-logic';
import { getWordCluster, type WordClusterOutput } from '@/ai/flows/get-word-cluster';
import { VerbFamilyTree } from './verb-family-tree';
import { WordClusterView } from './word-cluster-view';
import { Loader2, Info, Network, ArrowRight, MapPin, Link, Activity, Layers, Sparkles } from 'lucide-react';
import { FormattedGermanWord } from '../formatted-german-word';

interface PrimingViewProps {
    item: StudyQueueItem;
    onNext: () => void;
    onMarkAsKnown: () => void;
    isRefresh?: boolean;
}

export function PrimingView({ item, onNext, onMarkAsKnown, isRefresh }: PrimingViewProps) {
    const { word } = item;
    const { speak, speakSequence, stop, isLoaded } = useSpeech();
    const [decomposition, setDecomposition] = useState<DecomposeOutput | null>(null);
    const [isDecomposing, setIsDecomposing] = useState(false);
    const [verbFamily, setVerbFamily] = useState<VerbFamilyOutput | null>(null);
    const [isFetchingFamily, setIsFetchingFamily] = useState(false);
    const [rektionLogic, setRektionLogic] = useState<RektionLogicOutput | null>(null);
    const [isFetchingRektion, setIsFetchingRektion] = useState(false);
    const [wordCluster, setWordCluster] = useState<WordClusterOutput | null>(null);
    const [isFetchingCluster, setIsFetchingCluster] = useState(false);

    // Anti-Confusion: Identify the most dangerous partner
    const confusionPartnerId = useMemo(() => {
        if (!item.confusedWith) return null;
        const ids = Object.keys(item.confusedWith);
        if (ids.length === 0) return null;
        // Sort by mistake count and take the top one
        return ids.sort((a, b) => (item.confusedWith![b] || 0) - (item.confusedWith![a] || 0))[0];
    }, [item.confusedWith]);

    const confusionPartner = useMemo(() => {
        if (!confusionPartnerId) return null;
        return commonWords.find((w) => w.german === confusionPartnerId);
    }, [confusionPartnerId]);

    // Decomposition Effect
    useEffect(() => {
        setDecomposition(null);
        setVerbFamily(null);
        setRektionLogic(null);
        setWordCluster(null); // Reset all on word change
        if (word.german.includes(' ') || word.german.length > 10) {
            setIsDecomposing(true);
            decomposeGermanWord({ german: word.german })
                .then(setDecomposition)
                .catch((err: Error) => console.error("Decomposition failed", err))
                .finally(() => setIsDecomposing(false));
        }

        // Auto-fetch Rektion Logic if word has governance
        if (word.governance && word.governance.length > 0) {
            fetchRektionLogic();
        }
    }, [word.german]);

    const fetchRektionLogic = async () => {
        const gov = word.governance?.[0];
        if (!gov || isFetchingRektion) return;

        setIsFetchingRektion(true);
        try {
            const data = await getRektionLogic({
                german: formatGermanWord(word),
                preposition: gov.preposition,
                case: gov.case,
                russian: word.russian
            });
            setRektionLogic(data);
        } catch (err: any) {
            console.error("Rektion Logic fetch failed", err);
        } finally {
            setIsFetchingRektion(false);
        }
    };

    const fetchWordCluster = async () => {
        if (isFetchingCluster || wordCluster) return;
        setIsFetchingCluster(true);
        try {
            const data = await getWordCluster(formatGermanWord(word), word.type);
            setWordCluster(data);
        } catch (err: any) {
            console.error("Failed to fetch word cluster", err);
        } finally {
            setIsFetchingCluster(false);
        }
    };

    const fetchVerbFamily = async () => {
        if (isFetchingFamily || verbFamily) return;
        setIsFetchingFamily(true);
        try {
            const data = await getVerbFamily({ verb: formatGermanWord(word), russian: word.russian });
            setVerbFamily(data);
        } catch (err) {
            console.error("Failed to fetch verb family", err);
        } finally {
            setIsFetchingFamily(false);
        }
    };

    useEffect(() => {
        if (!isLoaded) return;
        let active = true;

        const playAudioFlow = async () => {
            if (!active) return;

            const sequence: { text: string, lang: string }[] = [
                { text: formatGermanWord(word), lang: 'de-DE' },
                { text: word.russian, lang: 'ru-RU' }
            ];

            if (word.collocations?.[0]) {
                const anchor = word.collocations[0];
                sequence.push({ text: anchor.phrase, lang: 'de-DE' });
                sequence.push({ text: anchor.translation, lang: 'ru-RU' });
            } else {
                if (word.example) {
                    sequence.push({ text: word.example, lang: 'de-DE' });
                }
                if (word.exampleMeaning) {
                    sequence.push({ text: word.exampleMeaning, lang: 'ru-RU' });
                }
            }

            // Wait for initial load if needed
            await new Promise(r => setTimeout(r, 800));
            if (!active) return;

            await speakSequence(sequence);
        };

        playAudioFlow();

        return () => {
            active = false;
            stop();
        };
    }, [item.id, isLoaded, speak, stop]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center space-y-4"
        >
            <div className="flex items-center gap-3 text-muted-foreground uppercase text-[10px] tracking-[0.2em] font-bold">
                <BrainCircuit className="h-4 w-4" />
                <span>{isRefresh ? '🔄 Повторная Загрузка' : 'Фаза 1: Загрузка Образа'}</span>
                {(item.consecutiveMistakes || 0) >= 3 && (
                    <Badge variant="outline" className="ml-2 flex gap-1 items-center border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        <Siren className="h-3 w-3" /> Сложное слово
                    </Badge>
                )}
                {word.level && (
                    <Badge variant="secondary" className="ml-2 bg-primary/10 text-primary border-primary/20">
                        {word.level}
                    </Badge>
                )}
            </div>

            <Card className="w-full bg-card border-none shadow-2xl overflow-hidden relative">
                <div className={cn("absolute top-0 left-0 w-full h-1 bg-gradient-to-r", isRefresh ? "from-orange-500 to-red-500" : "from-blue-500 to-purple-500")} />

                {/* Refresh Hint: shown when word was forgotten in Recognition */}
                {isRefresh && (
                    <div className="mx-4 mt-4 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-xl text-sm text-orange-700 dark:text-orange-300 animate-in fade-in slide-in-from-top-2">
                        <span className="font-bold">💡 Совет:</span> Попробуйте создать визуальный образ или ассоциацию с русским словом. Представьте ситуацию, где вы используете это слово.
                    </div>
                )}

                {/* Contrast Card: Side-by-side comparison with confused word */}
                {confusionPartner && (
                    <div className="mx-4 mt-4 p-4 bg-red-500/10 border-2 border-red-500/30 rounded-3xl animate-in zoom-in-95 duration-500">
                        <div className="flex items-center gap-2 mb-4">
                            <Badge className="bg-red-500 text-[10px] font-black uppercase shadow-lg">Anti-Confusion</Badge>
                            <span className="text-xs text-red-600 dark:text-red-400 font-black uppercase tracking-tighter">Не путайте эти слова!</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {/* Current Word */}
                            <div className="flex flex-col items-center p-4 bg-white/80 dark:bg-slate-950/80 rounded-2xl border-2 border-primary/20 shadow-md">
                                <div className="text-lg sm:text-2xl font-black text-primary mb-1">
                                    <FormattedGermanWord word={word} />
                                </div>
                                <div className="text-[10px] text-muted-foreground italic font-medium">{word.russian}</div>
                            </div>

                            {/* Confusion Partner */}
                            <div className="flex flex-col items-center p-4 bg-white/80 dark:bg-slate-950/80 rounded-2xl border-2 border-red-500/20 shadow-md">
                                <div className="text-lg sm:text-2xl font-black text-red-600 mb-1">
                                    <FormattedGermanWord word={confusionPartner} />
                                </div>
                                <div className="text-[10px] text-muted-foreground italic font-medium">{confusionPartner.russian}</div>
                            </div>
                        </div>

                        {/* Highlighting Differences */}
                        <div className="mt-4 p-3 bg-white/30 dark:bg-black/20 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 font-medium text-left leading-relaxed border border-red-500/10">
                            <span className="font-black text-red-600 block mb-1 uppercase tracking-widest text-[9px]">💡 В чем разница?</span>
                            Слова визуально похожи. Обращайте внимание на различия в корнях или приставках.
                            Используйте <strong>{word.german}</strong> для одного контекста и <strong>{confusionPartner.german}</strong> для другого.
                        </div>
                    </div>
                )}

                {/* Prepositions Badges (Top Left) */}
                {(() => {
                    const prepositions = Array.from(new Set(
                        [
                            ...(word.governance || []).map((g) => g.preposition),
                            word.preposition
                        ].filter(Boolean)
                            .map(p => String(p).trim())
                            .filter(p => p !== '' && p !== '-' && p.toLowerCase() !== 'без предлога')
                    ));

                    if (prepositions.length === 0) return null;

                    return (
                        <div className="absolute top-4 left-4 flex flex-col items-start gap-1.5 z-20">
                            {prepositions.map((prep, idx) => (
                                <Badge
                                    key={idx}
                                    variant="outline"
                                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-black uppercase tracking-widest bg-red-500/10 text-red-600 border-red-300 shadow-sm"
                                >
                                    {String(prep)}
                                </Badge>
                            ))}
                        </div>
                    );
                })()}

                <CardContent className="p-6 sm:p-8 flex flex-col items-center text-center space-y-4 relative z-10">

                    <div className="space-y-3 w-full">
                        <div className="flex flex-col gap-0 items-center justify-center pt-2">
                            <div className="text-5xl font-black tracking-tight text-primary">
                                <FormattedGermanWord word={word} />
                            </div>
                            {/* Specific Governance Display for Verbs and Adjectives */}
                            {/* Governance Section (Rektion) */}
                            {(word.type === 'verb' || word.type === 'adjective') && word.governance && word.governance.length > 0 && (
                                <div className="flex flex-col items-center gap-2 mt-2 w-full">
                                    {word.governance.map((gov, idx: number) => (
                                        <div key={idx} className="flex flex-col items-center bg-primary/10 p-4 rounded-2xl border-2 border-primary/20 w-full max-w-sm shadow-xl">
                                            <div className="flex items-center gap-3 text-2xl font-black">
                                                {gov.case === 'Akkusativ' && <ArrowRight className="h-5 w-5 text-red-500 animate-pulse" />}
                                                {gov.case === 'Dativ' && <MapPin className="h-5 w-5 text-emerald-500" />}
                                                {gov.case === 'Genitiv' && <Link className="h-5 w-5 text-amber-500" />}

                                                {gov.preposition === "без предлога" && gov.case === 'Akkusativ' && (word.german.toLowerCase().includes('sich') || gov.meaning?.toLowerCase().includes('возвратн')) ? (
                                                    <span className="text-primary tracking-tighter text-2xl">+ sich</span>
                                                ) : (
                                                    <span className="text-primary text-2xl">+ {gov.preposition}</span>
                                                )}
                                                <span className={cn(
                                                    "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight flex items-center gap-1 shadow-md",
                                                    gov.case === 'Akkusativ' ? "bg-red-600 text-white" :
                                                        gov.case === 'Dativ' ? "bg-emerald-600 text-white" :
                                                            gov.case === 'Nominativ' ? "bg-blue-600 text-white" :
                                                                gov.case === 'Genitiv' ? "bg-amber-600 text-white" :
                                                                    "bg-slate-700 text-white"
                                                )}>
                                                    {gov.case}
                                                    {gov.preposition && gov.preposition !== "без предлога" && (
                                                        <span className="ml-1 opacity-80 border-l border-white/30 pl-2 lowercase font-bold">
                                                            {gov.case === 'Akkusativ' ? 'wohin?' : 'wo?'}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>

                                            {/* RU vs DE Logic Comparison */}
                                            {rektionLogic?.comparison && (
                                                <div className="mt-2 w-full p-2 bg-white/40 dark:bg-black/20 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-400 border border-primary/5">
                                                    <span className="text-primary/70 mr-1 uppercase text-[9px]">Vs RU:</span>
                                                    {rektionLogic.comparison}
                                                </div>
                                            )}

                                            {gov.meaning && (
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-2 italic bg-primary/5 px-3 py-1 rounded-full">
                                                    ({gov.meaning})
                                                </div>
                                            )}
                                            {gov.example && (
                                                <div className="mt-2 text-xs text-muted-foreground leading-relaxed border-t border-primary/10 pt-2 w-full italic">
                                                    &ldquo;{gov.example}&rdquo;
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Rektion Logic Hint (AI Generated) */}
                            {rektionLogic && (
                                <div className="mt-4 w-full max-w-sm bg-gradient-to-br from-primary/5 to-transparent p-4 rounded-3xl border border-primary/10 text-left animate-in fade-in slide-in-from-bottom-2 duration-500">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Activity className="h-4 w-4 text-primary animate-pulse" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">Логика Управления</span>
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                                        {rektionLogic.logic}
                                    </p>
                                    {rektionLogic.visualMnemonic && (
                                        <div className="mt-2 text-[10px] italic text-primary/70 bg-primary/5 px-2 py-1 rounded-lg inline-block">
                                            💡 {rektionLogic.visualMnemonic}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Legacy case fallback for verbs */}
                            <div className="text-3xl font-black text-primary tracking-tight mt-6 flex items-center gap-4 bg-primary/5 p-4 rounded-2xl border-2 border-primary/10 shadow-lg">
                                <span>+ {word.preposition || ""}</span>
                                <span className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight flex items-center gap-1 shadow-md",
                                    word.case === 'Akkusativ' ? "bg-red-600 text-white" :
                                        word.case === 'Dativ' ? "bg-emerald-600 text-white" :
                                            word.case === 'Nominativ' ? "bg-blue-600 text-white" :
                                                word.case === 'Genitiv' ? "bg-amber-600 text-white" :
                                                    "bg-slate-700 text-white"
                                )}>
                                    {word.case}
                                    {(word.case === 'Akkusativ' || word.case === 'Dativ') && word.preposition && (
                                        <span className="ml-1 opacity-80 border-l border-white/30 pl-2 lowercase font-bold">
                                            {word.case === 'Akkusativ' ? 'wohin?' : 'wo?'}
                                        </span>
                                    )}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-0">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{getRussianType(word.type)}</div>
                            <div className="text-2xl text-foreground font-black italic">
                                {word.russian}
                            </div>
                        </div>

                        {/* Synonyms (Unobtrusive & Non-Italic) */}
                        {word.synonyms && word.synonyms.length > 0 && (
                            <div className="mt-2 flex flex-wrap justify-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                                {word.synonyms.map((s: any, idx: number) => (
                                    <span key={idx} className="text-xs font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-muted/50 border border-border/50">
                                        ≈ {s.word} ({s.translation})
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-4">
                        <SpeakButton text={formatGermanWord(word)} secondaryText={word.russian} size="lg" />
                    </div>

                    {/* Word Breakdown (Decomposition) */}
                    {isDecomposing && (
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse py-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Разбираем слово на части...
                        </div>
                    )}

                    {decomposition && (
                        <div className="w-full max-w-sm bg-muted/30 p-4 rounded-xl border border-dashed border-primary/20 text-left space-y-2 animate-in fade-in slide-in-from-top-2">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-primary/60 flex items-center gap-1">
                                <Info className="h-3 w-3" /> Разбор конструкции:
                            </div>
                            <div className="grid grid-cols-1 gap-1">
                                {decomposition.components.map((c: any, i: number) => (
                                    <div key={i} className="text-sm flex justify-between gap-4">
                                        <span className="font-bold text-slate-700">{c.word} {c.pronunciation && <span className="text-[10px] text-muted-foreground font-normal">[{c.pronunciation}]</span>}</span>
                                        <span className="text-slate-500">{c.translation}</span>
                                    </div>
                                ))}
                            </div>
                            {decomposition.explanation && (
                                <p className="text-[10px] italic text-muted-foreground pt-1 border-t border-primary/10">
                                    {decomposition.explanation}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Verb Family Integration */}
                    {word.type === 'verb' && !verbFamily && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 gap-2 border-primary/20 text-primary/60 hover:text-primary transition-all rounded-full h-8 px-4"
                            onClick={fetchVerbFamily}
                            disabled={isFetchingFamily}
                        >
                            {isFetchingFamily ? <Loader2 className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
                            <span className="text-[10px] font-bold uppercase tracking-tight">Семейство глагола (логика приставок)</span>
                        </Button>
                    )}

                    {verbFamily && (
                        <VerbFamilyTree data={verbFamily} currentVerb={formatGermanWord(word)} />
                    )}

                    {/* Word Family Cluster (Triple-Threat) */}
                    {!wordCluster && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 gap-2 border-indigo-500/20 text-indigo-500/60 hover:text-indigo-600 transition-all rounded-full h-8 px-4"
                            onClick={fetchWordCluster}
                            disabled={isFetchingCluster}
                        >
                            {isFetchingCluster ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            <span className="text-[10px] font-black uppercase tracking-tight">Расширить до кластера (Сущ+Глаг+Прил)</span>
                        </Button>
                    )}

                    {wordCluster && (
                        <WordClusterView data={wordCluster} currentWord={formatGermanWord(word)} />
                    )}

                    {/* Anchor Phrase (Collocation) as primary memorization aid */}
                    {word.collocations?.[0] ? (
                        <div className="w-full max-w-xl mt-6">
                            <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-6 rounded-3xl border-2 border-amber-500/20 shadow-xl relative group">
                                <div className="absolute -top-3 left-6 px-3 py-1 bg-amber-500 text-white text-[10px] font-black uppercase tracking-[0.1em] rounded-full shadow-lg">
                                    Лексический якорь
                                </div>
                                <div className="space-y-3 relative z-10">
                                    <p className="text-2xl md:text-3xl font-bold text-foreground leading-tight tracking-tight text-left pl-4 border-l-4 border-amber-500/30">
                                        {word.collocations[0].phrase}
                                    </p>
                                    <p className="text-md md:text-lg text-muted-foreground/80 italic text-left pl-4">
                                        — {word.collocations[0].translation}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : ('example' in word && word.example && (
                        <div className="w-full max-w-xl mt-6">
                            <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-6 rounded-3xl border-2 border-primary/20 shadow-xl relative group">
                                <div className="absolute -top-3 left-6 px-3 py-1 bg-primary text-white text-[10px] font-black uppercase tracking-[0.1em] rounded-full shadow-lg">
                                    B2 Beruf Phrase
                                </div>
                                <span className="text-4xl absolute top-4 left-2 opacity-10 font-serif leading-none">❝</span>
                                <div className="space-y-3 relative z-10">
                                    <p
                                        className="text-xl md:text-2xl font-bold text-foreground leading-tight tracking-tight text-left pl-4 border-l-4 border-primary/30"
                                        dangerouslySetInnerHTML={{ __html: word.example }}
                                    />
                                    {word.exampleMeaning && (
                                        <p className="text-md md:text-lg text-muted-foreground/80 italic text-left pl-4">
                                            — {word.exampleMeaning}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-2 opacity-50 uppercase tracking-[0.2em] font-bold">
                                Эффективная фраза для экзамена B2
                            </p>
                        </div>
                    ))}

                    {/* Verb Conjugations (Compact) */}
                    {word.type === 'verb' && word.conjugations && (
                        <div className="w-full max-w-sm mt-2 p-3 bg-primary/5 rounded-xl border border-primary/10">
                            <h4 className="text-[9px] font-bold uppercase tracking-widest text-primary/40 mb-2">Спряжение (Präsens)</h4>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">ich</span>
                                    <span className="font-bold">{word.conjugations.ich}</span>
                                </div>
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">wir</span>
                                    <span className="font-bold">{word.conjugations.wir}</span>
                                </div>
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">du</span>
                                    <span className="font-bold">{word.conjugations.du}</span>
                                </div>
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">ihr</span>
                                    <span className="font-bold">{word.conjugations.ihr}</span>
                                </div>
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">er/sie/es</span>
                                    <span className="font-bold">{word.conjugations.er_sie_es}</span>
                                </div>
                                <div className="flex justify-between border-b border-primary/10 pb-1">
                                    <span className="text-muted-foreground">sie/Sie</span>
                                    <span className="font-bold">{word.conjugations.sie_Sie}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Semantic Bridge: Synonyms & Collocations (Compact) */}
                    <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        {word.synonyms && word.synonyms.length > 0 && (
                            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 text-left">
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2">Синонимы</h4>
                                <div className="space-y-1">
                                    {word.synonyms.map((s: any, i: number) => (
                                        <div key={i} className="text-sm">
                                            <span className="font-bold text-blue-600">{s.word}</span>
                                            <span className="text-muted-foreground ml-2">— {s.translation}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {word.collocations && word.collocations.length > 0 && (
                            <div className="p-4 bg-purple-50/50 rounded-xl border border-purple-100 text-left">
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-2">Коллокации</h4>
                                <div className="space-y-1">
                                    {word.collocations.map((c: any, i: number) => (
                                        <div key={i} className="text-sm">
                                            <span className="font-bold text-purple-600">{c.phrase}</span>
                                            <span className="text-muted-foreground ml-2">— {c.translation}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Mnemonic */}
                    {(item.mnemonic || ((item.consecutiveMistakes || 0) >= 3 && word.mnemonic)) && (
                        <div className={cn(
                            "mt-4 p-3 border rounded-lg text-sm italic w-full max-w-md text-left",
                            (item.consecutiveMistakes || 0) >= 3
                                ? "bg-amber-100 border-amber-400 text-amber-900 shadow-lg"
                                : "bg-amber-50 border-amber-200 text-amber-900"
                        )}>
                            <span className="font-bold uppercase text-[10px] block mb-1 opacity-70">💡 Мнемоника (ассоциация):</span>
                            &ldquo;{item.mnemonic || word.mnemonic}&rdquo;
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Sticky CTA: keep the primary action visible even when the priming
                card grows tall (decomposition + verb family + cluster + collocations
                + mnemonic can easily push 1500px on a single card). */}
            <div className="sticky bottom-0 z-20 w-full max-w-sm space-y-3 px-2 pb-3 pt-3 bg-gradient-to-t from-background via-background/95 to-transparent backdrop-blur supports-[backdrop-filter]:bg-background/70">
                <div className="flex flex-col gap-2">
                    <Button size="lg" className="w-full h-14 text-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-lg" onClick={onNext}>
                        Запомнил
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-green-600 hover:bg-green-50" onClick={onMarkAsKnown}>
                        Знаю отлично (пропустить)
                    </Button>
                </div>
                <p className="text-xs text-center text-muted-foreground opacity-70">
                    Нажмите, когда чётко представите образ слова.
                </p>
            </div>
        </motion.div>
    );
}
