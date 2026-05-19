const SHORTEN_RULES = [
  { pattern: /github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/, replace: 'gh:$1/$2@$3/$4' },
  { pattern: /github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/, replace: 'gh:$1/$2#i$3' },
  { pattern: /github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/, replace: 'gh:$1/$2#p$3' },
  { pattern: /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/, replace: 'gh:$1/$2@$3/$4' },
  { pattern: /github\.com\/([^\/]+)\/([^\/]+)/, replace: 'gh:$1/$2' },
  { pattern: /notion\.so\/([^\/]+)\/([^\/\?#]+)/, replace: 'ntn:$1/$2' },
  { pattern: /docs\.google\.com\/document\/d\/([^\/]+)/, replace: 'gdoc:$1' },
  { pattern: /docs\.google\.com\/spreadsheets\/d\/([^\/]+)/, replace: 'gsheet:$1' },
  { pattern: /linear\.app\/([^\/]+)\/(issue|project)\/([^\/]+)/, replace: 'lin:$1/$3' },
  { pattern: /figma\.com\/(file|proto)\/([^\/]+)/, replace: 'fig:$2' },
  { pattern: /miro\.com\/app\/board\/([^\/]+)/, replace: 'miro:$1' },
  { pattern: /youtube\.com\/watch\?v=([^&]+)/, replace: 'yt:$1' },
  { pattern: /youtu\.be\/([^\/\?#]+)/, replace: 'yt:$1' },
];

export function shortenUrl(input) {
  if (!input) return input;

  const urls = input.match(/https?:\/\/[^\s<>"']+/g);
  if (!urls) return input;

  let result = input;
  for (const url of urls) {
    const shortened = shortenSingle(url);
    result = result.replace(url, shortened);
  }
  return result;
}

function shortenSingle(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');

    for (const rule of SHORTEN_RULES) {
      const fullMatch = url.match(rule.pattern);
      if (fullMatch) {
        let result = rule.replace;
        for (let i = 1; i < fullMatch.length; i++) {
          result = result.replace(`$${i}`, fullMatch[i]);
        }
        return result;
      }
    }

    return url;
  } catch {
    return url;
  }
}
