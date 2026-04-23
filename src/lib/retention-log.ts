'use client';

/**
 * Per-word retention telemetry, stored entirely in localStorage.
 *
 * Every time `updateItemStatus` resolves an SRS result we append a compact
 * event here. Over the course of days of use this lets the learner see
 * *which* words they forget most often, at what interval words tend to
 * drop, and how their overall accuracy evolves — without any of the data
 * leaving the device and without requiring a backend migration.
 *
 * Design notes:
 *  - Bounded FIFO (5000 events ≈ thousands of sessions) to stay friendly
 *    with localStorage quotas (~5 MB in most browsers).
 *  - Shape is intentionally minimal and additive: consumers should treat
 *    unknown fields as ignorable so older logs keep working.
 *  - All timestamps are epoch ms in local time; aggregations round to UTC
 *    day for stability across timezone changes.
 */

export interface RetentionEvent {
    /** Stable word id (StudyQueueItem.id). */
    wordId: string;
    /** Human-readable German form, copied so the log survives word deletion. */
    german: string;
    russian: string;
    outcome: 'success' | 'fail';
    /** Epoch ms of when the answer was committed. */
    timestamp: number;
    /** SRS interval (days) *after* this event, for correlating failure-by-interval. */
    interval: number;
    easeFactor: number;
    consecutiveMistakes: number;
    /** Optional: which study phase produced the event. */
    phase?: 'recognition' | 'production' | 'narrative' | 'review';
}

const STORAGE_KEY = 'retention-log-v1';
const MAX_EVENTS = 5000;

function isClient(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function logRetentionEvent(event: RetentionEvent): void {
    if (!isClient()) return;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr: RetentionEvent[] = raw ? JSON.parse(raw) : [];
        arr.push(event);
        if (arr.length > MAX_EVENTS) {
            arr.splice(0, arr.length - MAX_EVENTS);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
        // localStorage may be full, disabled, or quota-exceeded. We never want
        // telemetry to break the learning flow, so we silently drop the event.
    }
}

export function getRetentionEvents(): RetentionEvent[] {
    if (!isClient()) return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as RetentionEvent[]) : [];
    } catch {
        return [];
    }
}

export function clearRetentionLog(): void {
    if (!isClient()) return;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // noop
    }
}

export interface RetentionStats {
    totalEvents: number;
    totalSuccess: number;
    totalFail: number;
    successRate: number;
    /** Descending: words with the most failures first. */
    worstWords: Array<{
        wordId: string;
        german: string;
        russian: string;
        fails: number;
        successes: number;
        lastSeen: number;
    }>;
    /** Per-day ISO date (UTC) → counts, sorted ascending by date. */
    byDay: Array<{
        day: string;
        success: number;
        fail: number;
    }>;
}

/**
 * Derive a compact stats snapshot for UI consumption. `daysBack` limits the
 * time window (default: 30). Pass 0 for all-time.
 */
export function computeRetentionStats(daysBack: number = 30): RetentionStats {
    const events = getRetentionEvents();
    const cutoff = daysBack > 0 ? Date.now() - daysBack * 24 * 60 * 60 * 1000 : 0;
    const recent = cutoff > 0 ? events.filter(e => e.timestamp >= cutoff) : events;

    let totalSuccess = 0;
    let totalFail = 0;
    const perWord = new Map<string, RetentionStats['worstWords'][number]>();
    const perDay = new Map<string, { success: number; fail: number }>();

    for (const e of recent) {
        if (e.outcome === 'success') totalSuccess++;
        else totalFail++;

        const current = perWord.get(e.wordId) || {
            wordId: e.wordId,
            german: e.german,
            russian: e.russian,
            fails: 0,
            successes: 0,
            lastSeen: 0,
        };
        if (e.outcome === 'success') current.successes++;
        else current.fails++;
        if (e.timestamp > current.lastSeen) current.lastSeen = e.timestamp;
        // Keep most recent labels in case a word was re-enriched.
        current.german = e.german;
        current.russian = e.russian;
        perWord.set(e.wordId, current);

        const day = new Date(e.timestamp).toISOString().slice(0, 10);
        const dayBucket = perDay.get(day) || { success: 0, fail: 0 };
        if (e.outcome === 'success') dayBucket.success++;
        else dayBucket.fail++;
        perDay.set(day, dayBucket);
    }

    const worstWords = Array.from(perWord.values())
        .filter(w => w.fails > 0)
        .sort((a, b) => b.fails - a.fails || b.lastSeen - a.lastSeen)
        .slice(0, 20);

    const byDay = Array.from(perDay.entries())
        .map(([day, v]) => ({ day, ...v }))
        .sort((a, b) => a.day.localeCompare(b.day));

    const total = totalSuccess + totalFail;
    return {
        totalEvents: total,
        totalSuccess,
        totalFail,
        successRate: total > 0 ? totalSuccess / total : 0,
        worstWords,
        byDay,
    };
}
