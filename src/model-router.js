import { request } from 'http';

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEERFLOW_BASE = 'http://127.0.0.1:2026';

export class ModelRouter {
  constructor({ preferredModel = 'qwen3.5:9b', fallbackModel = 'or-codex/gpt-5.4-mini', timeout = 30000 } = {}) {
    this.preferredModel = preferredModel;
    this.fallbackModel = fallbackModel;
    this.timeout = timeout;
  }

  async generate(prompt, opts = {}) {
    const result = await this.tryOllama(prompt, opts);
    if (result) return result;

    console.warn('[ModelRouter] Ollama unavailable, falling back to DeerFlow');
    const fallback = await this.tryDeerFlow(prompt, opts);
    if (fallback) return fallback;

    throw new Error('All LLM providers unavailable');
  }

  async tryOllama(prompt, opts = {}) {
    try {
      const body = JSON.stringify({
        model: this.preferredModel,
        prompt,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.3,
          num_predict: opts.maxTokens ?? 2048
        }
      });

      const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: this.timeout
      });

      if (!res.ok) return null;
      const data = await res.json();
      return (data.response || '').trim();
    } catch {
      return null;
    }
  }

  async tryDeerFlow(prompt, opts = {}) {
    try {
      const body = JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: this.fallbackModel,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2048
      });

      const res = await fetchWithTimeout(`${DEERFLOW_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: this.timeout
      });

      if (!res.ok) return null;
      const data = await res.json();
      const choice = data.choices?.[0];
      return choice?.message?.content?.trim() || choice?.text?.trim() || '';
    } catch {
      return null;
    }
  }

  async isAvailable() {
    const ollamaOk = await this.tryOllama('ping');
    if (ollamaOk) return true;
    const deerOk = await this.tryDeerFlow('ping');
    return !!deerOk;
  }
}

async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 10000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
