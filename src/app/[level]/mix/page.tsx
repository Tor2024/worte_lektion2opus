'use client';

import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { useLevelData } from '@/hooks/use-curriculum-data';
import { LevelMixSession } from '@/components/level-mix-session';

export default function LevelMixPage() {
    const params = useParams<{ level: string }>();
    const levelId = params.level;

    const { level, topics, isLoading } = useLevelData(levelId);

    if (isLoading) {
        return (
            <div className="container mx-auto py-8 space-y-8 animate-pulse">
                <div className="h-8 bg-muted rounded w-1/4" />
                <div className="h-12 bg-muted rounded w-1/2" />
                <div className="h-64 bg-muted rounded" />
            </div>
        );
    }

    if (!level) {
        notFound();
    }

    return (
        <div className="container mx-auto py-8 max-w-3xl">
            <div className="mb-6">
                <Link href={`/${level.id}`} className="text-sm text-primary hover:underline">
                    &larr; Назад к уровню {level.title}
                </Link>
            </div>
            <LevelMixSession levelId={level.id} levelTitle={level.title} topics={topics || []} />
        </div>
    );
}
