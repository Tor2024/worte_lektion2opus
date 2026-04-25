'use client';

import { useState, useEffect, useCallback } from 'react';
import { Topic, INITIAL_SM2_STATE, SM2State } from '@/lib/types';
import { useUserProgress } from '@/hooks/use-user-progress';
import { GenerateLessonSummaryOutput } from '@/ai/flows/generate-lesson-summary';
import { ExerciseEngine, LessonScore } from './exercise-engine';
import { Timer } from './timer';
import { Button } from './ui/button';
import { Loader2, Brain, RefreshCw, SkipForward } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import Link from 'next/link';
import { useLevelData } from '@/hooks/use-curriculum-data';
import { updateSM2State } from '@/lib/sm2';
import { addTopicWordsToQueue } from '@/lib/course-bridge';

type RepetitionState = {
  nextReviewDate: string | null;
  lastReviewTime: number | null;
  sm2?: SM2State;
};

// Map exit-ticket score (correct/total) to SM2 quality (0..5).
// total === 0 means there was no cloze data — assume "good" (q=4).
function scoreToQuality(score?: LessonScore): number {
  if (!score || score.total === 0) return 4;
  const ratio = score.correct / score.total;
  if (ratio >= 1) return 5;
  if (ratio >= 2 / 3) return 4;
  if (ratio >= 1 / 3) return 2;
  return 1;
}

export function SpacedRepetitionWrapper({ topic }: { topic: Topic }) {
  const { setTopicProficiency } = useUserProgress(topic.id);
  const [repetitionState, setRepetitionState] = useState<RepetitionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReadyForReview, setIsReadyForReview] = useState(false);
  const [nextReviewDate, setNextReviewDate] = useState<Date | null>(null);
  const [lessonSummary, setLessonSummary] = useState<GenerateLessonSummaryOutput | null>(null);

  const { topics: currentLevelTopics } = useLevelData(topic.levelId || '');

  const getRepetitionState = useCallback((): RepetitionState => {
    try {
      if (typeof window === 'undefined') return { nextReviewDate: null, lastReviewTime: null };
      const item = window.localStorage.getItem(`repetition-${topic.id}`);
      return item ? JSON.parse(item) : { nextReviewDate: null, lastReviewTime: null };
    } catch (error) {
      console.error('Error reading repetition state from localStorage', error);
      return { nextReviewDate: null, lastReviewTime: null };
    }
  }, [topic.id]);

  useEffect(() => {
    const state = getRepetitionState();
    setRepetitionState(state);

    if (state.nextReviewDate) {
      const reviewDate = new Date(state.nextReviewDate);
      setNextReviewDate(reviewDate);
      setIsReadyForReview(new Date() >= reviewDate);
    } else {
      setIsReadyForReview(true);
    }

    setIsLoading(false);
  }, [getRepetitionState]);

  const onMastered = useCallback((summary?: GenerateLessonSummaryOutput, score?: LessonScore) => {
    if (summary) {
      setLessonSummary(summary);
    }

    const previous = (repetitionState?.sm2 ?? INITIAL_SM2_STATE);
    const quality = scoreToQuality(score);
    const nextSm2 = updateSM2State(quality, previous);
    const nextDate = nextSm2.nextReviewDate ? new Date(nextSm2.nextReviewDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newState: RepetitionState = {
      nextReviewDate: nextDate.toISOString(),
      lastReviewTime: Date.now(),
      sm2: nextSm2,
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`repetition-${topic.id}`, JSON.stringify(newState));
    }
    setRepetitionState(newState);
    setNextReviewDate(nextDate);
    setIsReadyForReview(false);

    // Bridge: feed topic vocabulary into the global SRS study queue so daily
    // sessions keep the words alive instead of relying on the topic-only timer.
    try {
      const topicWords = topic.vocabulary.flatMap(v => v.words);
      addTopicWordsToQueue(topic.levelId, topic.title, topicWords);
    } catch (e) {
      console.error('Failed to bridge topic words to study queue:', e);
    }
  }, [topic.id, topic.levelId, topic.title, topic.vocabulary, repetitionState]);

  const handleReset = () => {
    setIsLoading(true);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(`repetition-${topic.id}`);
    }
    setTopicProficiency(0, topic.id);
    const state = getRepetitionState();
    setRepetitionState(state);
    setNextReviewDate(null);
    setIsReadyForReview(true);
    setIsLoading(false);
  };

  const handleReviewNow = () => {
    setIsReadyForReview(true);
  }

  const getNextTopic = () => {
    if (!currentLevelTopics) return null;

    const sortedTopics = [...currentLevelTopics].sort((a, b) => (1));

    const currentTopicIndex = sortedTopics.findIndex(t => t.id === topic.id);

    if (currentTopicIndex > -1 && currentTopicIndex < sortedTopics.length - 1) {
      const nextTopic = sortedTopics[currentTopicIndex + 1];
      return `/${topic.levelId}/${nextTopic.id}`;
    }
    return null;
  }

  const nextTopicUrl = getNextTopic();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isReadyForReview && nextReviewDate) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Brain className="mx-auto h-16 w-16 text-primary bg-primary/10 rounded-full p-3 mb-4" />
          <h3 className="text-2xl font-bold text-foreground font-headline">Отличная работа!</h3>
          <p className="mt-2 text-muted-foreground mb-6">Чтобы знания лучше усвоились, мозгу нужен отдых. <br />Возвращайтесь к этой теме позже для закрепления.</p>

          <div className="flex justify-center my-8">
            <Timer targetDate={nextReviewDate} />
          </div>

          {lessonSummary && (
            <div className="max-w-2xl mx-auto mb-10 text-left space-y-6 animate-in slide-in-from-bottom-4 duration-500">
              <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <Brain className="h-12 w-12" />
                </div>
                <h4 className="text-xl font-bold font-headline mb-3 text-primary">Анализ вашей тренировки</h4>
                <div className="prose prose-sm dark:prose-invert" dangerouslySetInnerHTML={{ __html: lessonSummary.analysis }} />
              </div>

              <div className="bg-muted/50 border rounded-2xl p-6">
                <h4 className="text-xl font-bold font-headline mb-3">Рекомендации ИИ</h4>
                <div className="prose prose-sm dark:prose-invert" dangerouslySetInnerHTML={{ __html: lessonSummary.recommendations }} />
                {lessonSummary.shouldRepeat && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                    💡 ИИ рекомендует пройти эту тему еще раз для лучшего закрепления.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-4 justify-center">
            <Button onClick={handleReviewNow} variant="default">Все равно повторить</Button>
            {nextTopicUrl && (
              <Button asChild variant="secondary">
                <Link href={nextTopicUrl}>
                  Следующая тема <SkipForward className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
            <Button onClick={handleReset} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Начать заново
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <ExerciseEngine topic={topic} onMastered={onMastered} />;
}
