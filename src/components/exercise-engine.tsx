
"use client";

import type { Topic, UserVocabularyWord, SM2State, Exercise, VocabularyWord } from "@/lib/types";
import { generateAdaptiveExercise, AdaptiveExerciseOutput } from "@/ai/flows/adaptive-exercise-generation";
import { verifyAnswer } from "@/ai/flows/verify-answer";
import { generateFeedback } from "@/ai/flows/generate-feedback";
import { generateLessonSummary, GenerateLessonSummaryOutput } from "@/ai/flows/generate-lesson-summary";
import { updateSM2State } from "@/lib/sm2";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { CheckCircle, Loader2, ThumbsUp, XCircle, BookOpen, BrainCircuit, Pencil, Move, SkipForward, RefreshCw, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/card";
import { WordCard } from "./word-card";
import { useUserProgress } from "@/hooks/use-user-progress";
import { useKnownWords } from "@/hooks/use-known-words";
import { curriculum } from "@/lib/data";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurriculumSRS } from "@/hooks/use-curriculum-srs";
import { SpeakButton } from "./speak-button";
import { startRoleplay, StartRoleplayOutput } from "@/ai/flows/start-roleplay";
import { evaluateRoleplay } from "@/ai/flows/evaluate-roleplay";
import { RoleplayInterface } from "./roleplay-interface";
import { formatGermanWord } from "@/lib/german-utils";
import { ExitTicket } from "./exit-ticket";
import { MistakeReplay } from "./mistake-replay";
import { appendTopicMistake, clearTopicMistakes, getTopicMistakes, TopicMistake } from "@/lib/topic-mistakes";

type Feedback = {
  type: "correct" | "incorrect";
  message: string;
} | null;



type SentenceConstructionExercise = {
  instruction?: string;
  example?: string;
  words: string[];
  correctSentence: string;
}

type Step = 'mistake-replay' | 'learning' | 'vocabulary' | 'reading' | 'comprehension' | 'grammar' | 'sentence-construction' | 'explanation' | 'roleplay' | 'exit-ticket' | 'mastered' | 'loading' | 'error';

export type LessonScore = { correct: number; total: number };


type ExerciseHistoryItem = {
  exercise: string;
  userAnswer: string;
  isCorrect: boolean;
};





type ExerciseEngineProps = {
  topic?: Topic; // Make topic optional
  customWords?: UserVocabularyWord[]; // New prop
  onMastered: (summary?: GenerateLessonSummaryOutput, score?: LessonScore) => void;
  onWordUpdate?: (wordId: string, newState: SM2State) => void;
}

