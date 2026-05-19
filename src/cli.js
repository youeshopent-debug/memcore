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
const vault = new ObsidianVault(VAULT_PATH);

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  switch (cmd) {
    case 'status':
      return cmdStatus();

    case 'source':
      return cmdSource(args);

    case 'ingest':
      return cmdIngest(args);

    case 'summarize':
      return cmdSummarize();

    case 'tree':
      return cmdTree(args);

    case 'export':
      return cmdExport(args);

    case 'fetch':
      return cmdFetch(args);

    case 'chat':
      return cmdChat(args);

    case 'tokenjuice':
      return cmdTokenJuice(args);

    case 'auto-fetch':
      return cmdAutoFetch(args);

    default:
      showHelp();
  }
}

function showHelp() {
  console.log(`
MemCore - Memory Tree + TokenJuice + Model Router

Usage:
  memcore status                    Show database stats
  memcore source add <name> <type>  Add a data source
  memcore source list               List sources
  memcore ingest <sourceId>         Ingest text from stdin
  memcore summarize                 Run summarization pipeline
  memcore tree <sourceId>           Show memory tree
  memcore export <sourceId>         Export to Obsidian vault
  memcore fetch <sourceId> <url>    Fetch a URL and ingest content
  memcore chat <sourceId>           Interactive Q&A with memory
  memcore tokenjuice <text>         Token reduction estimate
  memcore auto-fetch <intervalMs>   Start auto-fetch loop
  `);
}

async function cmdStatus() {
  const stats = store.getStats();
  console.log(JSON.stringify(stats, null, 2));
}

async function cmdSource(args) {
  const sub = args[0];
  if (sub === 'add') {
    const name = args[1];
    const type = args[2] || 'web';
    if (!name) { console.error('Usage: memcore source add <name> [type]'); return; }
    const id = store.addSource({ type, name });
    console.log(`Source created: ${id}`);
    return;
  }
  if (sub === 'list') {
    const sources = store.listSources();
    console.log(JSON.stringify(sources, null, 2));
    return;
  }
  console.error('Usage: memcore source add/list');
}

async function cmdIngest(args) {
  const sourceId = args[0];
  if (!sourceId) { console.error('Usage: memcore ingest <sourceId>'); return; }

  let content = '';
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString('utf-8');
  }

  if (!content || content.trim().length === 0) {
    console.error('Pipe content via stdin');
    return;
  }

  const count = engine.ingestRaw(sourceId, [{ content, type: 'text' }]);
  store.logSync({ sourceId, status: 'success', itemsFetched: 1, itemsIngested: count });
  console.log(`Ingested ${count} items`);
}

async function cmdSummarize() {
  const result = await engine.runSummarization();
  console.log(JSON.stringify(result));
}

async function cmdTree(args) {
  const sourceId = args[0];
  if (!sourceId) { console.error('Usage: memcore tree <sourceId>'); return; }

  const tree = store.getFullTree(sourceId);
  if (!tree || tree.length === 0) {
    console.log('No tree data yet. Run "memcore summarize" first.');
    return;
  }
  printTree(tree);
}

function printTree(nodes, depth = 0) {
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const levelTag = `[${node.level}]`.padEnd(8);
    const items = node.item_count ? `(${node.item_count} items)` : '';
    console.log(`${indent}${levelTag} ${node.title} ${items}`);
    if (node.summary) {
      const preview = node.summary.replace(/\n/g, ' ').slice(0, 80);
      console.log(`${indent}         ${preview}...`);
    }
    if (node.children?.length) {
      printTree(node.children, depth + 1);
    }
  }
}

async function cmdExport(args) {
  const sourceId = args[0];
  if (!sourceId) { console.error('Usage: memcore export <sourceId>'); return; }

  const source = store.getSource(sourceId);
  if (!source) { console.error('Source not found'); return; }

  vault.writeSourceIndex(source);

  const tree = store.getFullTree(sourceId);
  for (const root of tree) {
    vault.writeTreeNode(root, source.name, root.level);
    await exportChildren(root, source.name);
  }

  const roots = store.getTree(sourceId, 'root');
  if (roots) {
    const rootNodes = Array.isArray(roots) ? roots : [roots];
    vault.writeRootSummary(source.name, rootNodes);
  }

  vault.writeMappingFile();
  console.log(`Exported to ${VAULT_PATH}`);
}

async function exportChildren(node, sourceName) {
  const children = store.getChildren(node.id);
  for (const child of children) {
    vault.writeTreeNode(child, sourceName, child.level);
    await exportChildren(child, sourceName);
  }
}

async function cmdFetch(args) {
  const sourceId = args[0];
  const url = args[1];
  if (!sourceId || !url) { console.error('Usage: memcore fetch <sourceId> <url>'); return; }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    const html = await res.text();
    const reduced = reduce(html, { type: 'html' });

    const count = engine.ingestRaw(sourceId, [{ content: reduced, type: 'text' }]);
    store.updateLastFetch(sourceId);
    store.logSync({ sourceId, status: 'success', itemsFetched: 1, itemsIngested: count });

    console.log(`Fetched ${url} → ${count} items (${countTokens(html)} → ${countTokens(reduced)} tokens)`);
  } catch (err) {
    store.logSync({ sourceId, status: 'failed', itemsFetched: 0, itemsIngested: 0, error: err.message });
    console.error(`Fetch failed: ${err.message}`);
  }
}

async function cmdChat(args) {
  const sourceId = args[0];
  if (!sourceId) { console.error('Usage: memcore chat <sourceId>'); return; }

  const readline = (await import('readline')).default;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\nMemCore Chat (source: ${sourceId})\nType "exit" to quit.\n`);

  const ask = () => {
    rl.question('> ', async (input) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        rl.close();
        return;
      }

      const tree = store.getFullTree(sourceId);
      const context = tree?.length
        ? tree.map(n => `[${n.level}] ${n.title}\n${(n.summary || '').slice(0, 500)}`).join('\n\n')
        : '(no memory tree yet)';

      const prompt = `You are MemCore, a memory engine. Answer based on the stored knowledge below.

Knowledge:
${context}

User question: ${input}

Answer concisely based on the knowledge above. If the knowledge doesn't contain the answer, say so.`;

      try {
        const answer = await llm.generate(prompt, { temperature: 0.3, maxTokens: 1024 });
        console.log(`\n${answer}\n`);
      } catch (err) {
        console.error(`\nLLM error: ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

async function cmdTokenJuice(args) {
  const text = args.join(' ');
  if (!text) {
    console.error('Usage: memcore tokenjuice <text>');
    return;
  }

  const original = countTokens(text);
  const reduced = reduce(text);
  const compressed = countTokens(reduced);
  const saved = original - compressed;
  const ratio = original > 0 ? ((1 - compressed / original) * 100).toFixed(1) : 0;

  console.log(`Original: ${original} tokens`);
  console.log(`Compressed: ${compressed} tokens`);
  console.log(`Saved: ${saved} tokens (${ratio}%)`);
  console.log(`\nReduced output:\n${reduced.slice(0, 500)}`);
}

async function cmdAutoFetch(args) {
  const intervalMs = parseInt(args[0]) || 60000;
  const af = new AutoFetch(store, engine);
  console.log(`Auto-fetch loop started (interval: ${intervalMs}ms)`);

  await af.runOnce();
  setInterval(() => af.runOnce(), intervalMs);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
