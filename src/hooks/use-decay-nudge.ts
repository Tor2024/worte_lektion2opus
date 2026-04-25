'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCurriculumData } from './use-curriculum-data';

export interface DecayedTopic {
    levelId: string;
    topicId: string;
    title: string;
    daysSinceReview: number;
    daysOverdue: number;
}

interface RepetitionEntry {
    nextReviewDate: string | null;
    lastReviewTime: number | null;
}

const DECAY_DAYS_THRESHOLD = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readRepetition(topicId: string): RepetitionEntry | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(`repetition-${topicId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            nextReviewDate: typeof parsed.nextReviewDate === 'string' ? parsed.nextReviewDate : null,
            lastReviewTime: typeof parsed.lastReviewTime === 'number' ? parsed.lastReviewTime : null,
        };
    } catch {
        return null;
    }
}

/**
 * Returns up to `limit` topics the learner completed at least once but hasn't
 * touched in ≥14 days (or whose SM2 review date is more than a week overdue).
 * Sorted by most decayed first.
 */
export function useDecayNudge(limit: number = 3) {
    const { allTopics, isLoading } = useCurriculumData();
    const [now, setNow] = useState<number | null>(null);

    useEffect(() => {
        // Avoid hydration mismatch — only run on the client after mount.
        setNow(Date.now());
    }, []);

    const decayed = useMemo<DecayedTopic[]>(() => {
        if (now === null || isLoading) return [];

        const out: DecayedTopic[] = [];
        for (const topic of allTopics) {
            const entry = readRepetition(topic.id);
            if (!entry || !entry.lastReviewTime) continue;
            const daysSinceReview = Math.floor((now - entry.lastReviewTime) / MS_PER_DAY);
            const nextDateMs = entry.nextReviewDate ? Date.parse(entry.nextReviewDate) : NaN;
            const daysOverdue = Number.isFinite(nextDateMs)
                ? Math.floor((now - nextDateMs) / MS_PER_DAY)
                : -1;

            // Surface if either: (a) >= 14 days since last review, OR
            // (b) SM2 schedule was missed by ≥ 7 days.
            if (daysSinceReview >= DECAY_DAYS_THRESHOLD || daysOverdue >= 7) {
                out.push({
                    levelId: topic.levelId,
                    topicId: topic.id,
                    title: topic.title,
                    daysSinceReview,
                    daysOverdue: Math.max(0, daysOverdue),
                });
            }
        }

        out.sort((a, b) => b.daysSinceReview - a.daysSinceReview);
        return out.slice(0, limit);
    }, [now, isLoading, allTopics, limit]);

    return {
        decayed,
        isLoading: isLoading || now === null,
    };
}
