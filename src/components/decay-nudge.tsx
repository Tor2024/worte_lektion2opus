'use client';

import Link from 'next/link';
import { Clock, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { useDecayNudge } from '@/hooks/use-decay-nudge';

function formatDays(days: number): string {
    if (days <= 1) return '1 день';
    if (days < 5) return `${days} дня`;
    return `${days} дней`;
}

export function DecayNudge() {
    const { decayed, isLoading } = useDecayNudge(3);

    if (isLoading || decayed.length === 0) return null;

    return (
        <Card className="mb-12 border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent shadow-md">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                    <div className="rounded-full bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
                        <Clock className="h-5 w-5" />
                    </div>
                    <div>
                        <CardTitle className="text-xl font-bold font-headline">
                            {decayed.length === 1 ? 'Тема скучает' : `${decayed.length} темы скучают`}
                        </CardTitle>
                        <CardDescription>
                            Несколько минут на повторение — и интервал перезапустится с большой паузой.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2">
                    {decayed.map(t => (
                        <li
                            key={`${t.levelId}-${t.topicId}`}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-background/60 p-3"
                        >
                            <div className="min-w-0">
                                <p className="font-semibold truncate">
                                    <span className="text-xs uppercase tracking-widest text-muted-foreground mr-2">{t.levelId}</span>
                                    {t.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {formatDays(t.daysSinceReview)} без повторения
                                    {t.daysOverdue > 0 ? ` · просрочено на ${formatDays(t.daysOverdue)}` : ''}
                                </p>
                            </div>
                            <Button asChild size="sm" variant="outline">
                                <Link href={`/${t.levelId}/${t.topicId}`}>
                                    Повторить <ArrowRight className="ml-2 h-4 w-4" />
                                </Link>
                            </Button>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
