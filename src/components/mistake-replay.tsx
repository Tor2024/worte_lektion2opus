'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { History, ArrowRight, SkipForward } from 'lucide-react';
import type { TopicMistake } from '@/lib/topic-mistakes';

interface MistakeReplayProps {
    mistakes: TopicMistake[];
    onDone: () => void;
}

export function MistakeReplay({ mistakes, onDone }: MistakeReplayProps) {
    const [idx, setIdx] = useState(0);
    const [revealed, setRevealed] = useState(false);

    if (!mistakes || mistakes.length === 0) {
        return null;
    }

    const m = mistakes[idx];

    const handleNext = () => {
        if (idx + 1 < mistakes.length) {
            setIdx(i => i + 1);
            setRevealed(false);
        } else {
            onDone();
        }
    };

    return (
        <Card className="border-amber-500/30 shadow-md">
            <CardHeader>
                <CardTitle className="flex items-center gap-3">
                    <div className="rounded-full bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
                        <History className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold font-headline">Повторим прошлые ошибки</h3>
                        <CardDescription>
                            Вспомним то, что не получилось в прошлый раз ({idx + 1}/{mistakes.length})
                        </CardDescription>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="rounded-lg border bg-muted/30 p-4 mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Вопрос
                    </p>
                    <p className="text-lg leading-relaxed">{m.question}</p>
                </div>

                {revealed ? (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-2">
                            Правильный ответ
                        </p>
                        <p className="text-lg font-semibold text-green-700 dark:text-green-300">{m.correct}</p>
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed bg-muted/10 p-4 mb-4">
                        <p className="text-sm text-muted-foreground italic">
                            Попробуйте вспомнить ответ, прежде чем смотреть.
                        </p>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 justify-between">
                    {!revealed ? (
                        <Button onClick={() => setRevealed(true)} className="w-full sm:w-auto">
                            Показать ответ
                        </Button>
                    ) : (
                        <Button onClick={handleNext} className="w-full sm:w-auto">
                            {idx + 1 < mistakes.length ? (
                                <>Следующая <ArrowRight className="ml-2 h-4 w-4" /></>
                            ) : (
                                <>К новым упражнениям <ArrowRight className="ml-2 h-4 w-4" /></>
                            )}
                        </Button>
                    )}
                    <Button variant="ghost" onClick={onDone} className="w-full sm:w-auto text-muted-foreground">
                        <SkipForward className="mr-2 h-4 w-4" />
                        Пропустить повтор
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
