'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { VocabularyWord } from '@/lib/types';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { CheckCircle, XCircle, Target } from 'lucide-react';
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

interface ExitTicketProps {
    words: VocabularyWord[];
    onDone: (correct: number, total: number) => void;
}

export function ExitTicket({ words, onDone }: ExitTicketProps) {
    const questions = useMemo<Question[]>(() => {
        const candidates = words
            .map(w => {
                const ex = (w as { example?: string }).example;
                if (!ex || typeof ex !== 'string') return null;
                const blanked = makeBlanked(ex, w.german);
                return blanked ? { word: w, blanked } : null;
            })
            .filter((x): x is { word: VocabularyWord; blanked: string } => x !== null);

        const picked = shuffle(candidates).slice(0, 3);
        return picked.map(({ word, blanked }) => {
            const distractorPool = words.filter(w => w.german !== word.german);
            const distractors = shuffle(distractorPool).slice(0, 3).map(w => w.german);
            return {
                word,
                blanked,
                options: shuffle([word.german, ...distractors]),
            };
        });
    }, [words]);

    const [idx, setIdx] = useState(0);
    const [correct, setCorrect] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const calledRef = useRef(false);

    useEffect(() => {
        if (questions.length === 0 && !calledRef.current) {
            calledRef.current = true;
            // No suitable cloze candidates — pass through with a default "good" score.
            onDone(0, 0);
        }
    }, [questions.length, onDone]);

    if (questions.length === 0) return null;

    const q = questions[idx];

    const handlePick = (opt: string) => {
        if (revealed) return;
        setPicked(opt);
        setRevealed(true);
        if (opt === q.word.german) setCorrect(c => c + 1);
    };

    const handleNext = () => {
        if (idx + 1 < questions.length) {
            setIdx(i => i + 1);
            setPicked(null);
            setRevealed(false);
        } else {
            onDone(correct + (picked === q.word.german && idx + 1 === questions.length ? 0 : 0), questions.length);
        }
    };

    return (
        <Card className="border-primary/30 shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3 text-primary">
                        <Target className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold font-headline">Финальная проверка</h3>
                        <CardDescription>
                            Подставьте пропущенное слово ({idx + 1}/{questions.length})
                        </CardDescription>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-xl mb-6 leading-relaxed">{q.blanked}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {q.options.map(opt => {
                        const isCorrect = opt === q.word.german;
                        const isPicked = opt === picked;
                        return (
                            <Button
                                key={opt}
                                variant="outline"
                                onClick={() => handlePick(opt)}
                                disabled={revealed}
                                className={cn(
                                    'h-auto py-4 text-base font-medium justify-start',
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
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 p-3 rounded-lg bg-muted/40">
                        <div className={cn('flex items-center gap-2', picked === q.word.german ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            {picked === q.word.german ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                            <span className="font-semibold">
                                {picked === q.word.german ? 'Верно!' : `Правильно: ${q.word.german}`}
                            </span>
                        </div>
                        <Button onClick={handleNext}>
                            {idx + 1 < questions.length ? 'Дальше' : 'Завершить'}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
