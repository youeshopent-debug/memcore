import { MemoryStore } from './src/memory-tree/store.js';
import { MemoryEngine } from './src/memory-tree/engine.js';
import { ModelRouter } from './src/model-router.js';
import { reduce, countTokens } from './src/tokenjuice/reduce.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const store = new MemoryStore(join(__dirname, 'data', 'memory.db'));
const llm = new ModelRouter();
const engine = new MemoryEngine(store, llm);

const URLS = [
  'https://www.example.com',
  'https://httpbin.org/html',
  'https://www.example.com',
  'https://httpbin.org/robots.txt',
  'https://httpbin.org/headers',
];

const NUM_BATCHES = 5;

async function fetchUrl(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const html = await resp.text();
    return {
      content: html,
      type: 'html',
      time: new Date().toISOString(),
      html: true
    };
  } catch (err) {
    return null;
  }
}

async function stressTest() {
  console.log('='.repeat(50));
  console.log('MEMCORE STRESS TEST');
  console.log('='.repeat(50));
  const results = { ok: 0, fail: 0, bytes: 0, tokens: 0 };

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    console.log(`\n--- Batch ${batch + 1}/${NUM_BATCHES} (${URLS.length} URLs) ---`);

    const jobs = URLS.map(url => fetchUrl(url));
    const fetched = (await Promise.allSettled(jobs)).filter(r => r.status === 'fulfilled').map(r => r.value);
    const valid = fetched.filter(r => r !== null);
    results.ok += valid.length;
    results.fail += (URLS.length - valid.length);

    for (const item of valid) {
      results.bytes += item.content.length;
      results.tokens += countTokens(item.content);
    }

    if (valid.length > 0) {
      engine.ingestRaw('dd04dc66-1887-49aa-8191-4c7207463f53', valid);
      console.log(`  ingested ${valid.length} items, ${results.tokens} tokens so far`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(50));
  console.log('FETCH RESULTS');
  console.log('='.repeat(50));
  console.log(`  Total requests:    ${NUM_BATCHES * URLS.length}`);
  console.log(`  Successful:        ${results.ok}`);
  console.log(`  Failed:            ${results.fail}`);
  console.log(`  Total bytes:       ${(results.bytes / 1024).toFixed(1)} KB`);
  console.log(`  Total tokens:      ${results.tokens.toLocaleString()}`);

  console.log('\n' + '='.repeat(50));
  console.log('DB STATUS BEFORE SUMMARIZE');
  console.log('='.repeat(50));
  const stats = store.db.prepare(`SELECT
    (SELECT COUNT(*) FROM sources) AS sources,
    (SELECT COUNT(*) FROM ingest_buffer) AS buffer,
    (SELECT COUNT(*) FROM ingest_buffer WHERE summary IS NOT NULL) AS ingested,
    (SELECT COUNT(*) FROM tree_nodes) AS tree_nodes
  `).get();
  console.log(stats);

  let summary;
  try {
    summary = await engine.runSummarization();
  } catch (e) {
    summary = { summarized: 0, error: e.message };
  }
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARIZE RESULT');
  console.log('='.repeat(50));
  console.log(summary);

  const final = store.db.prepare(`SELECT
    (SELECT COUNT(*) FROM sources) AS sources,
    (SELECT COUNT(*) FROM tree_nodes) AS tree_nodes,
    (SELECT COUNT(*) FROM ingest_buffer WHERE summary IS NOT NULL) AS ingested,
    (SELECT COUNT(*) FROM ingest_buffer WHERE summary IS NULL) AS pending
  `).get();
  console.log('\n' + '='.repeat(50));
  console.log('FINAL DB STATUS');
  console.log('='.repeat(50));
  console.log(final);

  const tree = store.db.prepare('SELECT id, level, title, item_count FROM tree_nodes ORDER BY level').all();
  console.log('\n--- Memory Tree ---');
  console.log(`  ${tree.length} nodes:`);
  for (const n of tree) {
    console.log(`  [${n.level}] ${n.title} (${n.item_count} items)`);
  }

  console.log('\nSTRESS TEST COMPLETE');
  process.exit(0);
}

stressTest().catch(err => {
  console.error('STRESS TEST FAILED:', err);
  process.exit(1);
});
