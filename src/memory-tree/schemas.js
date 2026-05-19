export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_fetch_at TEXT
);

CREATE TABLE IF NOT EXISTS ingest_buffer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',
  summary TEXT,
  chunk_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_time TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS tree_nodes (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  parent_id TEXT,
  level TEXT NOT NULL CHECK(level IN ('raw','hour','day','week','month','year','root')),
  title TEXT NOT NULL,
  summary TEXT,
  token_count INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (parent_id) REFERENCES tree_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON tree_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_level ON tree_nodes(level);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_source ON tree_nodes(source_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_time ON tree_nodes(start_time);
CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingest_buffer(source_id);

CREATE TABLE IF NOT EXISTS tree_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  UNIQUE(parent_id, child_id),
  FOREIGN KEY (parent_id) REFERENCES tree_nodes(id),
  FOREIGN KEY (child_id) REFERENCES tree_nodes(id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','partial','failed')),
  items_fetched INTEGER DEFAULT 0,
  items_ingested INTEGER DEFAULT 0,
  error TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
