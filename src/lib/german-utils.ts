import { VocabularyWord, UserVocabularyWord } from "./types";

/**
 * Safely formats a German word, adding the article for nouns if not already present.
 * Prevents issues like "die die Reinigung".
 */
export function formatGermanWord(word: VocabularyWord): string {
    if (!word || !word.german) return ""; // Safety check

    if (word.type === 'noun') {
        const german = (word.german || "").trim();
        const article = (word.article || "").trim();

        // Check if the german string already starts with an article (case-insensitive)
        const lowerGerman = german.toLowerCase();
        const articles = ['der ', 'die ', 'das '];

        if (articles.some(a => lowerGerman.startsWith(a))) {
            return word.german;
        }

        if (article) {
            return `${article} ${german}`;
        }
    }

    // ... replaced by new component approach. Let's keep formatGermanWord as is, and create a React component for visual display.
    return word.german;
}

export function getGenderColorClass(word: VocabularyWord): string {
    if (word.type === 'noun') {
        const article = (word as any).article;
        switch (article) {
            case 'der': return 'text-blue-600 dark:text-blue-400';
            case 'die': return 'text-rose-700 dark:text-rose-500';
            case 'das': return 'text-emerald-700 dark:text-emerald-500';
            default: return 'text-primary';
        }
    } else if (word.type === 'verb') {
        return 'text-amber-800 dark:text-amber-600';
    } else if (word.type === 'adjective') {
        return 'text-indigo-600 dark:text-indigo-400';
    } else if (word.type === 'conjunction') {
        return 'text-purple-600 dark:text-purple-400';
    } else if (word.type === 'preposition') {
        return 'text-yellow-600 dark:text-yellow-500';
    } else if (word.type === 'adverb') {
        return 'text-cyan-600 dark:text-cyan-400';
    } else if (word.type === 'other') {
        return 'text-slate-500 dark:text-slate-400';
    }

    return 'text-primary';
}

/**
 * Strips markdown, HTML tags, and technical characters/abbreviations that shouldn't be voiced by TTS.
 * This prevents TTS engines (especially Russian) from crashing or hanging on special characters.
 */
export function cleanTextForSpeech(text: string): string {
    if (!text) return "";
    
    let cleaned = text;

    // 1. Remove HTML tags completely
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // 2. Remove anything inside parentheses or brackets (grammar notes, etc.)
    cleaned = cleaned.replace(/\([^)]*\)/g, '');
    cleaned = cleaned.replace(/\[[^\]]*\]/g, '');

    // 3. Remove common Russian dictionary abbreviations
    const abbreviations = [
        /(кого-л\.|что-л\.|кому-л\.|чему-л\.|кем-л\.|чем-л\.|о ком-л\.|о чем-л\.|кто-л\.)/gi,
        /(к-л\.|ч-л\.)/gi,
        /(т\.е\.)/gi,
        /(соотв\.)/gi
    ];
    
    abbreviations.forEach(regex => {
        cleaned = cleaned.replace(regex, '');
    });

    // 4. Strip leftover markdown symbols (*, _, ~, `, #), slashes and vertical bars
    cleaned = cleaned.replace(/[*_~`#/|]/g, ' ');

    // 5. Clean up multiple spaces, dashes, and stray spaces before punctuation
    cleaned = cleaned.replace(/[-]{2,}/g, ' ');
    cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1');
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

    // 6. Safety cap: guard against runaway strings (e.g. an entire error dump) while
    //    still allowing full sentences. The chunking logic in `useSpeech.speak` will
    //    split anything longer than ~150 chars into sentence-sized utterances so
    //    truncating here caused long examples to be cut off mid-phrase.
    const MAX_SPEECH_CHARS = 3000;
    if (cleaned.length > MAX_SPEECH_CHARS) {
        cleaned = cleaned.substring(0, MAX_SPEECH_CHARS);
    }

    return cleaned;
}
/**
 * Checks if a word meets the new B2 Beruf standardization criteria.
 * Used for UI indicators (dots/circles) and smart batch updates.
 */
export function isWordStandardized(userWord: UserVocabularyWord): boolean {
    if (!userWord || !userWord.word) return false;
    const word = userWord.word;

    // 1. Basic check: all words should have allTranslations if updated
    if (!word.allTranslations) return false;

    // 2. Synonyms check: mandatory for content words (noun, verb, adjective)
    // UNLESS they have rich meta data (plural, comparative, governance)
    const needsSynonyms = ['noun', 'verb', 'adjective'].includes(word.type);

    // Check for "Rich Meta" which makes a word high-quality even without synonyms
    const hasRichMeta =
        (word.type === 'verb' && ((word as any).governance?.length > 0)) ||
        (word.type === 'noun' && !!(word as any).plural) ||
        (word.type === 'adjective' && !!(word as any).comparative);

    if (needsSynonyms && !hasRichMeta && (!userWord.synonyms || userWord.synonyms.length === 0)) return false;

    // 3. Example check: handle naming inconsistency and fallback to context
    const hasExample = word.type === 'noun'
        ? !!(word as any).exampleSingular || !!(word as any).example || !!userWord.context
        : !!(word as any).example || !!userWord.context;

    if (!hasExample) return false;

    // 4. Word Order (Satzbau) check: if has structure, should ideally have structureExample
    if ((word as any).structure && !(word as any).structureExample) return false;

    // 5. Type-specific checks
    if (word.type === 'verb') {
        const hasGov = (word as any).governance?.length > 0;
        const hasConj = !!(word as any).conjugations || !!(word as any).conjugation;
        // For verbs, either governance OR conjugations makes it rich enough if synonyms are missing
        return hasConj || hasGov;
    }

    if (word.type === 'noun') {
        return !!((word as any).plural && (word as any).article);
    }

    if (word.type === 'adjective') {
        // Некоторые прилагательные (например, "sonstige") не имеют степеней сравнения.
        // Раз слово дошло до этой строчки (значит у него есть пример и синонимы), мы считаем его стандартизированным.
        return true;
    }

    if (word.type === 'preposition') {
        return !!(word as any).case;
    }

    if (word.type === 'conjunction') {
        return !!(word as any).structure;
    }

    // Adverbs and other types are considered standardized if basic checks pass
    return true;
}

export function getRussianType(type: VocabularyWord['type']): string {
    switch (type) {
        case 'noun': return 'Существительное';
        case 'verb': return 'Глагол';
        case 'adjective': return 'Прилагательное';
        case 'conjunction': return 'Союз';
        case 'preposition': return 'Предлог';
        case 'adverb': return 'Наречие';
        case 'other': return 'Частица / Другое';
        default: return type;
    }
}

export function getGermanType(type: VocabularyWord['type']): string {
    switch (type) {
        case 'noun': return 'Nomen';
        case 'verb': return 'Verb';
        case 'adjective': return 'Adjektiv';
        case 'conjunction': return 'Konjunktion';
        case 'preposition': return 'Präposition';
        case 'adverb': return 'Adverb';
        case 'other': return 'Partikel / Sonstiges';
        default: return type;
    }
}
