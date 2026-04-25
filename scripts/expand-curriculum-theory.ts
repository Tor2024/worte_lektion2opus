/**
 * One-off content fill: for each topic in A0–B2 of the static curriculum,
 * call the same `expand-theory` Gemini flow that the topic page uses on
 * demand and store the expanded HTML to a JSON checkpoint file. A separate
 * splice script then bakes the results back into `src/lib/data.ts`.
 *
 * Run with: `npx tsx scripts/expand-curriculum-theory.ts`
 *
 * Resumable: re-running skips topic ids already present in the checkpoint
 * (delete the JSON file to force regeneration of a level).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { curriculum } from '../src/lib/data';
import { expandTheoryWithAI } from '../src/ai/flows/expand-theory';

const TARGET_LEVELS = new Set(['a0', 'a1', 'a2', 'b1', 'b2']);
const CHECKPOINT = path.resolve(__dirname, '../tmp/expanded-theory.json');

function loadCheckpoint(): Record<string, string> {
    try {
        if (!fs.existsSync(CHECKPOINT)) return {};
        const raw = fs.readFileSync(CHECKPOINT, 'utf8');
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
    } catch {
        return {};
    }
}

function saveCheckpoint(data: Record<string, string>) {
    fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
    fs.writeFileSync(CHECKPOINT, JSON.stringify(data, null, 2));
}

async function main() {
    const checkpoint = loadCheckpoint();
    const tasks: { id: string; title: string; brief: string }[] = [];
    for (const lvl of curriculum.levels) {
        if (!TARGET_LEVELS.has(lvl.id.toLowerCase())) continue;
        for (const topic of lvl.topics || []) {
            tasks.push({ id: topic.id, title: topic.title, brief: topic.explanation });
        }
    }
    const todo = tasks.filter(t => !checkpoint[t.id] || checkpoint[t.id].length < 1500);
    console.log(`[expand] ${tasks.length} topics total, ${tasks.length - todo.length} cached, ${todo.length} to generate.`);

    const CONCURRENCY = 2;
    const PER_CALL_DELAY_MS = 6000;
    let cursor = 0;
    let done = 0;
    const total = todo.length;

    async function worker(workerId: number) {
        // Stagger workers so they don't fire at the same moment.
        await new Promise(r => setTimeout(r, workerId * 1500));
        while (true) {
            const idx = cursor++;
            if (idx >= total) return;
            const t = todo[idx];
            const start = Date.now();
            try {
                const expanded = await expandTheoryWithAI(t.title, t.brief);
                if (typeof expanded !== 'string' || expanded.length < 800) {
                    done++;
                    console.log(`[${done}/${total}] (w${workerId}) ${t.id} SHORT (${expanded?.length ?? 0} chars)`);
                } else {
                    checkpoint[t.id] = expanded;
                    saveCheckpoint(checkpoint);
                    done++;
                    const ms = Date.now() - start;
                    console.log(`[${done}/${total}] (w${workerId}) ${t.id} ok (${expanded.length} chars, ${ms}ms)`);
                }
            } catch (e: any) {
                done++;
                const msg = (e && e.message) || String(e);
                console.log(`[${done}/${total}] (w${workerId}) ${t.id} FAIL: ${msg.substring(0, 160)}`);
            }
            // Pace each worker to stay under the per-key per-minute quota.
            await new Promise(r => setTimeout(r, PER_CALL_DELAY_MS));
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, (_, i) => worker(i + 1)));
    console.log(`[expand] done. cached=${Object.keys(checkpoint).length}`);
}

main().catch(e => {
    console.error('[expand] fatal:', e);
    process.exit(1);
});
