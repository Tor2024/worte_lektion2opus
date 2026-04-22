'use server';

import { ai, executeWithRetry, isGoogleAIRateLimitError } from '@/ai/genkit';
import { z } from 'genkit';

const WordEnrichmentInputSchema = z.object({
    word: z.string().describe('The German word to enrich.'),
    context: z.string().optional().describe('Optional context or folder name to help disambiguate meaning.'),
});

export type WordEnrichmentInput = z.infer<typeof WordEnrichmentInputSchema>;

const WordTypeSchema = z.enum(['noun', 'verb', 'adjective', 'conjunction', 'preposition', 'adverb', 'other']);

const GovernanceSchema = z.object({
    preposition: z.string().describe('The preposition (e.g. "auf", "an") or "без предлога" if none.'),
    case: z.string().describe('The required case (Akkusativ, Dativ, Genitiv, Nominativ, or "no-case").'),
    meaning: z.string().describe('Russian explanation of the meaning for this specific governance.'),
    example: z.string().describe('German example sentence using this specific governance.'),
});

const EnrichedWordSchema = z.object({
    german: z.string().describe('The canonical German form. For nouns, the noun itself. For verbs, the infinitive OR the fixed phrase if provided (e.g. "es geht um...").'),
    russian: z.string().describe('The single most common B2 Beruf translation.'),
    root: z.string().optional().describe('The core German root morpheme (e.g., "richt" for "ausrichten", "geb" for "Ergebnis"). Always lowercased, no endings or prefixes.'),
    allTranslations: z.string().optional().describe('All valid Russian translations for context, separated by semicolons.'),
    type: WordTypeSchema,
    // Verb specifics
    conjugation: z.string().optional().describe('For verbs: 3rd person singular Present (e.g. "er läuft" or "es geht").'),
    conjugations: z.object({
        ich: z.string(),
        du: z.string(),
        er_sie_es: z.string(),
        wir: z.string(),
        ihr: z.string(),
        sie_Sie: z.string(),
    }).optional().describe('Full conjugation table for Present tense.'),
    perfektForm: z.string().optional().describe('For verbs: 3rd person singular Perfekt.'),
    preposition: z.string().optional().describe('For verbs: associated preposition if any (e.g. "auf" for "warten auf").'),
    case: z.string().optional().describe('For verbs/prepositions: required case (e.g. "Akkusativ", "Dativ", or "Akkusativ/Dativ").'),
    verbTenses: z.object({
        praeteritum: z.string(),
        futur1: z.string(),
        futur2: z.string(),
    }).optional().describe('For Verbs: 3rd person singular forms for other tenses.'),
    // Noun specifics
    article: z.enum(['der', 'die', 'das']).optional().describe('For nouns: definite article.'),
    plural: z.string().optional().describe('For nouns: plural form.'),
    pluralArticle: z.string().optional().describe('For nouns: "die" or "-".'),
    // Adjective specifics
    comparative: z.string().optional().describe('For adjectives: comparative form (e.g. "stärker").'),
    superlative: z.string().optional().describe('For adjectives: superlative form (e.g. "am stärksten").'),
    // Conjunction & Structure specifics
    structure: z.string().optional().describe('Verb position/sentence structure (e.g. "Глагол на 2-м месте", "Инверсия (Глагол на 2-й позиции)"). This MUST be in RUSSIAN. Important for words like während, bevor, deshalb, unter anderem.'),
    structureExample: z.string().optional().describe('A German example sentence demonstrating the word order. Highlight the verb using <b> tags (e.g., "Ich lerne Deutsch, <b>weil</b> es Spaß <b>macht</b>").'),
    // Common
    example: z.string().describe('A simple example sentence using the word in context.'),
    exampleMeaning: z.string().describe('Russian translation of the example sentence.'),
    synonyms: z.array(z.object({
        word: z.string(),
        translation: z.string().describe('Russian translation of the synonym')
    })).optional().describe('List of 2-3 synonyms with translations.'),
    antonyms: z.array(z.object({
        word: z.string(),
        translation: z.string().describe('Russian translation of the synonym')
    })).optional().describe('List of 1-2 antonyms with translations (if applicable).'),
    collocations: z.array(z.object({
        phrase: z.string().describe('A VERY SHORT (2-3 words max) professional anchor phrase (e.g. "die Belastbarkeit prüfen").'),
        translation: z.string().describe('Russian translation of the anchor phrase.')
    })).optional().describe('Exactly 2-3 common collocations or fixed phrases to serve as memory anchors.'),
    governance: z.array(GovernanceSchema).optional().describe('List of normative prepositions and cases for verbs and adjectives.'),
});

export type EnrichedWordOutput = z.infer<typeof EnrichedWordSchema>;

