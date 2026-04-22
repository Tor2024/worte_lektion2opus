import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Initialize keys array
let keys: string[] = [];

// 1. Get keys from the main comma-separated variable
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
if (rawKeys) {
  keys.push(...rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0));
}

// 2. Get keys from indexed variables GEMINI_API_KEY_1 to GEMINI_API_KEY_50
for (let i = 1; i <= 50; i++) {
  const k = process.env[`GEMINI_API_KEY_${i}`];
  if (k && k.trim()) {
    keys.push(k.trim());
  }
}

// 3. Remove duplicates
keys = Array.from(new Set(keys));

if (keys.length > 0) {
  console.log(`[AI] Loaded ${keys.length} unique Gemini API keys.`);
} else {
  console.error("[AI] No Gemini API keys found in environment variables!");
}

// Unified pool using the only working model (2.5-flash) across all keys
const aiInstances = keys.map((apiKey, idx) => {
  try {
    return genkit({
      plugins: [googleAI({ apiKey })],
      model: 'googleai/gemini-2.5-flash',
    });
  } catch (e) {
    console.error(`[AI] Failed to initialize instance for key at index ${idx}`);
    return null;
  }
}).filter((instance): instance is NonNullable<typeof instance> => instance !== null);

// Export primary instances - with safety proxy to prevent boot-time crashes when keys are missing
const primaryAi = aiInstances[0];

if (!primaryAi) {
  console.warn('[AI] WARNING: No API keys found! Gemini will not work. Check GEMINI_API_KEY environment variable.');
} else {
  console.log(`[AI] SUCCESS: Initialized pool with ${aiInstances.length} Gemini instances.`);
}

export const ai = new Proxy({} as any, {
  get(target, prop) {
    if (prop === 'isInitialized') return !!primaryAi;
    if (prop === 'instancesCount') return aiInstances.length;
    
    if (!primaryAi) {
      // Return a function that throws if they try to call something
      return (...args: any[]) => {
        throw new Error(`[AI] Attempted to use '${String(prop)}' but Genkit was not initialized. Check your GEMINI_API_KEY environment variables in Vercel.`);
      };
    }
    return (primaryAi as any)[prop];
  }
});

export const aiStable = ai;

/**
 * Detects whether an error from Google GenAI/Genkit is actually a rate-limit / quota
 * exhaustion, as opposed to some other error whose message happens to contain the
 * word "quota" (e.g. our own fallback strings). Tightening this check avoids
 * false-positive "AI limit exceeded" messages in the UI.
 */
export const isGoogleAIRateLimitError = (error: any): boolean => {
  if (!error) return false;
  const status =
    error.status ||
    error.code ||
    (error.response ? error.response.status : null);
  if (status === 429) return true;

  const rawMsg: string = error.message || String(error) || '';
  // Only trust explicit Google API markers, not generic occurrences of "quota".
  return (
    /\b429\b/.test(rawMsg) ||
    /RESOURCE_EXHAUSTED/i.test(rawMsg) ||
    /rateLimitExceeded/i.test(rawMsg) ||
    /quotaExceeded/i.test(rawMsg) ||
    /quota exceeded/i.test(rawMsg) ||
    /too many requests/i.test(rawMsg)
  );
};

/**
 * Executes an AI operation with aggressive round-robin retries across all available keys.
 */
export const executeWithRetry = async <T>(
  operation: (aiInstance: any) => Promise<T>
): Promise<T> => {
  if (aiInstances.length === 0) {
    throw new Error("No Genkit instances available. Please check your environment variables.");
  }

  // Optimize attempts: try every available key once, capped at 8 to prevent long hangs.
  // Previously this was capped at 5 even when more keys existed, which could make
  // transient errors look like "limits exceeded" when they were just bad luck.
  const MAX_ATTEMPTS = Math.min(aiInstances.length, 8);
  let lastError: any;

  // Start at a random key to distribute load
  const startOffset = Math.floor(Math.random() * aiInstances.length);
  console.log(`[AI] Starting operation using pool of ${aiInstances.length} keys (start index: ${startOffset}), max attempts: ${MAX_ATTEMPTS}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const index = (startOffset + attempt) % aiInstances.length;
    const instance = aiInstances[index];

    try {
      if (attempt > 0) console.log(`[AI] Retry attempt ${attempt} using key #${index}...`);
      return await operation(instance);
    } catch (error: any) {
      lastError = error;
      const msg = error.message || '';
      const status = error.status || (error.response ? error.response.status : null);

      console.error(`[AI] Key #${index} failed with error (status: ${status}):`, msg.substring(0, 200));

      // 400 Bad Request, Validation/Parse Errors. No point in retrying across keys.
      if (status === 400 || /parse/i.test(msg) || /validation/i.test(msg) || /schema/i.test(msg)) {
        throw error;
      }

      // Real rate-limit / quota error: rotate instantly to the next key.
      if (isGoogleAIRateLimitError(error)) {
        console.warn(`[AI] Key #${index} hit real quota/rate-limit (429/RESOURCE_EXHAUSTED). Rotating to next available key...`);
        continue;
      }

      // For 503 or transient errors, short wait. If it's the last attempt, don't wait.
      if (attempt < MAX_ATTEMPTS - 1) {
        // Short exponential backoff, max 2 seconds per wait (so we don't hang for 1.5 minutes)
        const waitTime = Math.min(500 * Math.pow(2, attempt), 2000);
        console.log(`[AI] Waiting ${waitTime}ms before next attempt...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
    }
  }

  console.error(`[AI] Operation failed after ${MAX_ATTEMPTS} attempts.`);
  throw lastError || new Error("All available AI keys failed.");
};

export const executeWithRetryStable = executeWithRetry;