export function ExerciseEngine({ topic, customWords, onMastered, onWordUpdate }: ExerciseEngineProps) {
  const [exerciseData, setExerciseData] = useState<AdaptiveExerciseOutput | null>(null);
  const [roleplayData, setRoleplayData] = useState<StartRoleplayOutput | null>(null);
  const [currentStep, setCurrentStep] = useState<Step>('loading');
  const [userAnswer, setUserAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { updateWordSRS } = useCurriculumSRS();
  const { proficiency, setTopicProficiency, getTopicProficiency } = useUserProgress(topic?.id || 'custom');
  const { isKnown, addKnownWord } = useKnownWords();
  const [exerciseHistory, setExerciseHistory] = useState<ExerciseHistoryItem[]>([]);
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [finalFeedback, setFinalFeedback] = useState<string | null>(null);
  const [lessonSummary, setLessonSummary] = useState<GenerateLessonSummaryOutput | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const router = useRouter();


  const allWords = useMemo(() => {
    if (customWords) return customWords.map(w => w.word);
    return topic ? topic.vocabulary.flatMap(v => v.words) : [];
  }, [topic, customWords]);
  const [vocabularyExercises, setVocabularyExercises] = useState<Exercise[]>([]);
  const [comprehensionExercises, setComprehensionExercises] = useState<Exercise[]>([]);
  const [grammarExercises, setGrammarExercises] = useState<Exercise[]>([]);
  const [sentenceConstructionExercises, setSentenceConstructionExercises] = useState<SentenceConstructionExercise[]>([]);
  const [learningQueue, setLearningQueue] = useState<VocabularyWord[]>([]);
  const [learningFeedback, setLearningFeedback] = useState<Feedback>(null);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [pendingMistakes, setPendingMistakes] = useState<TopicMistake[]>([]);

  const exerciseHistoryRef = useRef(exerciseHistory);

  useEffect(() => {
    exerciseHistoryRef.current = exerciseHistory;
  }, [exerciseHistory]);

  /* Combined startExerciseCycle to handle actual generation */

  const startExerciseCycle = useCallback(async () => {
    setIsGenerating(true);
    setApiError(null);
    setCurrentStep('loading');
    setFeedback(null);
    setUserAnswer('');
    setExerciseData(null);
    setIsSubmitting(false);
    setCurrentExerciseIndex(0);

    try {
      if (customWords && customWords.length > 0) {
        const exercises: Exercise[] = customWords.map(cw => {
          const rand = Math.random();
          const targetTranslationTokens = cw.word.russian.toLowerCase().split(/[,;]/).map(s => s.trim());

          const formattedTarget = formatGermanWord(cw.word);
          const validDistractors = customWords.filter(w => {
            if (w.word.german === cw.word.german) return false;
            const distractorTokens = w.word.russian.toLowerCase().split(/[,;]/).map(s => s.trim());
            const hasOverlap = targetTranslationTokens.some(tToken =>
              distractorTokens.some(dToken =>
                dToken === tToken ||
                (dToken.length > 3 && tToken.includes(dToken)) ||
                (tToken.length > 3 && dToken.includes(tToken))
              )
            );
            return !hasOverlap;
          }).map(w => formatGermanWord(w.word));

          const distractors = validDistractors
            .sort(() => 0.5 - Math.random())
            .slice(0, 3);

          while (distractors.length < 3) {
            distractors.push("...");
          }
          const options = [...distractors, formattedTarget].sort(() => 0.5 - Math.random());

          if (rand < 0.4) {
            return {
              id: `custom-trans-${cw.id}`,
              type: 'translation',
              question: cw.word.russian,
              correctAnswer: formattedTarget
            } as Exercise;
          } else if (rand < 0.7) {
            return {
              id: `custom-mc-${cw.id}`,
              type: 'multiple-choice',
              question: `Выберите перевод: ${cw.word.russian}`,
              options: options,
              correctAnswer: formattedTarget
            } as Exercise;
          } else {
            return {
              id: `custom-free-${cw.id}`,
              type: 'free-text-sentence',
              question: `Напишите предложение на немецком со словом: ${formattedTarget}`,
              correctAnswer: cw.context || formattedTarget
            } as Exercise;
          }
        });

        for (let i = exercises.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [exercises[i], exercises[j]] = [exercises[j], exercises[i]];
        }
        setVocabularyExercises(exercises);
        setComprehensionExercises([]);
        setGrammarExercises([]);
        setSentenceConstructionExercises([]);
        setCurrentStep('vocabulary');
        setIsGenerating(false);
        return;
      }

      if (!topic) {
        // If no topic and no custom words, we can't do anything.
        // This might happen if data is loading.
        throw new Error("No topic provided for standard exercise generation");
      }

      const currentLevel = curriculum.levels.find(level => level.topics.some(t => t.id === topic.id));
      const unknownWords = allWords.filter(word => !isKnown(word.german));
      const vocabularyToUse = unknownWords.length > 0 ? unknownWords : [];

      const timeoutPromise = new Promise<AdaptiveExerciseOutput>((_, reject) =>
        setTimeout(() => reject(new Error("AI_TIMEOUT")), 20000)
      );

      const response = await Promise.race([
        generateAdaptiveExercise({
          grammarConcept: topic.title,
          userLevel: (currentLevel?.id.toUpperCase() as 'A0' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2') || 'A1',
          pastErrors: exerciseHistoryRef.current.filter(e => !e.isCorrect).map(e => e.exercise).join(', '),
          exerciseHistory: exerciseHistoryRef.current,
          vocabulary: vocabularyToUse.map(word => ({
            german: word.german,
            russian: word.russian,
            example: 'example' in word ? word.example : (word as any).exampleSingular,
          })),
        }),
        timeoutPromise
      ]);
      setExerciseData(response);
      const vocabEx = (response.vocabularyExercises || []).map((e, idx) => ({ ...e, id: `ai-vocab-${idx}`, type: 'translation', correctAnswer: (e as any).answer || (e as any).correctAnswer } as Exercise));
      setVocabularyExercises(vocabEx);
      setComprehensionExercises((response.comprehensionExercises || []).map((e, idx) => ({ ...e, id: `ai-comp-${idx}`, type: 'free-text-sentence', correctAnswer: (e as any).answer || (e as any).correctAnswer } as Exercise)));
      setGrammarExercises((response.grammarExercises || []).map((e, idx) => ({ ...e, id: `ai-gram-${idx}`, type: 'fill-in-the-blank', correctAnswer: (e as any).answer || (e as any).correctAnswer } as Exercise)));
      setSentenceConstructionExercises(response.sentenceConstructionExercises || []);

      // Priority Sequence: Vocabulary -> Reading -> Comprehension etc.
      if (vocabEx.length > 0) {
        setCurrentStep('vocabulary');
      } else if (response.readingText) {
        setCurrentStep('reading');
      } else if (response.comprehensionExercises?.length) {
        setCurrentStep('comprehension');
      } else if (response.grammarExercises?.length) {
        setCurrentStep('grammar');
      } else {
        setCurrentStep('explanation');
      }
    } catch (error: any) {
      console.error("Error starting exercise cycle:", error);

      const msg: string = error?.message || '';
      const isQuotaError =
        /\b429\b/.test(msg) ||
        /RESOURCE_EXHAUSTED/i.test(msg) ||
        /Resource has been exhausted/i.test(msg) ||
        /rateLimitExceeded/i.test(msg) ||
        /quota exceeded/i.test(msg);
      const isTimeout = msg === 'AI_TIMEOUT';

      if (isQuotaError) {
        setApiError("Превышен лимит запросов к AI (429). Система автоматически попробует переподключиться, но если ошибка сохраняется — сделайте паузу.");
      } else if (isTimeout) {
        setApiError("AI-тренер долго не отвечает. Возможно, сервер перегружен. Попробуйте нажать 'Повторить запрос'.");
      } else {
        setApiError("Не удалось сгенерировать упражнение. Попробуйте обновить страницу или зайти позже.");
      }

      setCurrentStep('error');
    } finally {
      setIsGenerating(false);
    }
  }, [topic, customWords, allWords, isKnown, toast]);

  // Ref to track if we have already initialized for this topic/mount
  const isInitializedRef = useRef(false);

  // Effect to initialize the cycle
  useEffect(() => {
    // If we are already initialized or missing data, do nothing
    if (isInitializedRef.current || (!topic && !customWords)) return;

    if (allWords.length > 0 && !customWords) {
      // Logic for Topics: Check if we need to do learning
      // We assume every new topic mount needs learning phase first
      setLearningQueue(allWords.map(w => w as VocabularyWord));

      // Mistake replay: if the previous session left up to 5 mistakes, surface
      // them as a quick recall warm-up before the regular learning step.
      const stored = topic ? getTopicMistakes(topic.id) : [];
      if (stored.length > 0) {
        setPendingMistakes(stored);
        setCurrentStep('mistake-replay');
      } else {
        setCurrentStep('learning');
      }
      setIsGenerating(false);
      isInitializedRef.current = true;
    } else {
      // Logic for Custom Words OR Fallback: Start standard cycle
      startExerciseCycle();
      isInitializedRef.current = true;
    }
  }, [topic, allWords, customWords]);





  // Effect to initialize Roleplay when entering the step
  useEffect(() => {
    if (currentStep === 'roleplay' && !roleplayData && !isGenerating && topic) {
      const initRoleplay = async () => {
        setIsGenerating(true);
        try {
          const currentLevelId = curriculum.levels.find(level => level.topics.some(t => t.id === topic.id))?.id || 'A1';

          const data = await startRoleplay({
            topicTitle: topic.title,
            userLevel: currentLevelId.toUpperCase() as any,
            vocabulary: allWords.map(w => w.german)
          });
          setRoleplayData(data);
        } catch (e) {
          console.error(e);
          setApiError("Failed to start roleplay. Please try again.");
          setCurrentStep('error');
        } finally {
          setIsGenerating(false);
        }
      };
      initRoleplay();
    }
  }, [currentStep, roleplayData, topic, isGenerating, allWords]);


  const steps: { id: Step, name: string, icon: React.ElementType }[] = useMemo(() => [
    { id: 'vocabulary', name: 'Словарь', icon: BookOpen },
    { id: 'reading', name: 'Чтение', icon: BookOpen },
    { id: 'comprehension', name: 'Понимание', icon: BrainCircuit },
    { id: 'grammar', name: 'Грамматика', icon: Pencil },
    { id: 'sentence-construction', name: 'Построение фраз', icon: Move },
    { id: 'explanation', name: 'Объяснение', icon: BookOpen },
    { id: 'roleplay', name: 'Roleplay', icon: CheckCircle },
  ], []);

  const currentStepIndex = useMemo(() => steps.findIndex(s => s.id === currentStep), [steps, currentStep]);


  const addHistoryAndProficiency = useCallback((question: string, userAnswer: string, isCorrect: boolean) => {
    setExerciseHistory(prev => [...prev, { exercise: question, userAnswer, isCorrect }]);
    if (topic) {
      const currentProficiency = getTopicProficiency(topic.id);
      const newProficiency = isCorrect ? currentProficiency + 5 : Math.max(0, currentProficiency - 7);
      setTopicProficiency(newProficiency);
    }
  }, [getTopicProficiency, setTopicProficiency, topic]);

  const proceedToNextExercise = () => {
    setFeedback(null);
    setUserAnswer('');

    // Determine current list
    let currentExercises: (Exercise | SentenceConstructionExercise)[] = [];
    if (currentStep === 'vocabulary') currentExercises = vocabularyExercises;
    else if (currentStep === 'comprehension') currentExercises = comprehensionExercises;
    else if (currentStep === 'grammar') currentExercises = grammarExercises;
    else if (currentStep === 'sentence-construction') currentExercises = sentenceConstructionExercises;

    // Check if we still have exercises in the current step
    if (currentExercises.length > 0 && currentExerciseIndex < currentExercises.length - 1) {
      setCurrentExerciseIndex(prev => prev + 1);
      return;
    }

    // Move to next valid step
    setCurrentExerciseIndex(0);

    // Define the sequence (exit-ticket is the gate before mastered)
    const stepOrder: Step[] = ['vocabulary', 'reading', 'comprehension', 'grammar', 'sentence-construction', 'explanation', 'roleplay', 'exit-ticket', 'mastered'];
    const currentOrderIdx = stepOrder.indexOf(currentStep);

    const hasExitTicketCandidates = !!topic && allWords.some(w => typeof (w as { example?: string }).example === 'string' && (w as { example?: string }).example!.length > 0);

    for (let i = currentOrderIdx + 1; i < stepOrder.length; i++) {
      const nextStep = stepOrder[i];
      let hasContent = false;

      // Check content availability
      if (nextStep === 'reading' && exerciseData?.readingText) hasContent = true;
      else if (nextStep === 'comprehension' && comprehensionExercises.length > 0) hasContent = true;
      else if (nextStep === 'grammar' && grammarExercises.length > 0) hasContent = true;
      else if (nextStep === 'sentence-construction' && sentenceConstructionExercises.length > 0) hasContent = true;
      else if (nextStep === 'explanation' && exerciseData?.explanation) hasContent = true;
      else if (nextStep === 'roleplay' && topic) hasContent = true; // Review: Always attempt roleplay if topic exists?
      else if (nextStep === 'exit-ticket' && hasExitTicketCandidates) hasContent = true;
      else if (nextStep === 'mastered') hasContent = true; // Always valid end

      if (hasContent) {
        if (nextStep === 'mastered') {
          handleFinishLesson();
          return;
        }
        setCurrentStep(nextStep);
        return;
      }
    }
  }

  const handleFinishLesson = async (score?: LessonScore) => {
    setCurrentStep('loading');
    setIsGenerating(true);
    try {
      let summary: GenerateLessonSummaryOutput | undefined;
      if (exerciseHistory.length > 0) {
        summary = await generateLessonSummary({
          topicTitle: topic?.title || 'Custom Practice',
          exerciseHistory: exerciseHistory.map(h => ({
            exercise: h.exercise,
            userAnswer: h.userAnswer,
            isCorrect: h.isCorrect
          }))
        });
        setLessonSummary(summary);
      }

      // Mark as mastered: 100% if exit-ticket score >= 2/3 (or skipped), else 80%
      if (topic) {
        const passed = !score || score.total === 0 || score.correct / score.total >= 2 / 3;
        setTopicProficiency(passed ? 100 : 80);
      }

      onMastered(summary, score);
      setCurrentStep('mastered');
    } catch (e) {
      console.error("Failed to generate lesson summary:", e);
      // Proceed anyway but without summary
      if (topic) {
        const passed = !score || score.total === 0 || score.correct / score.total >= 2 / 3;
        setTopicProficiency(passed ? 100 : 80);
      }
      onMastered(undefined, score);
      setCurrentStep('mastered');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExitTicketDone = useCallback((correct: number, total: number) => {
    handleFinishLesson({ correct, total });
  }, []);


  const handleSubmitExercise = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!exerciseData && (!customWords || customWords.length === 0)) || !userAnswer || isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);
    setApiError(null);

    let currentExercise;

    if (currentStep === 'vocabulary') {
      currentExercise = vocabularyExercises[currentExerciseIndex];
    } else if (currentStep === 'comprehension') {
      currentExercise = comprehensionExercises[currentExerciseIndex];
    } else if (currentStep === 'grammar') {
      currentExercise = grammarExercises[currentExerciseIndex];
    } else if (currentStep === 'sentence-construction') {
      currentExercise = sentenceConstructionExercises[currentExerciseIndex];
    }

    if (!currentExercise) {
      setIsSubmitting(false);
      return;
    }

    const question = 'words' in currentExercise ? currentExercise.words.join(' / ') : currentExercise.question;
    const correctAnswer = 'correctSentence' in currentExercise ? currentExercise.correctSentence : currentExercise.correctAnswer;

    try {
      let verification;

      // OPTIMIZATION: Check for exact match locally to save AI calls
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/[.,!?]/g, '');
      const normalizedCorrect = correctAnswer.trim().toLowerCase().replace(/[.,!?]/g, '');

      if (normalizedUser === normalizedCorrect) {
        verification = {
          isCorrect: true,
          explanation: `<p><strong>Отлично! Всё верно!</strong></p><p>Ваш ответ полностью совпадает с правильным: <strong class="text-primary">${correctAnswer}</strong>.</p>`
        };
      } else {
        try {
          verification = await verifyAnswer({
            question: question,
            userAnswer,
            correctAnswer: correctAnswer,
          });
        } catch (aiError) {
          console.error("AI Verify failed, falling back to local check:", aiError);
          // Fallback: simple comparison
          const isCorrectLocal = normalizedUser === normalizedCorrect;
          verification = {
            isCorrect: isCorrectLocal,
            explanation: isCorrectLocal
              ? `<p><strong>Верно!</strong> (Offline check)</p>`
              : `<p><strong>Неверно.</strong></p><p>Правильный ответ: <strong class="text-primary">${correctAnswer}</strong></p><p><em>(AI недоступен для детального объяснения)</em></p>`
          };
        }
      }

      const isCorrect = verification.isCorrect;
      addHistoryAndProficiency(question, userAnswer, isCorrect);
      if (!isCorrect && topic) {
        appendTopicMistake(topic.id, question, correctAnswer);
      }

      if (!isCorrect) {
        // Retry Logic: Add failed exercise to the end of the queue
        if (currentStep === 'vocabulary') {
          setVocabularyExercises(prev => [...prev, currentExercise as Exercise]);
        } else if (currentStep === 'comprehension') {
          setComprehensionExercises(prev => [...prev, currentExercise as Exercise]);
        } else if (currentStep === 'grammar') {
          setGrammarExercises(prev => [...prev, currentExercise as Exercise]);
        } else if (currentStep === 'sentence-construction') {
          setSentenceConstructionExercises(prev => [...prev, currentExercise as SentenceConstructionExercise]);
        }
      }

      const quality = isCorrect ? 5 : 0;

      if (currentStep === 'vocabulary') {
        if (!customWords && allWords) {
          const wordObj = allWords.find(w => w.russian === question);
          if (wordObj) {
            if (isCorrect) addKnownWord(wordObj.german);
            updateWordSRS(wordObj.german, quality);
          }
        }

        if (customWords && onWordUpdate) {
          const matchingWord = customWords.find(cw =>
            cw.word.russian === question ||
            cw.word.german === correctAnswer
          );

          if (matchingWord) {
            const nextState = updateSM2State(quality, matchingWord.sm2State);
            onWordUpdate(matchingWord.id, nextState);
          }
        }
      }

      setFeedback({ type: isCorrect ? 'correct' : 'incorrect', message: verification.explanation });

    } catch (error: any) {
      console.error("Error submitting answer:", error);

      const msg: string = error?.message || '';
      const isQuotaError =
        /\b429\b/.test(msg) ||
        /RESOURCE_EXHAUSTED/i.test(msg) ||
        /Resource has been exhausted/i.test(msg) ||
        /rateLimitExceeded/i.test(msg) ||
        /quota exceeded/i.test(msg);

      if (isQuotaError) {
        setApiError("Превышен лимит запросов к AI. Пожалуйста, подождите немного или попробуйте позже.");
      } else {
        setApiError("Не удалось проверить ответ. Попробуйте снова.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGlobalContinue = async () => {
    if (feedback) {
      proceedToNextExercise();
      return;
    }

    if (currentStep === 'vocabulary') {
      proceedToNextExercise();
    } else if (currentStep === 'reading') {
      proceedToNextExercise();
    } else if (currentStep === 'explanation') {
      // Logic to move to Roleplay or Mastered
      proceedToNextExercise();
    }
  };

  const getNextTopic = () => {
    if (!topic) return null;
    const currentLevel = curriculum.levels.find(level => level.topics.some(t => t.id === topic.id));
    if (!currentLevel) return null;

    const currentTopicIndex = currentLevel.topics.findIndex(t => t.id === topic.id);
    if (currentTopicIndex > -1 && currentTopicIndex < currentLevel.topics.length - 1) {
      const nextTopic = currentLevel.topics[currentTopicIndex + 1];
      return `/${currentLevel.id}/${nextTopic.id}`;
    }
    return null;
  }

  const nextTopicUrl = getNextTopic();

  const renderContent = () => {
    if (currentStep === 'loading' && !apiError) return null;

    if (apiError) {
      let retryAction: () => void;
      if (currentStep === 'error' && !finalFeedback) {
        retryAction = startExerciseCycle;
      } else if (currentStep === 'error' && finalFeedback) {
        retryAction = handleGlobalContinue;
      } else {
        retryAction = () => handleSubmitExercise();
      }

      return (
        <Card className="text-center">
          <CardHeader>
            <CardTitle className="text-destructive">Произошла ошибка</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{apiError}</p>
            <Button onClick={retryAction} className="mt-4" disabled={isSubmitting || isGenerating}>
              {(isSubmitting || isGenerating) ? <Loader2 className="animate-spin mr-2" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Повторить запрос
            </Button>
          </CardContent>
        </Card>
      );
    }

    switch (currentStep) {
      case 'mistake-replay': {
        if (!topic) return null;
        return (
          <MistakeReplay
            mistakes={pendingMistakes}
            onDone={() => {
              clearTopicMistakes(topic.id);
              setPendingMistakes([]);
              setCurrentStep('learning');
            }}
          />
        );
      }

      case 'exit-ticket': {
        if (!topic) return null;
        return (
          <ExitTicket words={allWords} onDone={handleExitTicketDone} />
        );
      }

      case 'reading': {
        if (!exerciseData) return null;
        return (
          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Прочитайте текст</CardTitle>
              <SpeakButton text={exerciseData.readingText} variant="outline" size="sm" showText />
            </CardHeader>
            <CardContent>
              <div
                className="text-lg leading-relaxed prose prose-slate dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: exerciseData.readingText }}
              />
              <div className="mt-8 flex gap-4">
                <Button onClick={handleGlobalContinue} className="w-full sm:w-auto">Продолжить</Button>
              </div>
            </CardContent>
          </Card>
        );
      }

      case 'roleplay': {
        if (!roleplayData) {
          return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground animate-pulse">Готовим сцену для диалога...</p>
              <p className="text-xs text-muted-foreground">AI вживается в роль...</p>
            </div>
          );
        }

        const currentLevelId = topic ? curriculum.levels.find(level => level.topics.some(t => t.id === topic.id))?.id || 'A1' : 'A1';

        return (
          <RoleplayInterface
            scenario={roleplayData.scenario}
            aiRole={roleplayData.aiRole}
            userRole={roleplayData.userRole}
            initialMessage={roleplayData.initialMessage}
            objectives={roleplayData.objectives}
            userLevel={currentLevelId}
            onSendMessage={(history, msg) => evaluateRoleplay({
              history,
              userLevel: currentLevelId.toUpperCase() as any,
              objectives: roleplayData.objectives,
              scenarioContext: roleplayData.scenario
            })}
            onComplete={() => {
              handleFinishLesson();
            }}
          />
        )
      }

      case 'learning': {
        if (!learningQueue || learningQueue.length === 0) return null;
        const learningWord = learningQueue[0];

        const handleLearningSubmit = (e?: React.FormEvent) => {
          if (e) e.preventDefault();
          if (!userAnswer) return;
          const normalize = (s: string) => s.trim().toLowerCase().replace(/[.,!?]/g, '');
          const correctStats = formatGermanWord(learningWord);
          const isCorrect = normalize(userAnswer) === normalize(correctStats);
          if (isCorrect) {
            setLearningFeedback({ type: 'correct', message: `<p><strong>Верно!</strong> ${correctStats}</p>` });
          } else {
            setLearningFeedback({ type: 'incorrect', message: `<p>Ошибка. Правильно: <strong class="text-primary">${correctStats}</strong></p>` });
          }
        };

        const handleLearningMakeNext = () => {
          if (!learningFeedback) return;
          if (learningFeedback.type === 'correct') {
            const newQueue = learningQueue.slice(1);
            setLearningQueue(newQueue);
            if (newQueue.length === 0) {
              // Phase complete, move to next
              startExerciseCycle();
            }
          } else {
            const newQueue = [...learningQueue.slice(1), learningWord];
            setLearningQueue(newQueue);
          }
          setLearningFeedback(null);
          setUserAnswer('');
        };

        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold font-headline">Изучение новых слов</h2>
              <span className="text-sm text-muted-foreground">Осталось: {learningQueue.length}</span>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-center font-headline">Как это по-немецки?</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="text-3xl font-bold text-center py-6 prose prose-slate dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: learningWord.russian }}
                />

                {learningFeedback ? (
                  <div className="animate-in fade-in zoom-in duration-300">
                    <WordCard word={learningWord} compact />
                    <Alert variant={learningFeedback.type === 'correct' ? 'default' : 'destructive'} className="mt-4">
                      <div className="flex items-center gap-2">
                        {learningFeedback.type === 'correct' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        <div dangerouslySetInnerHTML={{ __html: learningFeedback.message }} />
                        <SpeakButton text={formatGermanWord(learningWord)} size="sm" variant="ghost" />
                      </div>
                    </Alert>
                    <Button onClick={handleLearningMakeNext} className="w-full mt-4 h-12 text-lg" size="lg">
                      {learningFeedback.type === 'correct' ? 'Далее' : 'Повторить позже'}
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleLearningSubmit} className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        placeholder={learningWord.type === 'noun' ? "Существительное с артиклем (der/die/das)..." : "Перевод..."}
                        value={userAnswer}
                        onChange={e => setUserAnswer(e.target.value)}
                        className="text-lg text-center h-12"
                      />
                      <SpeakButton
                        text={formatGermanWord(learningWord)}
                        size="lg"
                        variant="secondary"
                      />
                    </div>
                    <Button type="submit" className="w-full h-12 text-lg" disabled={!userAnswer}>Проверить</Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }

      case 'vocabulary':
      case 'comprehension':
      case 'grammar':
      case 'sentence-construction': {
        let currentExercisesList: (Exercise | SentenceConstructionExercise)[] = [];
        let title = '';

        if (currentStep === 'vocabulary') {
          currentExercisesList = vocabularyExercises;
          if (currentExercisesList.length > 0) {
            const currentEx = currentExercisesList[currentExerciseIndex] as Exercise;
            if (currentEx.type === 'multiple-choice') title = 'Выберите правильный вариант';
            else if (currentEx.type === 'free-text-sentence') title = 'Составьте предложение';
            else title = 'Переведите слово на немецкий (с артиклем)';
          }
        } else if (currentStep === 'comprehension') {
          currentExercisesList = comprehensionExercises;
          title = 'Ответьте на вопрос (на немецком)';
        } else if (currentStep === 'grammar') {
          currentExercisesList = grammarExercises;
          title = 'Заполните пропуск (на немецком)';
        } else {
          currentExercisesList = sentenceConstructionExercises;
          title = 'Составьте предложение из слов';
        }

        if (currentExercisesList.length === 0) {
          return <div className="p-4 text-center">Загрузка упражнения...</div>;
        }

        const currentExercise = currentExercisesList[currentExerciseIndex];

        if (currentStep === 'sentence-construction') {
          const scExercise = currentExercise as SentenceConstructionExercise;
          return (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-row items-center justify-between mb-1">
                  <CardTitle className="font-headline">{title}</CardTitle>
                  <SpeakButton text={scExercise.correctSentence} variant="ghost" size="sm" />
                </div>
                {scExercise.instruction && (
                  <CardDescription className="text-base text-primary/90 font-medium leading-snug">
                    {scExercise.instruction}
                  </CardDescription>
                )}
                {scExercise.example && (
                  <div 
                    className="mt-3 p-3 bg-primary/5 rounded-md text-sm border-l-2 border-primary/40 text-muted-foreground prose prose-sm prose-slate dark:prose-invert [&_strong]:text-primary"
                    dangerouslySetInnerHTML={{ __html: scExercise.example }} 
                  />
                )}
              </CardHeader>
              <CardContent>
                <div className="text-lg text-foreground mb-4">
                  <p className="font-bold tracking-wider bg-muted/50 p-4 rounded-lg">{scExercise.words.join(' / ')}</p>
                </div>
                <form onSubmit={handleSubmitExercise} className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="text"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder="Введите ваше предложение..."
                    className="flex-grow h-12"
                    disabled={isSubmitting || !!feedback}
                  />
                  <Button type="submit" size="lg" disabled={isSubmitting || !userAnswer || !!feedback}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Проверить'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        }

        const stdExercise = currentExercise as Exercise;
        return (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center mb-1">
                <CardTitle className="font-headline">{title}</CardTitle>
                <div className="flex items-center gap-4">
                  <SpeakButton text={stdExercise.correctAnswer} variant="ghost" size="sm" />
                  <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                    {currentExerciseIndex + 1} / {currentExercisesList.length}
                  </span>
                </div>
              </div>
              {stdExercise.instruction && (
                <CardDescription className="text-base text-primary/90 font-medium leading-snug mt-1">
                  {stdExercise.instruction}
                </CardDescription>
              )}
              {stdExercise.example && (
                <div
                  className="mt-3 p-3 bg-primary/5 rounded-md text-sm border-l-2 border-primary/40 text-muted-foreground prose prose-sm prose-slate dark:prose-invert [&_strong]:text-primary"
                  dangerouslySetInnerHTML={{ __html: stdExercise.example }}
                />
              )}
            </CardHeader>
            <CardContent>
              {stdExercise.type === 'multiple-choice' ? (
                <>
                  <div className="text-lg text-foreground mb-4">
                    <div
                      className="font-medium bg-muted/30 p-4 rounded-md mb-2 prose prose-slate dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: stdExercise.question }}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 mt-4">
                    {stdExercise.options?.map((option, idx) => (
                      <Button
                        key={idx}
                        variant={userAnswer === option ? (feedback?.type === 'correct' ? "default" : "destructive") : "outline"}
                        className={`justify-start h-auto py-4 px-6 text-lg transition-all ${feedback && option === stdExercise.correctAnswer ? "border-green-500 bg-green-50 text-green-700" : ""}`}
                        onClick={() => {
                          if (isSubmitting || feedback) return;
                          setUserAnswer(option);
                        }}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span>{option}</span>
                          <SpeakButton text={option} size="sm" variant="ghost" className="h-8 w-8 ml-2" />
                        </div>
                      </Button>
                    ))}
                    <div className="mt-4">
                      <Button
                        onClick={() => handleSubmitExercise()}
                        disabled={!userAnswer || isSubmitting || !!feedback}
                        className="w-full h-12 text-lg"
                      >
                        {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : 'Проверить'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <form onSubmit={handleSubmitExercise} className="space-y-4">
                  {(stdExercise.type === 'fill-in-the-blank' || stdExercise.question.includes('__')) && /_{2,}/.test(stdExercise.question) ? (
                    <div className="text-xl font-medium bg-muted/30 p-6 rounded-md mb-6 leading-[3rem] text-foreground">
                      {stdExercise.question.split(/(_{2,})/).map((part, i) => {
                        if (/_{2,}/.test(part)) {
                          return (
                            <Input
                              key={i}
                              autoFocus
                              className={`inline-flex min-w-[3rem] mx-2 text-center text-xl h-10 border-b-2 bg-background transition-colors focus-visible:ring-1 focus-visible:ring-primary shadow-sm ${feedback?.type === 'incorrect' ? 'border-destructive text-destructive' : 'border-primary'}`}
                              style={{ width: `${Math.max(4, userAnswer.length + 2)}ch` }}
                              value={userAnswer}
                              onChange={(e) => setUserAnswer(e.target.value)}
                              disabled={isSubmitting || !!feedback}
                            />
                          );
                        }
                        return <span key={i} dangerouslySetInnerHTML={{ __html: part }} />;
                      })}
                    </div>
                  ) : (
                    <>
                      <div className="text-lg text-foreground mb-4">
                        <div
                          className="font-medium bg-muted/30 p-4 rounded-md mb-2 prose prose-slate dark:prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: stdExercise.question }}
                        />
                      </div>
                      {stdExercise.type === 'free-text-sentence' ? (
                        <div className="space-y-2">
                          <textarea
                            className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-lg ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Напишите ваше предложение..."
                            value={userAnswer}
                            onChange={(e) => setUserAnswer(e.target.value)}
                            disabled={isSubmitting || !!feedback}
                          />
                          <p className="text-xs text-muted-foreground italic">AI проверит грамматику и смысл вашего предложения.</p>
                        </div>
                      ) : (
                        <Input
                          autoFocus
                          placeholder="Введите ваш ответ на немецком..."
                          value={userAnswer}
                          onChange={(e) => setUserAnswer(e.target.value)}
                          disabled={isSubmitting || !!feedback}
                          className="text-xl h-14 text-center"
                        />
                      )}
                    </>
                  )}

                  <Button type="submit" className="w-full h-14 text-xl font-headline" disabled={!userAnswer || isSubmitting || !!feedback}>
                    {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : <div className="flex items-center"><CheckCircle className="mr-2 h-6 w-6" /> Проверить</div>}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        );
      }

      case 'explanation': {
        if (!exerciseData) return null;
        return (
          <Card>
            <CardHeader><CardTitle className="font-headline">Объяснение правила</CardTitle></CardHeader>
            <CardContent>
              <div className="prose prose-lg max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: exerciseData.explanation }} />
              <Button onClick={handleGlobalContinue} className="mt-6 h-12 px-8" disabled={isGenerating}>
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Следующий цикл'}
              </Button>
            </CardContent>
          </Card>
        );
      }

      default:
        return null;
    }
  };

  if ((currentStep === 'loading' || isGenerating) && !apiError) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-12 min-h-[300px]">
        <Loader2 className="h-16 w-16 animate-spin text-primary mb-6" />
        <p className="text-xl font-medium text-muted-foreground animate-pulse">ИИ-тренер готовит ваши задания...</p>
      </div>
    );
  }

  if (currentStep === 'mastered') {
    return (
      <Card className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <ThumbsUp className="h-32 w-32 text-primary" />
        </div>
        <CardHeader className="pt-12">
          <CardTitle className="text-center relative z-10">
            <div className="mx-auto bg-green-100 dark:bg-green-900/40 rounded-full p-4 w-24 h-24 flex items-center justify-center mb-6 shadow-xl">
              <ThumbsUp className="h-12 w-12 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-3xl font-black text-foreground font-headline uppercase tracking-tighter">Тема освоена!</div>
          </CardTitle>
          <CardDescription className="text-center text-lg max-w-md mx-auto">Отличная работа! Вы продемонстрировали уверенное понимание темы.</CardDescription>
        </CardHeader>
        <CardContent className="text-center pb-12">
          {finalFeedback && (
            <Alert className="mt-8 text-left border-primary/20 bg-primary/5 max-w-2xl mx-auto">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <AlertTitle className="font-bold text-primary mb-2">Персональный отзыв от AI-тренера</AlertTitle>
              <AlertDescription className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: finalFeedback }} />
            </Alert>
          )}
        </CardContent>
        <CardFooter className="bg-muted/30 p-8">
          {nextTopicUrl ? (
            <Button asChild className="w-full h-14 text-lg font-bold shadow-lg" size="lg">
              <Link href={nextTopicUrl}>
                Перейти к следующей теме <SkipForward className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          ) : (
            <Button onClick={() => onMastered()} className="w-full h-14 text-lg font-bold" size="lg">
              Завершить тренировку <CheckCircle className="ml-2 h-5 w-5" />
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  const currentProficiency = getTopicProficiency(topic?.id || 'custom');

  return (
    <div className="space-y-8">
      <div>
        <ol className="flex items-center w-full px-2">
          {steps.map((step, index) => (
            <li key={step.id} className={`flex w-full items-center ${index < steps.length - 1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-4 after:inline-block" : ""} ${index <= currentStepIndex ? 'text-primary after:border-primary' : 'text-muted-foreground after:border-muted'}`}>
              <span className={`flex items-center justify-center w-8 h-8 rounded-full lg:h-10 lg:w-10 shrink-0 ${index <= currentStepIndex ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-muted'}`}>
                <step.icon className="w-4 h-4 lg:w-5 lg:h-5" />
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <label htmlFor="mastery" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Прогресс освоения</label>
          <span className="text-sm font-black text-primary">{topic ? currentProficiency : 'N/A'}%</span>
        </div>
        <Progress value={currentProficiency} id="mastery" className="h-3" />
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {renderContent()}
      </div>

      {feedback && (
        <Alert variant={feedback.type === 'incorrect' ? 'destructive' : 'default'} className="mt-6 border-2 shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="flex justify-between items-start gap-4 p-2">
            <div className="flex-grow">
              <div className="flex items-center gap-2 mb-2">
                {feedback.type === 'correct' ? <CheckCircle className="h-6 w-6 text-green-500" /> : <XCircle className="h-6 w-6 text-destructive" />}
                <AlertTitle className="text-xl font-black font-headline m-0">
                  {feedback.type === 'correct' ? 'ВЕРНО!' : 'ОБРАТИТЕ ВНИМАНИЕ'}
                </AlertTitle>
              </div>
              <AlertDescription className="prose prose-sm max-w-none dark:prose-invert text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: feedback.message }} />
            </div>
            <Button onClick={handleGlobalContinue} size="lg" className="shrink-0 shadow-lg font-bold">Далее <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
        </Alert>
      )}
    </div>
  );
}
