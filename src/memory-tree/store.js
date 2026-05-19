import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { SCHEMA } from './schemas.js';

export class MemoryStore {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  init() {
    this.db.exec(SCHEMA);
  }

  // ====== Sources ======

  addSource({ id = randomUUID(), type, name, config = null }) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sources (id, type, name, config) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, type, name, config ? JSON.stringify(config) : null);
    return id;
  }

  getSource(id) {
    return this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  }

  listSources() {
    return this.db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  }

  updateLastFetch(sourceId) {
    this.db.prepare('UPDATE sources SET last_fetch_at = datetime(\'now\') WHERE id = ?').run(sourceId);
  }

  // ====== Ingestion Buffer ======

  ingest(sourceId, items) {
    const insert = this.db.prepare(
      'INSERT INTO ingest_buffer (source_id, raw_content, content_type, source_time) VALUES (?, ?, ?, ?)'
    );
    const count = this.db.transaction(() => {
      let n = 0;
      for (const item of items) {
        insert.run(sourceId, item.content, item.type || 'text', item.time || null);
        n++;
      }
      return n;
    })();
    return count;
  }

  getPendingIngest(limit = 100) {
    return this.db.prepare(
      'SELECT * FROM ingest_buffer WHERE summary IS NULL ORDER BY ingested_at ASC LIMIT ?'
    ).all(limit);
  }

  markIngested(id, summary, chunkCount, tokenCount) {
    this.db.prepare(
      'UPDATE ingest_buffer SET summary = ?, chunk_count = ?, token_count = ? WHERE id = ?'
    ).run(summary, chunkCount, tokenCount, id);
  }

  getUnsummarizedCount() {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM ingest_buffer WHERE summary IS NULL'
    ).get();
    return row.count;
  }

  // ====== Tree Nodes ======

  upsertNode({ id = randomUUID(), sourceId, parentId, level, title, summary, tokenCount, itemCount, startTime, endTime, metadata }) {
    const existing = parentId ? this.db.prepare(
      'SELECT id FROM tree_nodes WHERE source_id = ? AND level = ? AND parent_id = ? AND start_time = ?'
    ).get(sourceId, level, parentId, startTime) : null;

    const nodeId = existing ? existing.id : id;

    this.db.prepare(`
      INSERT INTO tree_nodes (id, source_id, parent_id, level, title, summary, token_count, item_count, start_time, end_time, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = COALESCE(?, summary),
        item_count = COALESCE(?, item_count),
        end_time = COALESCE(?, end_time),
        token_count = COALESCE(?, token_count),
        updated_at = datetime('now')
    `).run(
      nodeId, sourceId || null, parentId || null, level, title,
      summary || null, tokenCount || 0, itemCount || 0,
      startTime || null, endTime || null,
      metadata ? JSON.stringify(metadata) : null,
      summary || null, itemCount || 0, endTime || null, tokenCount || 0
    );

    if (parentId) {
      this.db.prepare(
        'INSERT OR IGNORE INTO tree_edges (parent_id, child_id) VALUES (?, ?)'
      ).run(parentId, nodeId);
    }

    return nodeId;
  }

  getNode(id) {
    return this.db.prepare('SELECT * FROM tree_nodes WHERE id = ?').get(id);
  }

  getChildren(parentId) {
    return this.db.prepare(`
      SELECT n.* FROM tree_nodes n
      JOIN tree_edges e ON n.id = e.child_id
      WHERE e.parent_id = ?
      ORDER BY n.start_time DESC
    `).all(parentId);
  }

  getTree(sourceId, level = 'root') {
    if (level === 'root') {
      const root = this.db.prepare(
        'SELECT * FROM tree_nodes WHERE source_id = ? AND level = ?'
      ).get(sourceId, 'root');
      return root ? this.buildTree(root) : null;
    }
    const nodes = this.db.prepare(
      'SELECT * FROM tree_nodes WHERE source_id = ? AND level = ? ORDER BY start_time DESC'
    ).all(sourceId, level);
    return nodes;
  }

  buildTree(node) {
    const children = this.getChildren(node.id).map(child => this.buildTree(child));
    return { ...node, children };
  }

  getFullTree(sourceId) {
    const roots = this.db.prepare(
      'SELECT * FROM tree_nodes WHERE source_id = ? AND parent_id IS NULL ORDER BY start_time DESC'
    ).all(sourceId);
    return roots.map(r => this.buildTree(r));
  }

  getNodesByTimeRange(sourceId, start, end, level) {
    let query = 'SELECT * FROM tree_nodes WHERE source_id = ?';
    const params = [sourceId];

    if (start) { query += ' AND start_time >= ?'; params.push(start); }
    if (end) { query += ' AND end_time <= ?'; params.push(end); }
    if (level) { query += ' AND level = ?'; params.push(level); }

    query += ' ORDER BY start_time DESC';
    return this.db.prepare(query).all(...params);
  }

  // ====== Sync Log ======

  logSync({ sourceId, status, itemsFetched, itemsIngested, error = null }) {
    this.db.prepare(
      'INSERT INTO sync_log (source_id, status, items_fetched, items_ingested, error) VALUES (?, ?, ?, ?, ?)'
    ).run(sourceId || null, status, itemsFetched, itemsIngested, error);
  }

  getSyncLog(sourceId, limit = 20) {
    if (sourceId) {
      return this.db.prepare(
        'SELECT * FROM sync_log WHERE source_id = ? ORDER BY synced_at DESC LIMIT ?'
      ).all(sourceId, limit);
    }
    return this.db.prepare(
      'SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT ?'
    ).all(limit);
  }

  // ====== Stats ======

  getStats() {
    const sources = this.db.prepare('SELECT COUNT(*) as count FROM sources').get();
    const pending = this.db.prepare('SELECT COUNT(*) as count FROM ingest_buffer WHERE summary IS NULL').get();
    const nodes = this.db.prepare('SELECT COUNT(*) as count FROM tree_nodes').get();
    const synced = this.db.prepare('SELECT COUNT(*) as count FROM ingest_buffer WHERE summary IS NOT NULL').get();
    const lastSync = this.db.prepare('SELECT MAX(synced_at) as last FROM sync_log').get();

    return {
      sources: sources.count,
      pendingIngest: pending.count,
      treeNodes: nodes.count,
      ingestedItems: synced.count,
      lastSync: lastSync.last || 'never'
    };
  }

  close() {
    this.db.close();
  }
}
