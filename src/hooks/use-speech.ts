'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { cleanTextForSpeech } from '@/lib/german-utils';

export type VoiceGender = 'male' | 'female';

export function useSpeech() {
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);
    const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

    useEffect(() => {
        const updateVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                setVoices(availableVoices);
                voicesRef.current = availableVoices;
                setIsLoaded(true);
            }
        };

        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = updateVoices;
            updateVoices();
        }

        return () => {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = null;
            }
        };
    }, []);

    // Keep a reference to the active utterance to prevent garbage collection
    const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const sequenceIdRef = useRef<number>(0);

    const stop = useCallback(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            // Aggressive reset: resume before cancel to un-jam the engine for Chromium
            // If the state was paused, cancel() does nothing until resume() is called
            window.speechSynthesis.resume();
            window.speechSynthesis.cancel();
            
            sequenceIdRef.current++; // Cancel any running sequence loop
            setIsSpeaking(false);
            activeUtteranceRef.current = null;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    const speak = useCallback(async (text: string, lang: string = 'de-DE', gender?: VoiceGender, cancelFirst = true) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return;
        }

        const cleanedText = cleanTextForSpeech(text);
        if (!cleanedText) return;

        // CHUNKING LOGIC: If text is long, split by sentence-like boundaries and speak them sequentially.
        // Browser TTS engines (esp. Chromium) become unreliable on very long utterances, so we prefer
        // many short utterances over one big one.
        if (cleanedText.length > 150) {
            const rawChunks = cleanedText.match(/[^.!?…\n;]+[.!?…\n;]*/g) || [cleanedText];
            const chunks = rawChunks.map(c => c.trim()).filter(Boolean);
            if (chunks.length > 1) {
                if (cancelFirst) stop();
                const currentId = sequenceIdRef.current;

                for (const chunk of chunks) {
                    // Stop if a new speak or stop operation started
                    if (sequenceIdRef.current !== currentId) break;

                    await speak(chunk, lang, gender, false);
                    await new Promise(r => setTimeout(r, 150));
                }
                return;
            }
        }

        return new Promise<void>((resolve) => {
            if (cancelFirst) {
                // Aggressive reset sequence to clear any stuck state
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
            }

            const utterance = new SpeechSynthesisUtterance(cleanedText);
            activeUtteranceRef.current = utterance;

            utterance.lang = lang;
            utterance.rate = 0.9;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            const currentVoices = voicesRef.current;
            const langVoices = currentVoices.filter(v => v.lang.startsWith(lang.split('-')[0]));
            let targetVoice: SpeechSynthesisVoice | undefined;

            if (langVoices.length > 0) {
                if (gender) {
                    const maleKeywords = ['male', 'markus', 'stefan', 'paul', 'klaus', 'david', 'conrad', 'microsoft stefan'];
                    const femaleKeywords = ['female', 'anna', 'katja', 'hedda', 'steffi', 'zira', 'amy', 'elke', 'microsoft elena', 'microsoft irina'];
                    const ruExcludes = ['pavel', 'yuri', 'alexander', 'desktop'];

                    if (gender === 'male') {
                        targetVoice = langVoices.find(v => {
                            const name = v.name.toLowerCase();
                            const matchesMale = maleKeywords.some(k => name.includes(k));
                            const isRuShaky = lang.startsWith('ru') && ruExcludes.some(e => name.includes(e));
                            return matchesMale && !name.includes('female') && !isRuShaky;
                        });

                        if (!targetVoice) {
                            targetVoice = langVoices.find(v => !femaleKeywords.some(k => v.name.toLowerCase().includes(k)));
                        }
                    } else {
                        targetVoice = langVoices.find(v => femaleKeywords.some(k => v.name.toLowerCase().includes(k)));
                    }
                }

                if (!targetVoice) {
                    if (lang.startsWith('ru')) {
                        const ruPriority = ['microsoft elena', 'microsoft irina', 'google', 'premium', 'milena', 'katya', 'irina'];
                        const ruExcludes = ['pavel', 'yuri', 'alexander', 'desktop'];

                        for (const p of ruPriority) {
                            targetVoice = langVoices.find(v => v.name.toLowerCase().includes(p) && !ruExcludes.some(e => v.name.toLowerCase().includes(e)));
                            if (targetVoice) break;
                        }

                        if (!targetVoice) {
                            targetVoice = langVoices.find(v => !ruExcludes.some(e => v.name.toLowerCase().includes(e)));
                        }
                    } else {
                        targetVoice = langVoices.find(v => v.name.includes('Google') || v.name.includes('Premium'));
                    }
                }

                if (!targetVoice) targetVoice = langVoices[0];
                if (targetVoice) utterance.voice = targetVoice;
            }

            let backupTimeout: NodeJS.Timeout;
            let resumeInterval: NodeJS.Timeout;

            utterance.onstart = () => {
                setIsSpeaking(true);
                // Windows Chromium Fix: Periodically call resume() to prevent the engine from pausing on long text
                resumeInterval = setInterval(() => {
                    if (window.speechSynthesis.speaking) {
                        window.speechSynthesis.pause();
                        window.speechSynthesis.resume();
                    }
                }, 10000);
            };
            
            utterance.onend = () => {
                clearTimeout(backupTimeout);
                clearInterval(resumeInterval);
                if (activeUtteranceRef.current === utterance) activeUtteranceRef.current = null;
                setIsSpeaking(false);
                resolve();
            };
            
            utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
                clearTimeout(backupTimeout);
                clearInterval(resumeInterval);
                if (e.error !== 'canceled' && e.error !== 'interrupted') {
                    console.error("Speech error", e.error, e);
                    // Critical reset on error
                    window.speechSynthesis.resume();
                    window.speechSynthesis.cancel();
                }
                if (activeUtteranceRef.current === utterance) activeUtteranceRef.current = null;
                setIsSpeaking(false);
                resolve();
            };

            const timeoutDuration = Math.max(7000, text.length * 150); // Slightly more generous timeout
            backupTimeout = setTimeout(() => {
                if (activeUtteranceRef.current === utterance) {
                    console.warn("Speech onend timed out, forcing reset");
                    clearInterval(resumeInterval);
                    activeUtteranceRef.current = null;
                    setIsSpeaking(false);
                    if (typeof window !== 'undefined' && window.speechSynthesis) {
                        window.speechSynthesis.resume(); // Ensure we are not paused
                        window.speechSynthesis.cancel();
                    }
                    resolve();
                }
            }, timeoutDuration);

            // Safety delay: 150ms gap before actual speak call 
            // This is increased to ensure the browser has actually finished the cancel() async operation
            setTimeout(() => {
                if (typeof window !== 'undefined' && window.speechSynthesis) {
                    // One last check: if we are still 'speaking' but no audio, then we were stuck
                    if (window.speechSynthesis.speaking && cancelFirst) {
                        window.speechSynthesis.cancel();
                    }
                    window.speechSynthesis.speak(utterance);
                }
            }, 150);
        });
    }, [stop]);

    const speakSequence = useCallback(async (items: { text: string, lang: string }[]) => {
        // Stop any currently running speech and increment sequence ID
        stop();
        const currentSequenceId = sequenceIdRef.current;

        for (const item of items) {
            // Check if we should abort this sequence
            if (sequenceIdRef.current !== currentSequenceId) break;

            await speak(item.text, item.lang, undefined, false);

            if (sequenceIdRef.current !== currentSequenceId) break;

            // Slight pause between items in sequence
            await new Promise(r => setTimeout(r, 400));
        }
    }, [speak, stop]);

    return { speak, speakSequence, stop, isSpeaking, voices, isLoaded };
}
