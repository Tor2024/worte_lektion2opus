'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Topic, VocabularyWord } from '@/lib/types';
import { useUserProgress } from '@/hooks/use-user-progress';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from './ui/card';
import { Progress } from './ui/progress';
import { Shuffle, CheckCircle, XCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_QUESTIONS = 10;
const MIN_TOPIC_PROFICIENCY = 60;

type Question = {
    word: VocabularyWord;
    sourceTopicTitle: string;
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

interface LevelMixSessionProps {
    levelId: string;
    levelTitle: string;
    topics: Topic[];
}

export function LevelMixSession({ levelId, levelTitle, topics }: LevelMixSessionProps) {
    const { getTopicProficiency } = useUserProgress();
    const [seed, setSeed] = useState(0);

    // Pool of eligible (topic, word) candidates with examples.
    const eligibleTopics = useMemo(() => {
        return topics.filter(t => getTopicProficiency(t.id) >= MIN_TOPIC_PROFICIENCY);
    }, [topics, getTopicProficiency]);

    const allCandidates = useMemo(() => {
        const out: { word: VocabularyWord; topicTitle: string; blanked: string }[] = [];
        for (const t of eligibleTopics) {
            for (const block of t.vocabulary || []) {
                for (const w of block.words || []) {
                    const ex = (w as { example?: string }).example;
                    if (!ex || typeof ex !== 'string') continue;
                    const blanked = makeBlanked(ex, w.german);
                    if (!blanked) continue;
                    out.push({ word: w, topicTitle: t.title, blanked });
                }
            }
        }
        return out;
    }, [eligibleTopics]);

    const allDistractors = useMemo(() => {
        const set = new Set<string>();
        for (const t of topics) {
            for (const block of t.vocabulary || []) {
                for (const w of block.words || []) {
                    if (w?.german) set.add(w.german);
                }
            }
        }
        return Array.from(set);
    }, [topics]);

    const questions = useMemo<Question[]>(() => {
        // seed dependency forces re-shuffle on "Заново"
        void seed;
        if (allCandidates.length === 0) return [];
        const picked = shuffle(allCandidates).slice(0, MAX_QUESTIONS);
        return picked.map(({ word, blanked, topicTitle }) => {
            const distractorPool = allDistractors.filter(d => d !== word.german);
            const distractors = shuffle(distractorPool).slice(0, 3);
            return {
                word,
                sourceTopicTitle: topicTitle,
                blanked,
                options: shuffle([word.german, ...distractors]),
            };
        });
    }, [allCandidates, allDistractors, seed]);

    const [idx, setIdx] = useState(0);
    const [picked, setPicked] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [perTopic, setPerTopic] = useState<Record<string, { correct: number; total: number }>>({});
    const [done, setDone] = useState(false);
    const startedRef = useRef(false);

    useEffect(() => {
        startedRef.current = false;
        setIdx(0);
        setPicked(null);
        setRevealed(false);
        setCorrectCount(0);
        setPerTopic({});
        setDone(false);
    }, [seed]);

    if (eligibleTopics.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        <Shuffle className="h-6 w-6 text-primary" />
                        Микс уровня {levelTitle}
                    </CardTitle>
                    <CardDescription>
                        Чтобы микс заработал, пройдите хотя бы одну тему уровня (proficiency ≥ {MIN_TOPIC_PROFICIENCY}%).
                    </CardDescription>
                </CardHeader>
                <CardFooter>
                    <Button asChild variant="default">
                        <Link href={`/${levelId}`}>Назад к уровню</Link>
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    if (questions.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Микс уровня {levelTitle}</CardTitle>
                    <CardDescription>
                        В пройденных темах не нашлось примеров для cloze-вопросов. Зайдите снова после прохождения большего числа тем.
                    </CardDescription>
                </CardHeader>
                <CardFooter>
                    <Button asChild variant="default">
                        <Link href={`/${levelId}`}>Назад к уровню</Link>
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    if (done) {
        const total = questions.length;
        const ratio = correctCount / total;
        const headline = ratio >= 0.8 ? 'Отлично!' : ratio >= 0.5 ? 'Хорошо, но есть что добить.' : 'Стоит вернуться к темам.';
        return (
            <Card className="border-primary/20">
                <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                        <Shuffle className="h-6 w-6 text-primary" />
                        Готово! {headline}
                    </CardTitle>
                    <CardDescription>
                        Результат: {correctCount} из {total} ({Math.round(ratio * 100)}%)
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Progress value={ratio * 100} className="h-3 mb-6" />
                    <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-2">По темам</h4>
                    <ul className="space-y-2">
                        {Object.entries(perTopic).map(([title, s]) => (
                            <li key={title} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                                <span className="text-sm">{title}</span>
                                <span className={cn(
                                    'text-sm font-semibold',
                                    s.correct === s.total ? 'text-green-600 dark:text-green-400' : s.correct === 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                                )}>
                                    {s.correct}/{s.total}
                                </span>
                            </li>
                        ))}
                    </ul>
                </CardContent>
                <CardFooter className="gap-3">
                    <Button onClick={() => setSeed(s => s + 1)} variant="default">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Ещё раз
                    </Button>
                    <Button asChild variant="outline">
                        <Link href={`/${levelId}`}>Назад к уровню</Link>
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    const q = questions[idx];

    const handlePick = (opt: string) => {
        if (revealed) return;
        const isCorrect = opt === q.word.german;
        setPicked(opt);
        setRevealed(true);
        setCorrectCount(c => c + (isCorrect ? 1 : 0));
        setPerTopic(prev => {
            const cur = prev[q.sourceTopicTitle] || { correct: 0, total: 0 };
            return {
                ...prev,
                [q.sourceTopicTitle]: {
                    correct: cur.correct + (isCorrect ? 1 : 0),
                    total: cur.total + 1,
                },
            };
        });
    };

    const handleNext = () => {
        if (idx + 1 < questions.length) {
            setIdx(i => i + 1);
            setPicked(null);
            setRevealed(false);
        } else {
            setDone(true);
        }
    };

    const progressPct = Math.round((idx / questions.length) * 100);

    return (
        <Card className="border-primary/20 shadow-md">
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3 text-primary">
                        <Shuffle className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold font-headline">Микс уровня {levelTitle}</h3>
                        <CardDescription>
                            Слова из разных тем вперемешку — лучшее, что есть для долгой памяти.
                        </CardDescription>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-between mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    <span>{idx + 1} / {questions.length}</span>
                    <span>{q.sourceTopicTitle}</span>
                </div>
                <Progress value={progressPct} className="h-2 mb-6" />

                <p className="text-xl leading-relaxed mb-6">{q.blanked}</p>

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
                            {idx + 1 < questions.length ? (
                                <>Дальше <ArrowRight className="ml-2 h-4 w-4" /></>
                            ) : (
                                <>Завершить</>
                            )}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
