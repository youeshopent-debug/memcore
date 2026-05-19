export function cleanNoise(text) {
  if (!text) return '';

  let result = text;

  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');

  result = result.replace(/[ \t]+$/gm, '');
  result = result.replace(/^[ \t]+/gm, '');

  result = result.replace(/\n{4,}/g, '\n\n\n');

  result = result.replace(/\s{3,}/g, '  ');

  result = result.replace(/(?:<!--[\s\S]*?-->)/g, '');

  result = result.replace(/\x00/g, '');
  result = result.replace(/\u200B/g, '');
  result = result.replace(/\uFEFF/g, '');

  result = result.replace(/&nbsp;/gi, ' ');
  result = result.replace(/&amp;/gi, '&');
  result = result.replace(/&lt;/gi, '<');
  result = result.replace(/&gt;/gi, '>');
  result = result.replace(/&quot;/gi, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&#x27;/g, "'");
  result = result.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n));

  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
