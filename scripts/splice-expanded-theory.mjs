/**
 * Reads tmp/expanded-theory.json and rewrites src/lib/data.ts so that each
 * matching topic.explanation template literal is replaced with the expanded
 * HTML. Skips topics with no entry in the checkpoint.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../src/lib/data.ts');
const CACHE_PATH = path.resolve(__dirname, '../tmp/expanded-theory.json');

const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
let src = fs.readFileSync(DATA_PATH, 'utf8');

let replaced = 0;
let skipped = 0;
const skippedIds = [];

for (const [topicId, html] of Object.entries(cache)) {
    if (typeof html !== 'string' || html.length < 1500) {
        skipped++;
        skippedIds.push(`${topicId} (short)`);
        continue;
    }
    if (html.includes('`') || html.includes('${')) {
        skipped++;
        skippedIds.push(`${topicId} (unsafe chars)`);
        continue;
    }

    // Find the topic block by `id: '<topicId>'` and replace its explanation backticks.
    // We assume each topic appears exactly once.
    const idMarker = new RegExp(`id:\\s*['"]${topicId.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"]`);
    const idMatch = idMarker.exec(src);
    if (!idMatch) {
        skipped++;
        skippedIds.push(`${topicId} (no id marker)`);
        continue;
    }

    // From the id match, find the next `explanation: \``.
    const tail = src.slice(idMatch.index);
    const explIdx = tail.indexOf('explanation: `');
    if (explIdx === -1) {
        skipped++;
        skippedIds.push(`${topicId} (no explanation field)`);
        continue;
    }
    const absStart = idMatch.index + explIdx + 'explanation: `'.length;

    // Find the matching closing backtick. The HTML doesn't contain backticks
    // (we already checked the cache) but the existing template literal might,
    // although unlikely. Fall back to first backtick after start.
    const closeIdx = src.indexOf('`', absStart);
    if (closeIdx === -1) {
        skipped++;
        skippedIds.push(`${topicId} (unterminated template)`);
        continue;
    }

    src = src.slice(0, absStart) + html + src.slice(closeIdx);
    replaced++;
}

fs.writeFileSync(DATA_PATH, src);
console.log(`[splice] replaced=${replaced}, skipped=${skipped}`);
if (skipped) console.log(`[splice] skipped: ${skippedIds.join(', ')}`);
