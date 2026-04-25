
'use client';

// import { curriculum } from '@/lib/data'; // NO LONGER USED
import { notFound, useParams } from 'next/navigation';
import Link from 'next/link';
import { Book, Sparkles, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SpacedRepetitionWrapper } from '@/components/spaced-repetition-wrapper';
import { useTopicData } from '@/hooks/use-curriculum-data';
import { TopicVocabulary } from '@/components/topic-vocabulary';
import { TheoryEngagement } from '@/components/theory-engagement';

export default function TopicPage() {
  const params = useParams<{ level: string; topic: string }>();
  const levelId = params.level;
  const topicId = params.topic;

  const { level, topic, isLoading } = useTopicData(levelId, topicId);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl py-8 space-y-8 animate-pulse">
        <div className="h-8 bg-muted rounded w-1/4"></div>
        <div className="h-12 bg-muted rounded w-1/2"></div>
        <div className="h-64 bg-muted rounded"></div>
      </div>
    );
  }

  if (!level || !topic) {
    notFound();
  }

  // Topic vocabulary in DB schema is an array of themes, just like before.
  // But type safety might be tricky if schema says 'v.any()'. 
  // Let's assume it matches the structure.

  // flattened words for the vocabulary component
  const allWords = (topic.vocabulary as any[]).flatMap(v => v.words);


  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-8">
        <Link href={`/${level.id}`} className="text-sm text-primary hover:underline">
          &larr; Назад к темам уровня {level.title}
        </Link>
        <h1 className="mt-2 text-4xl font-bold font-headline">{topic.title}</h1>
      </div>

      <div className="space-y-12">
        {/* Vocabulary Section */}
        {allWords.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="flex-shrink-0 rounded-full bg-primary/10 p-3 text-primary">
                  <Star className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold font-headline">1. Словарь темы</h2>
                  <p className="text-sm font-normal text-muted-foreground">Изучите новые слова перед началом</p>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TopicVocabulary words={allWords} topicTitle={topic.title} />
            </CardContent>
          </Card>
        )}


        {/* Theory Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 rounded-full bg-primary/10 p-3 text-primary">
                <Book className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold font-headline">2. Теория и правила</h2>
                <p className="text-sm font-normal text-muted-foreground">Поймите, как использовать слова и грамматику</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TheoryEngagement
              title={topic.title}
              initialHtml={topic.explanation}
              words={allWords}
              topicId={topic.id}
            />
          </CardContent>
        </Card>

        <Separator />

        {/* Practice Section */}
        <Card className="bg-gradient-to-br from-card to-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <div className="flex-shrink-0 rounded-full bg-primary/10 p-3 text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold font-headline">3. Интерактивная тренировка</h2>
                <p className="text-sm font-normal text-muted-foreground">Закрепите знания с помощью ИИ-тренера</p>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* SpacedRepetitionWrapper expects a 'topic' object. The DB object should be compatible if it has 'id', 'vocabulary' etc. */}
            {/* We might need to cast if types don't align perfectly, but let's try. */}
            <SpacedRepetitionWrapper topic={topic as any} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
