
'use client';

//  // NO LONGER USED
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, ArrowRight, BrainCircuit, Siren, GraduationCap, CheckCircle, PenLine, Zap } from 'lucide-react';
import Image from 'next/image';
import {
  getLevelImage,
} from '@/lib/placeholder-images';
import { useUserProgress } from '@/hooks/use-user-progress';
import { useEffect, useState } from 'react';
import { ProgressCircle } from '@/components/progress-circle';
import { GlobalVocabularyTrainer } from '@/components/global-vocabulary-trainer';
import type { VocabularyWord } from '@/lib/types';
import { commonWords } from '@/lib/common-words';
import { useStudyQueue } from '@/hooks/use-study-queue';
import { useUnifiedSRS } from '@/hooks/use-unified-srs';
import { NeuralMap } from '@/components/neural-map';
import { storage } from '@/lib/storage';
import { useCurriculumData } from '@/hooks/use-curriculum-data';
import { DecayNudge } from '@/components/decay-nudge';

function DailySessionWidget() {
  const {
    totalDue,
    totalNew,
    totalLearning,
    totalReview,
    totalLeeches,
    totalAvailable,
    overdueCount,
    dailyLimit,
    learnedTodayCount,
    queue,
    isLoading
  } = useStudyQueue() as any;
  const [isClient, setIsClient] = useState(false);

  useEffect(() => { setIsClient(true) }, []);

  if (!isClient) return null;

  // Dynamic time estimate (Avg 24s per word across new/review)
  const estimatedMinutes = totalAvailable > 0 ? Math.max(5, Math.ceil(totalAvailable * 0.4)) : 0;

  return (
    <Card className="flex flex-col bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent border-indigo-500/20 shadow-xl relative overflow-hidden group h-full">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <BrainCircuit className="h-32 w-32" />
      </div>
      <CardHeader className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <BrainCircuit className="h-6 w-6 text-indigo-500" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-indigo-500">План на сегодня</span>
        </div>
        <CardTitle className="text-3xl font-headline font-bold">
          {isLoading ? '...' : estimatedMinutes > 0 ? `${estimatedMinutes} Минут` : 'Все выполнено! 🎉'}
        </CardTitle>
        <CardDescription className="text-base text-muted-foreground">
          {estimatedMinutes > 0
            ? 'Ежедневная тренировка: новые слова + повторение + контекст.'
            : 'Вы отлично поработали сегодня. Завтра появятся новые слова.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-center relative z-10 py-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Mastered - total mastered across system */}
          <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/20">
            <div className="text-3xl font-black text-green-600 dark:text-green-400">
              {isLoading ? '...' : queue.filter((i: any) => i.interval >= 30).length}
            </div>
            <div className="text-[10px] font-bold text-green-700/70 dark:text-green-400/70 uppercase tracking-tighter">Освоено слов</div>
          </div>
          {/* Due for review today */}
          <div className="bg-purple-500/10 p-4 rounded-xl border border-purple-500/20 shadow-[0_0_10px_-5px_rgba(168,85,247,0.3)]">
            <div className="text-3xl font-black text-purple-600 dark:text-purple-400">{isLoading ? '...' : totalDue}</div>
            <div className="text-[10px] font-bold text-purple-700/70 dark:text-purple-400/70 uppercase tracking-tighter">На повторение</div>
          </div>
          {/* Learning in progress */}
          <div className="bg-blue-500/10 p-4 rounded-xl border border-blue-500/20">
            <div className="text-3xl font-black text-blue-600 dark:text-blue-400">{isLoading ? '...' : totalLearning}</div>
            <div className="text-[10px] font-bold text-blue-700/70 dark:text-blue-400/70 uppercase tracking-tighter">В процессе</div>
          </div>
          {/* New words not yet started */}
          <div className="bg-slate-500/10 p-4 rounded-xl border border-slate-500/20">
            <div className="text-3xl font-black text-slate-600 dark:text-slate-400">{isLoading ? '...' : totalNew}</div>
            <div className="text-[10px] font-bold text-slate-500/70 uppercase tracking-tighter">Новые (в базе)</div>
          </div>
        </div>

        {/* Daily Progress Bar */}
        {!isLoading && (
          <div className="mt-6 space-y-2">
            <div className="flex justify-between items-end">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-primary">{learnedTodayCount} из {dailyLimit} слов</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Прогресс за сегодня</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-muted-foreground">{totalAvailable} в след. сессии</span>
              </div>
            </div>
            <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
              <div
                className="h-full bg-indigo-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                style={{ width: `${Math.min(100, (learnedTodayCount / dailyLimit) * 100)}%` }}
              />
            </div>
            {(queue as any).dailyStats?.lastSessionDate > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1 flex justify-between">
                <span>Последняя активность: {new Date((queue as any).dailyStats.lastSessionDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        )}

        {overdueCount > 0 && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl flex items-center gap-2">
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400 animate-pulse">⚠️ {overdueCount} {overdueCount === 1 ? 'слово просрочено' : 'слов просрочено'}</span>
          </div>
        )}
        {totalLeeches > 0 && (
          <div className="mt-3 bg-red-500/10 border border-red-500/50 p-3 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Siren className="h-5 w-5 text-red-500" />
              <span className="text-sm font-bold text-red-600">Сложные слова (Leeches): {totalLeeches}</span>
            </div>
          </div>
        )}

        {/* Smart Scheduling Hint */}
        {!isLoading && (
          <div className="mt-4 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/50 dark:border-indigo-800/30 rounded-xl flex items-start gap-3">
            <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
              <Zap className="h-3.5 w-3.5 text-indigo-500" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/70">Совет по расписанию</span>
              <span className="text-xs text-muted-foreground font-medium">
                {new Date().getHours() >= 20 || new Date().getHours() < 6
                  ? "🌙 Повторение перед сном — лучший способ закрепить слова в долговременной памяти."
                  : new Date().getHours() >= 6 && new Date().getHours() < 12
                    ? "☀️ Утренние часы — идеальное время для загрузки новых слов!"
                    : "💡 Регулярность важнее интенсивности. 15 минут в день достаточно!"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="relative z-10 pb-8">
        <Button asChild size="lg" className="w-full h-14 text-lg bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 hover:scale-[1.02] transition-transform">
          <Link href="/daily-session">
            Начать тренировку <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </CardFooter>
    </Card >
  );
}

function MyDictionariesWidget() {
  return (
    <Card className="flex flex-col bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent border-emerald-500/20 shadow-xl relative overflow-hidden group h-full">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <BookOpen className="h-32 w-32" />
      </div>
      <CardHeader className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <BookOpen className="h-6 w-6 text-emerald-500" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-500">Библиотека</span>
        </div>
        <CardTitle className="text-3xl font-headline font-bold">Словари</CardTitle>
        <CardDescription className="text-base text-muted-foreground">
          Управляйте своими папками и изучайте добавленные слова.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-center relative z-10 py-6 text-center">
        <p className="text-base">
          Создавайте тематические списки и следите за прогрессом каждой папки индивидуально.
        </p>
      </CardContent>
      <CardFooter className="relative z-10 pb-8">
        <Button asChild size="lg" variant="secondary" className="w-full h-14 text-lg border-emerald-500/20 hover:bg-emerald-500/10 hover:scale-[1.02] transition-transform outline-emerald-500">
          <Link href="/my-lectures">
            Открыть словари <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ExamTextsWidget() {
  return (
    <Card className="flex flex-col bg-gradient-to-br from-amber-500/10 via-transparent to-transparent border-amber-500/20 shadow-xl relative overflow-hidden group h-full">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <GraduationCap className="h-32 w-32" />
      </div>
      <CardHeader className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-amber-500/10 rounded-lg">
            <GraduationCap className="h-6 w-6 text-amber-500" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-amber-500">Экзамен B2 / B2 Beruf</span>
        </div>
        <CardTitle className="text-3xl font-headline font-bold">Тексты B2</CardTitle>
        <CardDescription className="text-base text-muted-foreground text-left">
          Тексты для заучивания с озвучкой и выделением предложений.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-center relative z-10 py-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-amber-500" />
            <span>Подготовка к устной части (Sprechen)</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-amber-500" />
            <span>Синхронная озвучка и подсветка текста</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-amber-500" />
            <span>Добавление собственных текстов</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="relative z-10 pb-8">
        <Button asChild size="lg" className="w-full h-14 text-lg bg-amber-600 hover:bg-amber-700 shadow-xl shadow-amber-500/20 hover:scale-[1.02] transition-transform">
          <Link href="/exam-texts">
            Перейти к текстам <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Helper component to separate data fetching logic
function WritingTrainingWidget() {
  return (
    <Card className="flex flex-col bg-gradient-to-br from-pink-500/10 via-transparent to-transparent border-pink-500/20 shadow-xl relative overflow-hidden group h-full">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <PenLine className="h-32 w-32" />
      </div>
      <CardHeader className="relative z-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-pink-500/10 rounded-lg">
            <PenLine className="h-6 w-6 text-pink-500" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-pink-500">Письмо B2</span>
        </div>
        <CardTitle className="text-3xl font-headline font-bold">Schreibwerkstatt</CardTitle>
        <CardDescription className="text-base text-muted-foreground text-left">
          Тренировка официальных писем с ИИ-коррекцией и универсальными фразами.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-center relative z-10 py-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-pink-500" />
            <span>Жалобы, Запросы, Извинения</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-pink-500" />
            <span>Мгновенная проверка ошибок</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="h-4 w-4 text-pink-500" />
            <span>Redemittel-Baukasten</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="relative z-10 pb-8">
        <Button asChild size="lg" className="w-full h-14 text-lg bg-pink-600 hover:bg-pink-700 shadow-xl shadow-pink-500/20 hover:scale-[1.02] transition-transform">
          <Link href="/writing-training">
            Начать писать <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Helper component to separate data fetching logic
export default function DashboardPage() {
  const { progress, getTopicProficiency, isLoading: progressLoading } = useUserProgress();
  const { levels, allTopics, isLoading: curriculumLoading } = useCurriculumData();
  const [isClient, setIsClient] = useState(false);
  const [allLearnedWords, setAllLearnedWords] = useState<VocabularyWord[]>([]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient && allTopics) {
      const wordsFromTopics: VocabularyWord[] = [];
      const seenWords = new Set<string>();

      // Add words from topics with progress
      allTopics.forEach((topic: any) => {
        if (progress[topic.id] > 0) {
          // Note: topic.vocabulary is typed as 'any' in schema but we know it matches VocabularyTheme[]
          (topic.vocabulary as any[]).forEach((theme: any) => {
            theme.words.forEach((word: any) => {
              if (word && word.german && !seenWords.has(word.german)) {
                wordsFromTopics.push(word);
                seenWords.add(word.german);
              }
            });
          });
        }
      });

      // Add common words if they are not already in the list
      commonWords.forEach(commonWord => {
        if (!seenWords.has(commonWord.german)) {
          wordsFromTopics.push(commonWord);
          seenWords.add(commonWord.german);
        }
      });

      setAllLearnedWords(wordsFromTopics);
    }
  }, [progress, isClient, allTopics]);

  const calculateLevelProgress = (levelId: string) => {
    if (!allTopics) return 0;

    // Filter topics for this level
    const levelTopics = allTopics.filter((t: any) => t.levelId === levelId);

    if (levelTopics.length === 0) {
      return 0;
    }
    const totalProficiency = levelTopics.reduce((sum: number, topic: any) => {
      return sum + (getTopicProficiency(topic.id) || 0);
    }, 0);
    return Math.round(totalProficiency / levelTopics.length);
  };

  if (curriculumLoading || progressLoading || !isClient) {
    return (
      <div className="container mx-auto py-8">
        <div className="space-y-8 animate-pulse">
          <div className="h-12 bg-muted rounded w-1/2 mx-auto"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="h-64 bg-muted rounded-xl"></div>
            <div className="h-64 bg-muted rounded-xl"></div>
            <div className="h-64 bg-muted rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl font-headline">
          Lernen Deutsch mit Oleh
        </h1>
        <p className="mt-3 text-lg text-muted-foreground sm:text-xl">
          Ваш персональный путь к овладению немецким языком
        </p>
      </header>

      {/* NEURAL MAP VISUALIZATION */}
      <section className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold font-headline uppercase tracking-tight">Карта нейронных связей</h2>
        </div>
        {isClient && <NeuralMapWrapper />}
      </section>


      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16 items-stretch">
        <GlobalVocabularyTrainer words={allLearnedWords} />
        <DailySessionWidget />
        <ExamTextsWidget />
        <MyDictionariesWidget />
        <WritingTrainingWidget />
      </div>

      <DecayNudge />

      <h2 className="text-3xl font-bold font-headline mb-6 text-center">Уровни обучения</h2>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {levels.map((level: any) => {
          const levelImage = getLevelImage(level.id);
          const levelProgress = isClient ? calculateLevelProgress(level.id) : 0;
          return (
            <Card
              key={level.id}
              className="flex flex-col overflow-hidden transition-transform duration-300 ease-in-out hover:scale-105 hover:shadow-xl"
            >
              <CardHeader className="relative h-48 w-full">
                {levelImage && (
                  <Image
                    src={levelImage.imageUrl}
                    alt={levelImage.description}
                    data-ai-hint={levelImage.imageHint}
                    fill
                    className="object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 p-6">
                  <CardTitle className="text-2xl font-bold text-primary-foreground font-headline">
                    {level.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-grow flex-col p-6">
                <CardDescription className="flex-grow">{level.description}</CardDescription>
                <div className="mt-6 flex items-center justify-center">
                  <ProgressCircle value={levelProgress} />
                </div>
              </CardContent>
              <CardFooter className="p-6 pt-0">
                <Button asChild className="w-full" variant="default">
                  <Link href={`/${level.id}`}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    Начать обучение
                    <ArrowRight className="ml-auto h-4 w-4" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function NeuralMapWrapper() {
  const { allWords, isLoading } = useUnifiedSRS();

  if (isLoading) return <div className="h-[400px] w-full bg-slate-900 animate-pulse rounded-3xl" />;

  return <NeuralMap words={allWords} limit={60} />;
}

