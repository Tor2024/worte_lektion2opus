
'use client';

// import { curriculum } from '@/lib/data'; // NO LONGER USED
import { notFound, useParams } from 'next/navigation';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { ArrowRight, BookText, CheckCircle2, Shuffle } from 'lucide-react';
import Link from 'next/link';
import { useUserProgress } from '@/hooks/use-user-progress';
import { cn } from '@/lib/utils';
import { useLevelData } from '@/hooks/use-curriculum-data';
import { useMemo } from 'react';

export default function LevelPage() {
  const params = useParams<{ level: string }>();
  const levelId = params.level;

  const { level, topics, isLoading } = useLevelData(levelId);
  const { getTopicProficiency } = useUserProgress();

  const eligibleForMix = useMemo(
    () => (topics || []).some(t => getTopicProficiency(t.id) >= 60),
    [topics, getTopicProficiency]
  );

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-8 animate-pulse">
        <div className="h-8 bg-muted rounded w-1/4"></div>
        <div className="h-12 bg-muted rounded w-1/2"></div>
        <div className="space-y-4">
          <div className="h-16 bg-muted rounded"></div>
          <div className="h-16 bg-muted rounded"></div>
          <div className="h-16 bg-muted rounded"></div>
        </div>
      </div>
    )
  }

  if (!level) {
    notFound();
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <Link href="/" className="text-sm text-primary hover:underline">
          &larr; Назад ко всем уровням
        </Link>
        <h1 className="mt-2 text-4xl font-bold font-headline">{level.title}</h1>
        <p className="mt-2 text-lg text-muted-foreground">{level.description}</p>
      </div>

      {eligibleForMix && (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/15 p-2 text-primary">
              <Shuffle className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">Микс уровня — слова из всех пройденных тем вперемешку</p>
              <p className="text-sm text-muted-foreground">5 минут, 10 вопросов. Лучшее, что есть для долгой памяти.</p>
            </div>
          </div>
          <Button asChild>
            <Link href={`/${level.id}/mix`}>
              Запустить микс <Shuffle className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}

      {topics && topics.length > 0 ? (
        <Accordion type="single" collapsible className="w-full">
          {topics.map((topic) => {
            const proficiency = getTopicProficiency(topic.id);
            const isCompleted = proficiency >= 100;
            return (
              <AccordionItem value={topic.id} key={topic.id}>
                <AccordionTrigger className={cn("text-lg font-semibold hover:no-underline", isCompleted && "text-green-600 dark:text-green-400")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("rounded-md p-2", isCompleted ? "bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400" : "bg-primary/10 text-primary")}>
                      {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <BookText className="h-5 w-5" />}
                    </div>
                    {topic.title}
                    {isCompleted && (
                      <span className="ml-2 text-xs font-bold uppercase tracking-widest bg-green-100 text-green-700 px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">
                        Пройдено
                      </span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="prose prose-blue max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: topic.explanation.substring(0, 150) + '...' }} />
                  <Button asChild className="mt-4">
                    <Link href={`/${level.id}/${topic.id}`}>
                      {isCompleted ? 'Повторить тему' : 'Перейти к теме'} <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-12 text-center">
          <h2 className="text-xl font-semibold text-muted-foreground">Темы в разработке</h2>
          <p className="mt-2 text-sm text-muted-foreground">Содержание для этого уровня скоро появится. Следите за обновлениями!</p>
        </div>
      )}
    </div>
  );
}
