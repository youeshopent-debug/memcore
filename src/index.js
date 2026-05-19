import { MemoryStore } from './memory-tree/store.js';
import { MemoryEngine } from './memory-tree/engine.js';
import { ObsidianVault } from './memory-tree/vault.js';
import { ModelRouter } from './model-router.js';
import { AutoFetch } from './auto-fetch.js';
import { reduce, countTokens } from './tokenjuice/reduce.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'memory.db');
const VAULT_PATH = join(__dirname, '..', 'vault');

const store = new MemoryStore(DB_PATH);
const llm = new ModelRouter();
const engine = new MemoryEngine(store, llm);
const af = new AutoFetch(store, engine);
const vault = new ObsidianVault(VAULT_PATH);

const INTERVAL = 5 * 60 * 1000;

async function run() {
  console.log(`[MemCore] daemon started | interval: ${INTERVAL}ms`);

  if (store.listSources().length === 0) {
    const id = store.addSource({ type: 'web', name: 'default' });
    console.log(`[MemCore] created default source: ${id}`);
  }

  const loop = async () => {
    try {
      const result = await af.runOnce();
      if (result) {
        console.log(`[MemCore] cycle done | fetched: ${result.fetched}, errors: ${result.errors}`);
      }
    } catch (err) {
      console.error(`[MemCore] cycle error: ${err.message}`);
    }
  };

  await loop();
  setInterval(loop, INTERVAL);
}

run();

export { MemoryStore, MemoryEngine, ObsidianVault, ModelRouter, AutoFetch, reduce, countTokens };
