import { htmlToMd } from './rules/html-to-md.js';
import { shortenUrl } from './rules/url-shorten.js';
import { cleanNoise } from './rules/noise-filter.js';

const TINY_OUTPUT_MAX_CHARS = 240;

export function reduce(input, { type = 'auto', maxTokens = 4096 } = {}) {
  if (!input || input.length === 0) return '';
  if (input.length < TINY_OUTPUT_MAX_CHARS) return input;

  let result = input;

  const detectedType = type === 'auto' ? detectType(input) : type;

  switch (detectedType) {
    case 'html':
      result = htmlToMd(result);
      break;
    case 'url':
      result = shortenUrl(result);
      break;
    case 'text':
      result = cleanNoise(result);
      break;
    case 'json':
      result = compressJson(result);
      break;
    case 'git':
      result = compressGitStatus(result);
      break;
    case 'code':
      result = compressCodeOutput(result);
      break;
  }

  result = cleanNoise(result);

  if (countTokens(result) > maxTokens) {
    result = truncateToTokens(result, maxTokens);
  }

  return result;
}

function detectType(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('/>'))) return 'html';
  if (/^https?:\/\/[^\s]+$/.test(trimmed)) return 'url';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^(modified|deleted|added|renamed|M:|A:|D:)\s/.test(trimmed)) return 'git';
  if (/^(function|const|let|var|import|export|def |class |fn |pub )/.test(trimmed)) return 'code';
  return 'text';
}

function compressJson(input) {
  try {
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed, null, 0);
  } catch {
    return input;
  }
}

function compressGitStatus(input) {
  return input
    .split('\n')
    .map(line => {
      return line
        .replace(/^modified:\s+/, 'M: ')
        .replace(/^deleted:\s+/, 'D: ')
        .replace(/^added:\s+/, 'A: ')
        .replace(/^renamed:\s+/, 'R: ')
        .replace(/^new file:\s+/, 'A: ')
        .replace(/^\t/, '  ');
    })
    .join('\n');
}

function compressCodeOutput(input) {
  return input
    .split('\n')
    .filter(line => line.trim().length > 0)
    .slice(0, 100)
    .join('\n');
}

export function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[--- truncated ---]';
}

export function estimateCost(originalTokens, compressedTokens) {
  const ratio = originalTokens > 0 ? (1 - compressedTokens / originalTokens) * 100 : 0;
  return {
    original: originalTokens,
    compressed: compressedTokens,
    saved: originalTokens - compressedTokens,
    ratio: Math.round(ratio * 100) / 100,
    estimatedUsd: (compressedTokens / 1000000) * 0.15
  };
}
