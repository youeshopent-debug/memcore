import { reduce, countTokens } from './tokenjuice/reduce.js';

export class AutoFetch {
  constructor(store, engine) {
    this.store = store;
    this.engine = engine;
    this.running = false;
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;

    try {
      const sources = this.store.listSources();
      let totalFetched = 0;
      let totalErrors = 0;

      for (const source of sources) {
        if (!source.config) continue;

        let config;
        try {
          config = JSON.parse(source.config);
        } catch {
          continue;
        }
        if (!config.url) continue;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(config.url, { signal: controller.signal });
          clearTimeout(timer);

          if (!res.ok) {
            this.store.logSync({
              sourceId: source.id,
              status: 'failed',
              itemsFetched: 0,
              itemsIngested: 0,
              error: `HTTP ${res.status}`
            });
            totalErrors++;
            continue;
          }

          const html = await res.text();
          const reduced = reduce(html, { type: 'html' });

          const count = this.engine.ingestRaw(source.id, [{ content: reduced, type: 'text' }]);
          this.store.updateLastFetch(source.id);
          this.store.logSync({
            sourceId: source.id,
            status: 'success',
            itemsFetched: 1,
            itemsIngested: count
          });

          totalFetched++;
        } catch (err) {
          this.store.logSync({
            sourceId: source.id,
            status: 'failed',
            itemsFetched: 0,
            itemsIngested: 0,
            error: err.message
          });
          totalErrors++;
        }
      }

      const pending = this.store.getUnsummarizedCount();
      if (pending > 50) {
        const result = await this.engine.runSummarization();
        console.log(`[AutoFetch] Summarized: ${JSON.stringify(result)}`);
      }

      return { fetched: totalFetched, errors: totalErrors };
    } finally {
      this.running = false;
    }
  }
}