const renderPrompt = (input: WordEnrichmentInput) => {
    return `You are a German language expert.
  Analyze the following German word and provide full grammatical details.
  
  Word: "${input.word}"
  ${input.context ? `Context: "${input.context}"` : ''}

  Instructions:
  1. Identify the word type.
  2. Provide translations:
     - **russian**: Provide THE SINGLE MOST COMMON technical or business meaning used in **B2 Beruf** (Professional German) in Russia/Ukraine.
     - **DO NOT** provide a list. If "sterben" is the word, use "умирать". If "bleiben" is the word, use "оставаться".
     - **allTranslations**: Provide all other valid meanings separated by semicolons (e.g. "оставаться; пребывать; задерживаться").
     - **CRITICAL**: DO NOT put lists in the 'russian' field. Put only the one best B2 Beruf meaning there.
  3. If it is a **Verb** or **Adjective**:
     - **CRITICAL: GOVERNANCE (Reksion)**:
       - Determine the normative German prepositions and cases required by this word.
       - **Strictly follow German norms**. Do not use "logical" or direct translations of Russian prepositions.
       - If there is only one governance, provide it in the 'governance' list.
       - If there are multiple governances (different prepositions or different cases with different meanings, e.g., "bestehen auf/aus/in"), provide EACH one separately.
       - For each governance item:
         - 'preposition': The German preposition OR "без предлога" if it takes a direct object or has no preposition.
         - 'case': The required case (Akkusativ, Dativ, Genitiv, Nominativ). Use 'no-case' only if truly applicable (rare).
         - 'meaning': A brief Russian explanation of the meaning for this specific case/preposition combo.
         - 'example': A clear German example sentence using this specific governance.
  4. If it is a **Verb** or **Fixed Expression**:
     - **CRITICAL**: Keep providing all previous details: 3rd person singular Present, FULL conjugation table ('conjugations'), Perfekt form, and 'verbTenses'.
     - Keep 'preposition' and 'case' at the top level for backward compatibility (fill them from the primary governance item), but prioritize the 'governance' array in the UI.
  5. If it is a **Noun**:
     - Provide article, plural form.
  6. Если слово влияет на порядок слов (союзы, наречия, частицы):
     - Опишите позицию глагола относительно подлежащего в поле 'structure' на РУССКОМ. Используйте только:
       1. "Глагол на 1-м месте" (Для Deshalb, Dann, Trotzdem - когда глагол идет СРАЗУ после этого слова, перед подлежащим).
       2. "Глагол на 2-м месте" (Для Denn, Und, Aber - когда порядок слов обычный: сначала 'кто', потом глагол).
       3. "Глагол в конце" (Для Weil, Dass, Wenn - придаточное предложение).
     - **CRITICAL**: Предоставьте 'structureExample' (немецкий), где ключевое слово и глагол(ы) выделены тегом <b>. 
     - **CLARITY**: Пример должен быть коротким и НАГЛЯДНО показывать позицию. Избегайте лишних запятых и вставок.
  7. If it is an **Adjective**:
     - Provide **comparative** and **superlative** forms.
  8. Provide 2-3 **Synonyms** and 1-2 **Antonyms** with Russian translations. Ensure translations for synonyms are concise.
  9. Generate a default example sentence (main example) and its translation.
     - **CRITICAL**: The example sentence must be **highly relevant to the B2 Beruf exam** (workplace context, formal communication, professional situations).
     - It should be a phrase that can be directly used in a B2 Beruf letter or oral exam.

  Return ONLY valid JSON matching the schema.`;
};

export async function enrichWord(input: WordEnrichmentInput): Promise<EnrichedWordOutput> {
    try {
        // Direct generation without defineFlow for maximum reliability and better error handling
        return await executeWithRetry(async (aiInstance) => {
            const { output } = await aiInstance.generate({
                prompt: renderPrompt(input),
                output: { schema: EnrichedWordSchema },
            });

            if (!output) {
                // Do NOT mention "quota" in this message: empty-output can be caused by
                // safety filters, schema mismatches, or transient API hiccups, and a
                // misleading word here was being matched by front-end rate-limit checks
                // and shown to users as "лимит AI исчерпан".
                throw new Error("AI returned an empty response.");
            }

            return output as EnrichedWordOutput;
        });
    } catch (err: any) {
        console.error("[AI Flow Error]:", err);

        const isRateLimit = isGoogleAIRateLimitError(err);
        const reason = isRateLimit
            ? "Google AI временно ограничил запросы (429). Подождите минуту и попробуйте снова."
            : `Не удалось обратиться к AI: ${err.message || "неизвестная ошибка"}.`;

        // Fallback object to show the error clearly in the UI instead of a 500 error.
        // The `__enrichmentError` field lets the UI distinguish a real AI rate-limit
        // from a generic failure (schema/network/safety) without string matching.
        return {
            german: input.word,
            russian: "Ошибка обогащения AI",
            allTranslations: reason,
            type: 'other',
            // Defaulting needed fields to avoid frontend crashes
            meaning: "Ошибка на стороне сервера",
            synonyms: [],
            antonyms: [],
            governance: [],
            __enrichmentError: {
                kind: isRateLimit ? 'rate_limit' : 'generic',
                message: err.message || 'unknown',
            },
        } as any;
    }
}
