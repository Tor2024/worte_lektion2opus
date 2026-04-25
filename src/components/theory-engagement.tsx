'use client';

import { useMemo } from 'react';
import { HelpCircle, BrainCircuit } from 'lucide-react';
import type { VocabularyWord } from '@/lib/types';
import { AiTheoryExpander } from './ai-theory-expander';
import { ClozeChallenge } from './cloze-challenge';

interface TheoryEngagementProps {
    title: string;
    initialHtml: string;
    words: VocabularyWord[];
    topicId: string;
}

/**
 * Wraps the theory block with a pre-reading "challenge" question and a post-
 * reading retrieval check. Both are cloze MCQs sourced from the topic's own
 * vocabulary; if there are no usable examples either card simply doesn't render.
 */
export function TheoryEngagement({ title, initialHtml, words, topicId }: TheoryEngagementProps) {
    // Split sources so pre- and post-questions try to pick different words when possible.
    const { preWords, postWords } = useMemo(() => {
        if (!words || words.length < 2) {
            return { preWords: words, postWords: words };
        }
        const half = Math.ceil(words.length / 2);
        return {
            preWords: words.slice(0, half),
            postWords: words.slice(half),
        };
    }, [words]);

    return (
        <div className="space-y-4">
            {words.length > 0 && (
                <ClozeChallenge
                    words={words}
                    sourceWords={preWords}
                    count={1}
                    title="Перед чтением: попробуйте угадать"
                    description="Этот микро-вопрос настроит внимание, даже если вы ответите неверно."
                    icon={
                        <div className="flex-shrink-0 rounded-full bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                            <HelpCircle className="h-4 w-4" />
                        </div>
                    }
                    accentClassName="border-amber-500/30 bg-amber-500/5"
                    seedKey={`pre-${topicId}`}
                    completeLabel="Читать теорию"
                />
            )}

            <AiTheoryExpander title={title} initialHtml={initialHtml} />

            {words.length > 0 && (
                <ClozeChallenge
                    words={words}
                    sourceWords={postWords}
                    count={2}
                    title="После чтения: быстрая проверка"
                    description="Активное вспоминание после теории закрепляет её в долговременной памяти."
                    icon={
                        <div className="flex-shrink-0 rounded-full bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
                            <BrainCircuit className="h-4 w-4" />
                        </div>
                    }
                    accentClassName="border-emerald-500/30 bg-emerald-500/5"
                    seedKey={`post-${topicId}`}
                    completeLabel="К практике"
                />
            )}
        </div>
    );
}
