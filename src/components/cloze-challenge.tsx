'use client';

import { useState, useMemo, useEffect } from 'react';
import type { VocabularyWord } from '@/lib/types';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { CheckCircle, XCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type Question = {
    word: VocabularyWord;
    blanked: string;
    options: string[];
};

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeBlanked(example: string, target: string): string | null {
    const re = new RegExp(`\\b${escapeRegex(target)}\\b`, 'i');
    if (!re.test(example)) return null;
    return example.replace(re, '______');
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

interface ClozeChallengeProps {
    words: VocabularyWord[];
    count: number;
    title: string;
    description?: string;
    icon?: React.ReactNode;
    accentClassName?: string;
    /** Restricts which words can become questions. Distractors still come from `words`. */
    sourceWords?: VocabularyWord[];
    /** Stable hint so we don't re-shuffle on unrelated re-renders. */
    seedKey?: string;
    onComplete?: (correct: number, total: number) => void;
    completeLabel?: string;
}

/**
 * Reusable cloze MCQ card. Picks `count` unique words that appear in their own
 * example sentence, blanks them, and asks the user to choose the right one
 * from 4 options. Renders nothing if the source has no usable example sentences.
 */
export function ClozeChallenge({
    words,
    count,
    title,
    description,
    icon,
    accentClassName,
    sourceWords,
    seedKey,
    onComplete,
    completeLabel,
}: ClozeChallengeProps) {
    const [seed, setSeed] = useState(0);

    const questions = useMemo<Question[]>(() => {
        // Force memo recomputation when seedKey or seed changes.
        void seed;
        void seedKey;

        const candidatesPool = (sourceWords ?? words)
            .map(w => {
                const ex = (w as { example?: string }).example;
                if (!ex || typeof ex !== 'string') return null;
                const blanked = makeBlanked(ex, w.german);
                return blanked ? { word: w, blanked } : null;
            })
            .filter((x): x is { word: VocabularyWord; blanked: string } => x !== null);

        if (candidatesPool.length === 0) return [];

        const picked = shuffle(candidatesPool).slice(0, Math.max(1, count));
        return picked.map(({ word, blanked }) => {
            const distractorPool = words.filter(w => w.german !== word.german);
            const distractors = shuffle(distractorPool).slice(0, 3).map(w => w.german);
            return {
                word,
                blanked,
                options: shuffle([word.german, ...distractors]),
            };
        });
    }, [words, sourceWords, count, seed, seedKey]);

    const [idx, setIdx] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [done, setDone] = useState(false);

    useEffect(() => {
        setIdx(0);
        setPicked(null);
        setRevealed(false);
        setCorrectCount(0);
        setDone(false);
    }, [seed, seedKey, count]);

    if (questions.length === 0) {
        return null;
    }

    if (done) {
        const total = questions.length;
        return (
            <Card className={cn('border-primary/20', accentClassName)}>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-3 text-lg">
                        {icon}
                        {title} — {correctCount}/{total}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSeed(s => s + 1)}
                    >
                        <RefreshCw className="mr-2 h-3 w-3" />
                        Ещё раз
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const q = questions[idx];

    const handlePick = (opt: string) => {
        if (revealed) return;
        const isCorrect = opt === q.word.german;
        setPicked(opt);
        setRevealed(true);
        if (isCorrect) setCorrectCount(c => c + 1);
    };

    const handleNext = () => {
        if (idx + 1 < questions.length) {
            setIdx(i => i + 1);
            setPicked(null);
            setRevealed(false);
        } else {
            setDone(true);
            onComplete?.(correctCount + (picked === q.word.german ? 0 : 0), questions.length);
            // (correctCount already includes this last pick from handlePick)
        }
    };

    return (
        <Card className={cn('border-primary/20 shadow-sm', accentClassName)}>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                    {icon}
                    <div>
                        <span className="font-headline">{title}</span>
                        {description && (
                            <CardDescription className="font-normal mt-0.5">{description}</CardDescription>
                        )}
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    {idx + 1} / {questions.length}
                </div>
                <p className="text-base leading-relaxed mb-4">{q.blanked}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map(opt => {
                        const isCorrect = opt === q.word.german;
                        const isPicked = opt === picked;
                        return (
                            <Button
                                key={opt}
                                variant="outline"
                                size="sm"
                                onClick={() => handlePick(opt)}
                                disabled={revealed}
                                className={cn(
                                    'justify-start',
                                    revealed && isCorrect && 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400',
                                    revealed && isPicked && !isCorrect && 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
                                )}
                            >
                                {opt}
                            </Button>
                        );
                    })}
                </div>
                {revealed && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mt-3 p-2 rounded-md bg-muted/40">
                        <div className={cn('flex items-center gap-2 text-sm', picked === q.word.german ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            {picked === q.word.german ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            <span className="font-semibold">
                                {picked === q.word.german ? 'Верно!' : `Правильно: ${q.word.german}`}
                            </span>
                        </div>
                        <Button size="sm" onClick={handleNext}>
                            {idx + 1 < questions.length ? (
                                <>Дальше <ArrowRight className="ml-2 h-3 w-3" /></>
                            ) : (
                                completeLabel || 'Готово'
                            )}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
