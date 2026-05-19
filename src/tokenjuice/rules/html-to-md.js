const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const BLOCK_ELEMENTS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'pre', 'blockquote', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'main', 'figure', 'figcaption', 'details', 'summary']);

export function htmlToMd(html) {
  if (!html) return '';
  if (!html.includes('<')) return html;

  let result = html;

  result = removeTags(result, ['script', 'style', 'noscript', 'svg', 'form', 'select', 'button', 'input', 'textarea', 'iframe', 'canvas', 'template']);

  result = convertLinks(result);
  result = convertImages(result);
  result = convertHeadings(result);
  result = convertBoldItalic(result);
  result = convertCodeBlocks(result);
  result = convertLists(result);
  result = convertLineBreaks(result);
  result = stripRemainingTags(result);
  result = collapseWhitespace(result);

  return result.trim();
}

function removeTags(html, tags) {
  let result = html;
  for (const tag of tags) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    result = result.replace(regex, '');
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    result = result.replace(selfClosing, '');
  }
  return result;
}

function convertLinks(html) {
  return html.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, url, text) => {
    const cleanText = text.replace(/<[^>]+>/g, '').trim();
    if (!cleanText || cleanText === url) return url;
    if (url.startsWith('#')) return cleanText;
    return `[${cleanText}](${url})`;
  });
}

function convertImages(html) {
  return html.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => {
    return `![](${src})`;
  });
}

function convertHeadings(html) {
  for (let i = 6; i >= 1; i--) {
    const regex = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi');
    html = html.replace(regex, (match, content) => {
      const clean = content.replace(/<[^>]+>/g, '').trim();
      return '\n' + '#'.repeat(i) + ' ' + clean + '\n';
    });
  }
  return html;
}

function convertBoldItalic(html) {
  html = html.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (m, c) => `**${c.replace(/<[^>]+>/g, '')}**`);
  html = html.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (m, c) => `**${c.replace(/<[^>]+>/g, '')}**`);
  html = html.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (m, c) => `*${c.replace(/<[^>]+>/g, '')}*`);
  html = html.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (m, c) => `*${c.replace(/<[^>]+>/g, '')}*`);
  return html;
}

function convertCodeBlocks(html) {
  html = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
    const code = content.replace(/<code[^>]*>|<\/code>/gi, '').replace(/<[^>]+>/g, '');
    return '\n```\n' + code.trim() + '\n```\n';
  });
  html = html.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (match, content) => {
    return '`' + content.replace(/<[^>]+>/g, '') + '`';
  });
  return html;
}

function convertLists(html) {
  html = html.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (match, content) => {
    return '\n- ' + content.replace(/<[^>]+>/g, '').trim();
  });
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    return '\n' + content.trim() + '\n';
  });
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    return '\n' + content.trim() + '\n';
  });
  return html;
}

function convertLineBreaks(html) {
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/p>/gi, '\n\n');
  html = html.replace(/<p[^>]*>/gi, '');
  html = html.replace(/<\/div>/gi, '\n');
  html = html.replace(/<div[^>]*>/gi, '');
  html = html.replace(/<tr[^>]*>/gi, '');
  html = html.replace(/<\/tr>/gi, '\n');
  html = html.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (m, c) => ` ${c.replace(/<[^>]+>/g, '').trim()} |`);
  html = html.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, (m, c) => ` ${c.replace(/<[^>]+>/g, '').trim()} |`);
  html = html.replace(/<\/table>/gi, '\n');
  return html;
}

function stripRemainingTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function collapseWhitespace(html) {
  return html
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}
