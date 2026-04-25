const MAX_MISTAKES_PER_TOPIC = 5;

export interface TopicMistake {
    question: string;
    correct: string;
    ts: number;
}

function key(topicId: string): string {
    return `topic-mistakes-${topicId}`;
}

export function getTopicMistakes(topicId: string): TopicMistake[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(key(topicId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((m): m is TopicMistake =>
                m && typeof m.question === 'string' && typeof m.correct === 'string'
            )
            .slice(-MAX_MISTAKES_PER_TOPIC);
    } catch (e) {
        console.error('Failed to read topic mistakes', e);
        return [];
    }
}

export function appendTopicMistake(topicId: string, question: string, correct: string): void {
    if (typeof window === 'undefined') return;
    if (!topicId || !question || !correct) return;
    try {
        const list = getTopicMistakes(topicId);
        // Dedupe by (question, correct) — push the latest version to the end.
        const filtered = list.filter(m => !(m.question === question && m.correct === correct));
        filtered.push({ question, correct, ts: Date.now() });
        const trimmed = filtered.slice(-MAX_MISTAKES_PER_TOPIC);
        window.localStorage.setItem(key(topicId), JSON.stringify(trimmed));
    } catch (e) {
        console.error('Failed to append topic mistake', e);
    }
}

export function clearTopicMistakes(topicId: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(key(topicId));
    } catch (e) {
        console.error('Failed to clear topic mistakes', e);
    }
}
