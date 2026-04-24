'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Brain, Calendar, Flame, Trash2 } from 'lucide-react';
import {
    clearRetentionLog,
    computeRetentionStats,
    getRetentionEvents,
    type RetentionStats,
} from '@/lib/retention-log';

/**
 * Local-only retention dashboard. Reads events that `use-study-queue` has
 * written during study sessions and surfaces the two things the learner
 * actually needs to see:
 *   1. Which specific words are being forgotten the most.
 *   2. How accuracy has trended day by day.
 * No network calls, no user account — everything is in localStorage.
 */
export default function StatsPage() {
    // We gate on a client-only render so the initial SSR snapshot doesn't
    // diverge from the hydrated one (localStorage is unavailable server-side).
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const [windowDays, setWindowDays] = useState<0 | 7 | 30 | 90>(30);
    const [nonce, setNonce] = useState(0);

    const stats: RetentionStats = useMemo(
        () => computeRetentionStats(windowDays),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [windowDays, mounted, nonce],
    );

    const rawEventCount = useMemo(() => (mounted ? getRetentionEvents().length : 0), [mounted, nonce]);

    if (!mounted) {
        return (
            <div className="container mx-auto max-w-4xl px-4 py-12">
                <p className="text-muted-foreground">Загрузка статистики…</p>
            </div>
        );
    }

    const empty = stats.totalEvents === 0;

    return (
        <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Link href="/">
                        <Button variant="ghost" size="icon" aria-label="Назад">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Brain className="h-6 w-6 text-primary" /> Статистика ретеншена
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Всё локально, ничего не уходит с устройства.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                {[
                    { v: 7, label: '7 дней' },
                    { v: 30, label: '30 дней' },
                    { v: 90, label: '90 дней' },
                    { v: 0, label: 'Всё время' },
                ].map(o => (
                    <Button
                        key={o.v}
                        size="sm"
                        variant={windowDays === o.v ? 'default' : 'outline'}
                        onClick={() => setWindowDays(o.v as 0 | 7 | 30 | 90)}
                    >
                        {o.label}
                    </Button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        Всего событий: {rawEventCount}
                    </span>
                    {rawEventCount > 0 && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                if (window.confirm('Удалить весь локальный лог повторений? Действие нельзя отменить.')) {
                                    clearRetentionLog();
                                    setNonce(n => n + 1);
                                }
                            }}
                        >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Очистить
                        </Button>
                    )}
                </div>
            </div>

            {empty ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Пока нет данных</CardTitle>
                        <CardDescription>
                            Пройдите одну-две сессии — здесь появится точный список слов, которые вы
                            реально забываете, и динамика по дням.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard label="Ответов" value={stats.totalEvents} />
                        <StatCard label="Верно" value={stats.totalSuccess} tone="success" />
                        <StatCard label="Ошибок" value={stats.totalFail} tone="fail" />
                        <StatCard
                            label="Точность"
                            value={`${Math.round(stats.successRate * 100)}%`}
                            tone={stats.successRate >= 0.8 ? 'success' : stats.successRate >= 0.6 ? 'warn' : 'fail'}
                        />
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Flame className="h-5 w-5 text-amber-500" /> Что забывается чаще всего
                            </CardTitle>
                            <CardDescription>
                                Отсортировано по количеству ошибок за выбранный период. Повторите эти слова
                                вручную или через Review.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {stats.worstWords.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    За этот период не зафиксировано ни одной ошибки. Отлично.
                                </p>
                            ) : (
                                stats.worstWords.map(w => {
                                    const total = w.fails + w.successes;
                                    const failRate = total > 0 ? w.fails / total : 0;
                                    return (
                                        <div
                                            key={w.wordId}
                                            className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/40"
                                        >
                                            <div className="min-w-0">
                                                <div className="font-semibold truncate">{w.german}</div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {w.russian}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900">
                                                    {w.fails} ошиб.
                                                </Badge>
                                                <Badge variant="outline" className="text-muted-foreground">
                                                    {Math.round(failRate * 100)}%
                                                </Badge>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-blue-500" /> Динамика по дням
                            </CardTitle>
                            <CardDescription>
                                Зелёное — верно, красное — ошибки. Высота столбца пропорциональна числу
                                ответов за день.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DailyChart data={stats.byDay} />
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}

function StatCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: string | number;
    tone?: 'success' | 'fail' | 'warn';
}) {
    const color =
        tone === 'success'
            ? 'text-green-600 dark:text-green-400'
            : tone === 'fail'
                ? 'text-red-600 dark:text-red-400'
                : tone === 'warn'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-foreground';
    return (
        <Card>
            <CardContent className="py-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
            </CardContent>
        </Card>
    );
}

function DailyChart({ data }: { data: Array<{ day: string; success: number; fail: number }> }) {
    if (data.length === 0) {
        return <p className="text-sm text-muted-foreground">Нет данных за период.</p>;
    }
    const max = Math.max(1, ...data.map(d => d.success + d.fail));
    return (
        <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {data.map(d => {
                const total = d.success + d.fail;
                const heightPct = (total / max) * 100;
                const successPct = total > 0 ? (d.success / total) * 100 : 0;
                return (
                    <div
                        key={d.day}
                        className="flex flex-col items-center gap-1 shrink-0 min-w-[18px]"
                        title={`${d.day}: ${d.success} верно / ${d.fail} ошибок`}
                    >
                        <div
                            className="w-4 rounded-t overflow-hidden flex flex-col-reverse bg-red-300/60 dark:bg-red-900/60 border border-border"
                            style={{ height: `${Math.max(4, heightPct)}%` }}
                        >
                            <div
                                className="w-full bg-green-500 dark:bg-green-600"
                                style={{ height: `${successPct}%` }}
                            />
                        </div>
                        <div className="text-[9px] text-muted-foreground rotate-45 origin-left whitespace-nowrap">
                            {d.day.slice(5)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
