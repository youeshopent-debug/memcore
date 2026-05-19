import { randomUUID } from 'crypto';
import { reduce, countTokens } from '../tokenjuice/reduce.js';

const SUMMARIZATION_TEMP = 0.3;

export class MemoryEngine {
  constructor(store, llmProvider) {
    this.store = store;
    this.llm = llmProvider;
  }

  ingestRaw(sourceId, items) {
    const compressed = items.map(item => ({
      ...item,
      content: reduce(item.content, { type: item.html ? 'html' : 'text' })
    }));
    return this.store.ingest(sourceId, compressed);
  }

  async runSummarization() {
    const pending = this.store.getPendingIngest(50);
    if (pending.length === 0) return { summarized: 0, message: 'No pending items' };

    const byHour = this.groupByHour(pending);
    let summarized = 0;

    for (const [hourKey, items] of Object.entries(byHour)) {
      const sourceId = items[0].source_id;
      const source = this.store.getSource(sourceId);
      if (!source) continue;

      const combined = items.map(i => i.raw_content).join('\n\n---\n\n');
      const reduced = reduce(combined);
      const title = `${source.name} - ${hourKey}`;

      const hourNodeId = await this.summarizeAndStore({
        sourceId,
        level: 'hour',
        title,
        content: reduced,
        itemCount: items.length,
        startTime: hourKey,
        endTime: hourKey.replace(/:00$/, ':59'),
        parentId: null
      });

      for (const item of items) {
        const rawTokens = countTokens(item.raw_content);
        this.store.markIngested(item.id, hourNodeId, 1, rawTokens);
      }

      summarized += items.length;
    }

    await this.propagateUp();

    return { summarized, message: `Summarized ${summarized} items into hour nodes` };
  }

  async summarizeAndStore({ sourceId, level, title, content, itemCount, startTime, endTime, parentId }) {
    const summary = await this.summarize(content, level);

    const nodeId = this.store.upsertNode({
      id: randomUUID(),
      sourceId,
      parentId,
      level,
      title,
      summary,
      tokenCount: countTokens(summary),
      itemCount,
      startTime,
      endTime
    });

    return nodeId;
  }

  async propagateUp() {
    const levels = ['hour', 'day', 'week', 'month', 'year', 'root'];

    for (let i = 0; i < levels.length - 1; i++) {
      const currentLevel = levels[i];
      const nextLevel = levels[i + 1];

      const orphanNodes = this.store.db.prepare(`
        SELECT n.* FROM tree_nodes n
        LEFT JOIN tree_edges e ON n.id = e.child_id
        WHERE n.level = ? AND e.id IS NULL
        AND n.parent_id IS NULL
      `).all(currentLevel);

      const byPeriod = this.groupByPeriod(orphanNodes, nextLevel);

      for (const [periodKey, nodes] of Object.entries(byPeriod)) {
        const sourceId = nodes[0].source_id;
        const source = this.store.getSource(sourceId);
        if (!source) continue;

        const existingParent = this.store.db.prepare(
          'SELECT id FROM tree_nodes WHERE source_id = ? AND level = ? AND start_time = ?'
        ).get(sourceId, nextLevel, periodKey);

        let parentId;
        if (existingParent) {
          parentId = existingParent.id;
        } else {
          const summaries = nodes.map(n => n.summary).filter(Boolean);
          const combined = summaries.join('\n\n---\n\n');
          const reduced = reduce(combined);
          const summaryText = summaries.length > 1
            ? await this.summarize(reduced, nextLevel)
            : summaries[0];

          const startTimes = nodes.map(n => n.start_time).filter(Boolean).sort();
          const endTimes = nodes.map(n => n.end_time).filter(Boolean).sort();

          parentId = this.store.upsertNode({
            id: randomUUID(),
            sourceId,
            parentId: null,
            level: nextLevel,
            title: `${source.name} - ${periodKey}`,
            summary: summaryText,
            tokenCount: countTokens(summaryText),
            itemCount: nodes.length,
            startTime: startTimes[0],
            endTime: endTimes[endTimes.length - 1]
          });
        }

        for (const node of nodes) {
          this.store.db.prepare(
            'UPDATE tree_nodes SET parent_id = ? WHERE id = ?'
          ).run(parentId, node.id);

          this.store.db.prepare(
            'INSERT OR IGNORE INTO tree_edges (parent_id, child_id) VALUES (?, ?)'
          ).run(parentId, node.id);
        }

        this.rebuildParentSummary(parentId);
      }
    }
  }

  rebuildParentSummary(parentId) {
    const children = this.store.getChildren(parentId);
    const summaries = children.map(c => c.summary).filter(Boolean);
    if (summaries.length === 0) return;

    const parent = this.store.getNode(parentId);
    if (!parent) return;

    const combined = summaries.join('\n\n---\n\n');
    this.store.db.prepare(
      'UPDATE tree_nodes SET summary = ?, item_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(combined, summaries.length, parentId);
  }

  async summarize(content, level) {
    if (!content || content.trim().length === 0) return '(empty)';

    const tokens = countTokens(content);
    if (tokens < 100) return content.trim();

    const prompt = this.buildSummaryPrompt(content, level);

    try {
      const result = await this.llm.generate(prompt, {
        temperature: SUMMARIZATION_TEMP,
        maxTokens: Math.min(Math.ceil(tokens / 3), 2048)
      });
      return result.trim();
    } catch (err) {
      const fallback = content.slice(0, 3000).trim();
      return fallback || '(summary failed)';
    }
  }

  buildSummaryPrompt(content, level) {
    const levelLabels = {
      hour: 'an hourly activity',
      day: 'a daily digest',
      week: 'a weekly summary',
      month: 'a monthly report',
      year: 'a yearly overview',
      root: 'a top-level knowledge base entry'
    };

    const label = levelLabels[level] || 'a summary';

    return `You are a data compression engine. Create ${label} from the following data.

Rules:
- Output ONLY clean Markdown
- Maximum 3000 tokens
- Extract key facts, decisions, and action items
- Group related information
- Preserve dates, numbers, and names
- Use bullet points for lists
- Omit: greetings, pleasantries, redundant metadata

Content to summarize:

${content.slice(0, 15000)}`;
  }

  groupByHour(items) {
    const groups = {};
    for (const item of items) {
      const time = item.source_time || item.ingested_at;
      const hour = time.slice(0, 13) + ':00:00';
      if (!groups[hour]) groups[hour] = [];
      groups[hour].push(item);
    }
    return groups;
  }

  groupByPeriod(nodes, level) {
    const groups = {};
    for (const node of nodes) {
      let key;
      switch (level) {
        case 'day': key = node.start_time ? node.start_time.slice(0, 10) : 'unknown'; break;
        case 'week': key = node.start_time ? this.getWeekKey(node.start_time) : 'unknown'; break;
        case 'month': key = node.start_time ? node.start_time.slice(0, 7) : 'unknown'; break;
        case 'year': key = node.start_time ? node.start_time.slice(0, 4) : 'unknown'; break;
        default: key = 'unknown';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(node);
    }
    return groups;
  }

  getWeekKey(dateStr) {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().slice(0, 10);
  }
}
