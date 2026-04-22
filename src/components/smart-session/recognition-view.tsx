
'use client';

import { StudyQueueItem, VocabularyWord } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatGermanWord, getGenderColorClass } from '@/lib/german-utils';
import { BrainCircuit, Check, X, ArrowRight, MapPin, Link } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useMemo, useEffect } from 'react';
import { useSpeech } from '@/hooks/use-speech';
import { commonWords } from '@/lib/common-words';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FormattedGermanWord } from '../formatted-german-word';

interface RecognitionViewProps {
    item: StudyQueueItem;
    onResult: (result: 'success' | 'fail', confusedWithId?: string) => void;
    onMarkAsKnown: () => void;
    direction?: 0 | 1; // 0 = DE->RU, 1 = RU->DE
    /**
     * Pool of StudyQueueItems (current batch / current session / known folders)
     * from which to draw distractors BEFORE falling back to the static
     * `commonWords` seed list. Prioritises words the learner actually knows,
     * which makes the multiple-choice trial much more diagnostic.
     */
    distractorPool?: StudyQueueItem[];
    /**
     * Audio-first recognition: the prompt word is hidden until the user
     * answers, forcing reliance on the spoken form. Most useful for B1+.
     */
    audioFirst?: boolean;
}

export function RecognitionView({
    item,
    onResult,
    onMarkAsKnown,
    direction: forcedDirection,
    distractorPool,
    audioFirst,
}: RecognitionViewProps) {
    const { word } = item;
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const [showSuccess, setShowSuccess] = useState(false);
    const { speak, speakSequence, stop, isLoaded } = useSpeech();

    // Stop speech when word changes or component unmounts
    useEffect(() => {
        return () => stop();
    }, [item.id, stop]);

    // If forcedDirection is provided, use it. Otherwise, fallback to random (for standalone usage).
    const direction = useMemo(() =>
        forcedDirection !== undefined ? forcedDirection : (Math.random() > 0.5 ? 1 : 0),
        [item.id, forcedDirection]);

    useEffect(() => {
        if (!isLoaded) return;
        if (direction === 0) {
            speak(formatGermanWord(word), 'de-DE');
        } else {
            speak(word.russian, 'ru-RU');
        }
    }, [speak, word, isLoaded, direction]);

    const options = useMemo(() => {
        const correct = direction === 0 ? word.russian : formatGermanWord(word);
        const renderOption = (w: VocabularyWord | undefined | null): string | null => {
            if (!w) return null;
            const value = direction === 0 ? w.russian : formatGermanWord(w);
            if (!value) return null;
            if (value === correct) return null;
            return value;
        };

        const seen = new Set<string>([correct]);
        const pushUnique = (bucket: string[], candidate: string | null) => {
            if (!candidate) return;
            if (seen.has(candidate)) return;
            seen.add(candidate);
            bucket.push(candidate);
        };

        const pool = (distractorPool || []).filter(it => it.word && it.id !== item.id);

        // 1. "Confusion partners": words the learner has actually mistaken for this one.
        const confusedIds = Object.keys(item.confusedWith || {})
            .sort((a, b) => (item.confusedWith![b] || 0) - (item.confusedWith![a] || 0))
            .slice(0, 2);
        const confusionDistractors: string[] = [];
        confusedIds.forEach(cid => {
            const fromPool = pool.find(p => p.id === cid || p.word.german === cid);
            const fromCommon = commonWords.find(cw => cw.german === cid);
            pushUnique(confusionDistractors, renderOption(fromPool?.word || fromCommon));
        });

        // 2. Words from the same batch / session — highest "discrimination" value.
        const sameBatch = pool
            .filter(it => !confusedIds.includes(it.id) && !confusedIds.includes(it.word.german))
            .sort(() => Math.random() - 0.5);
        const batchDistractors: string[] = [];
        for (const it of sameBatch) {
            if (batchDistractors.length >= 3) break;
            pushUnique(batchDistractors, renderOption(it.word));
        }

        // 3. Same morpheme / type / level — builds meaningful contrast.
        const relatedDistractors: string[] = [];
        if (confusionDistractors.length + batchDistractors.length < 3) {
            const sameRoot = pool.filter(it =>
                word.root && it.word.root && it.word.root === word.root && it.word.german !== word.german
            );
            const sameType = pool.filter(it =>
                it.word.type === word.type && it.word.german !== word.german
            );
            const pooled = [...sameRoot, ...sameType]
                .sort(() => Math.random() - 0.5);
            for (const it of pooled) {
                if (confusionDistractors.length + batchDistractors.length + relatedDistractors.length >= 3) break;
                pushUnique(relatedDistractors, renderOption(it.word));
            }
        }

        // 4. Fallback to the static seed vocabulary.
        const randomDistractors: string[] = [];
        const needed = 3 - confusionDistractors.length - batchDistractors.length - relatedDistractors.length;
        if (needed > 0) {
            const seed = commonWords
                .filter(w => w.german !== word.german && !confusedIds.includes(w.german))
                .sort(() => Math.random() - 0.5);
            for (const w of seed) {
                if (randomDistractors.length >= needed) break;
                pushUnique(randomDistractors, renderOption(w));
            }
        }

        const allOptions = [
            ...confusionDistractors,
            ...batchDistractors,
            ...relatedDistractors,
            ...randomDistractors,
            correct,
        ];
        return allOptions.sort(() => Math.random() - 0.5);
    }, [word, direction, item.id, item.confusedWith, distractorPool]);

    const handleSelect = async (option: string) => {
        if (selectedOption || showSuccess) return;

        setSelectedOption(option);
        const correctValue = direction === 0 ? word.russian : formatGermanWord(word);
        const correct = option === correctValue;
        setIsCorrect(correct);

        if (correct) {
            setShowSuccess(true);

            const sequence: { text: string, lang: string }[] = [];

            // 1. The word itself in opposite language
            if (direction === 0) {
                sequence.push({ text: word.russian, lang: 'ru-RU' });
            } else {
                sequence.push({ text: formatGermanWord(word), lang: 'de-DE' });
            }

            // 2. The Anchor Phrase (Collocation) instead of full sentence
            const firstCollocation = word.collocations?.[0];
            if (firstCollocation) {
                sequence.push({ text: firstCollocation.phrase, lang: 'de-DE' });
                sequence.push({ text: firstCollocation.translation, lang: 'ru-RU' });
            }

            await speakSequence(sequence);

            // Small wait after audio
            await new Promise(r => setTimeout(r, 600));
            onResult('success');
        } else {
            // Find which word was selected to track confusion
            const confusedWord = commonWords.find(w =>
                (direction === 0 ? w.russian : formatGermanWord(w)) === option
            );

            // Incorrect - small delay then next
            setTimeout(() => {
                onResult('fail', confusedWord?.german);
            }, 1500);
        }
    };

    if (showSuccess) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center space-y-6 w-full max-w-2xl px-4"
            >
                <div className="flex flex-col items-center gap-2 mb-4">
                    <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(34,197,94,0.5)] animate-bounce">
                        <Check className="h-10 w-10 text-white stroke-[4]" />
                    </div>
                    <h2 className="text-2xl font-black text-green-500 uppercase tracking-widest mt-2">Верно!</h2>
                </div>

                <Card className="w-full bg-slate-950 border-green-500/30 shadow-2xl overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent pointer-events-none" />
                    <CardContent className="p-8 flex flex-col items-center text-center space-y-6 relative z-10">

                        <div className="flex flex-col items-center gap-1">
                            <div className="text-4xl font-black tracking-tight text-white mb-1">
                                <FormattedGermanWord word={word} />
                            </div>
                            <div className="text-xl text-green-400 font-bold italic">
                                {word.russian}
                            </div>
                        </div>

                        {/* Anchor Phrase (Collocation) instead of full sentence in Phase 2 */}
                        {word.collocations && word.collocations.length > 0 && (
                            <div className="w-full pt-6 border-t border-white/10 space-y-3">
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] uppercase font-black px-3">
                                    Лексический якорь
                                </Badge>
                                <p className="text-2xl md:text-3xl font-bold text-white leading-tight tracking-tight text-left pl-4 border-l-4 border-amber-500/50">
                                    {word.collocations[0].phrase}
                                </p>
                                <p className="text-md text-slate-400 italic text-left pl-4">
                                    — {word.collocations[0].translation}
                                </p>
                            </div>
                        )}

                        <div className="flex items-center gap-2 text-green-500/50 text-[10px] uppercase font-bold tracking-widest animate-pulse mt-4">
                            <BrainCircuit className="h-3 w-3" /> Озвучка и переход к следующему слову...
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col items-center space-y-4"
        >
            <div className="flex items-center gap-2 text-primary uppercase text-[8px] font-black tracking-[0.2em] animate-pulse">
                <BrainCircuit className="h-3 w-3" /> Фаза 2: Укрепление нейронной связи
            </div>

            <Card className="w-full bg-slate-950 border-primary/20 shadow-2xl relative overflow-hidden group">
                {/* Visual "Neural" element */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-primary/10 blur-3xl rounded-full group-hover:bg-primary/20 transition-colors" />

                {/* Prepositions/Governance Badges (Top Left) */}
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

                <CardContent className="p-6 sm:p-8 flex flex-col items-center text-center relative z-10 pt-10">
                    <div className="text-[10px] font-bold text-primary/60 mb-2 uppercase tracking-widest">
                        {direction === 0 ? "Понимаете ли вы это слово?" : "Как это будет по-немецки?"}
                    </div>

                    <div className="flex flex-col items-center gap-1 mb-4">
                        <div className="text-4xl font-black tracking-tighter text-white h-[48px] flex items-center">
                            {audioFirst && !selectedOption && !showSuccess ? (
                                <button
                                    type="button"
                                    onClick={() => direction === 0
                                        ? speak(formatGermanWord(word), 'de-DE')
                                        : speak(word.russian, 'ru-RU')}
                                    className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl px-5 py-2 transition-colors"
                                    aria-label="Воспроизвести слово повторно"
                                >
                                    <BrainCircuit className="h-5 w-5 text-primary animate-pulse" />
                                    <span className="text-sm font-bold uppercase tracking-[0.25em] text-primary/70">
                                        Слушайте и выбирайте
                                    </span>
                                </button>
                            ) : (
                                direction === 0 ? <FormattedGermanWord word={word} /> : word.russian
                            )}
                        </div>
                        {/* Governance Section (Rektion) as Hint */}
                        {((word.type === 'verb' || word.type === 'adjective') && word.governance && word.governance.length > 0) && (
                            <div className="flex flex-col items-center gap-1.5 mt-2 w-full max-w-[280px]">
                                {word.governance.map((gov, idx: number) => (
                                    <div key={idx} className="flex flex-col items-center bg-white/10 py-2 px-4 rounded-2xl border border-white/20 w-full transition-all hover:bg-white/20 shadow-lg">
                                        <div className="flex items-center gap-3 text-lg font-black">
                                            {gov.preposition === "без предлога" && gov.case === 'Akkusativ' && (word.german.toLowerCase().includes('sich') || gov.meaning?.toLowerCase().includes('возвратн')) ? (
                                                <span className="text-secondary tracking-tighter text-xs">+ sich</span>
                                            ) : (
                                                <span className="text-white">+ {gov.preposition}</span>
                                            )}
                                            <span className={cn(
                                                "px-2 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-tighter flex items-center gap-1 shadow-sm",
                                                gov.case === 'Akkusativ' ? "bg-red-600 text-white" :
                                                    gov.case === 'Dativ' ? "bg-emerald-600 text-white" :
                                                        gov.case === 'Nominativ' ? "bg-blue-600 text-white" :
                                                            gov.case === 'Genitiv' ? "bg-amber-600 text-white" :
                                                                "bg-slate-700 text-white"
                                            )}>
                                                {gov.case === 'Akkusativ' && <ArrowRight className="h-2 w-2" />}
                                                {gov.case === 'Dativ' && <MapPin className="h-2 w-2" />}
                                                {gov.case}
                                                {gov.preposition && gov.preposition !== "без предлога" && (
                                                    <span className="ml-1 lowercase font-bold text-[9px] opacity-80 border-l border-white/30 pl-1">
                                                        {gov.case === 'Akkusativ' ? 'wohin?' : 'wo?'}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        {gov.meaning && (
                                            <div className="text-[10px] font-bold text-slate-200 italic mt-1 bg-black/20 px-2 py-0.5 rounded-full">
                                                ({gov.meaning})
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Legacy case fallback for verbs */}
                        <div className="text-xl font-black text-white tracking-tight mt-4 flex items-center gap-3 bg-white/5 p-3 rounded-2xl border border-white/10">
                            <span>+ {word.preposition || ""}</span>
                            <span className={cn(
                                "px-2 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-tighter shadow-sm",
                                word.case === 'Akkusativ' ? "bg-red-600 text-white" :
                                    word.case === 'Dativ' ? "bg-emerald-600 text-white" :
                                        word.case === 'Nominativ' ? "bg-blue-600 text-white" :
                                            word.case === 'Genitiv' ? "bg-amber-600 text-white" :
                                                "bg-slate-700 text-white"
                            )}>
                                {word.case}
                                {(word.case === 'Akkusativ' || word.case === 'Dativ') && word.preposition && (
                                    <span className="ml-1 lowercase font-bold text-[9px] opacity-80 border-l border-white/30 pl-1">
                                        {word.case === 'Akkusativ' ? 'wohin?' : 'wo?'}
                                    </span>
                                )}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="h-[2px] w-12 bg-gradient-to-r from-transparent to-primary/40" />
                        <p className="text-muted-foreground text-sm font-medium">Выберите правильный вариант</p>
                        <div className="h-[2px] w-12 bg-gradient-to-l from-transparent to-primary/40" />
                    </div>

                    {/* Mnemonic for Leech words */}
                    {(item.mnemonic || ((item.consecutiveMistakes || 0) >= 3 && word.mnemonic)) && (
                        <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs italic text-amber-200/80 w-full max-w-sm text-center">
                            <span className="font-bold uppercase text-[9px] block mb-1 opacity-70 text-amber-400">💡 Мнемоника (ассоциация):</span>
                            &ldquo;{item.mnemonic || word.mnemonic}&rdquo;
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="flex flex-col gap-4 w-full">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {options.map((option, idx) => {
                        const isTarget = option === (direction === 0 ? word.russian : formatGermanWord(word));
                        const isSelected = selectedOption === option;

                        let variant: "outline" | "default" | "destructive" | "secondary" = "outline";
                        if (selectedOption) {
                            if (isTarget) variant = "default";
                            else if (isSelected) variant = "destructive";
                            else variant = "secondary";
                        }

                        return (
                            <Button
                                key={idx}
                                variant={variant}
                                className={cn(
                                    "h-20 text-lg font-bold rounded-2xl border-2 transition-all duration-300 relative overflow-hidden",
                                    !selectedOption && "hover:border-primary/50 hover:bg-primary/5 hover:scale-[1.02]",
                                    isTarget && selectedOption && "bg-green-600 border-green-500 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]",
                                    isSelected && !isTarget && "bg-red-600 border-red-500 text-white"
                                )}
                                onClick={() => handleSelect(option)}
                                disabled={!!selectedOption || showSuccess}
                            >
                                {option}
                                {isSelected && (isTarget ? <Check className="absolute right-4" /> : <X className="absolute right-4" />)}
                            </Button>
                        );
                    })}
                </div>

                {!selectedOption && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-green-400 hover:bg-white/5 opacity-50 hover:opacity-100 transition-all mx-auto"
                        onClick={onMarkAsKnown}
                    >
                        Знаю это слово отлично (пропустить)
                    </Button>
                )}
            </div>
        </motion.div>
    );
}
