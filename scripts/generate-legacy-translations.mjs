import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const turkishRevision = process.env.TAHOSAPP_TURKISH_REVISION || '6e3b167';
const legacyPairExclusions = new Set([
  'Profile and chat images now load consistently, Spotify invitations work on desktop and web, and friend presence and direct messages stay synchronized.',
]);

function walk(directory, predicate) {
  return readdirSync(directory).flatMap(name => {
    const target = join(directory, name);
    return statSync(target).isDirectory() ? walk(target, predicate) : (predicate(target) ? [target] : []);
  });
}

function decode(value, quote) {
  if (quote === '`' && value.includes('${')) return null;
  const simpleEscapes = {
    '0': '\0', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
    '\\': '\\', "'": "'", '"': '"', '`': '`',
  };
  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      output += value[index];
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === undefined) {
      output += '\\';
      continue;
    }
    index += 1;

    if (escaped === '\n') continue;
    if (escaped === '\r') {
      if (value[index + 1] === '\n') index += 1;
      continue;
    }
    if (Object.hasOwn(simpleEscapes, escaped)) {
      output += simpleEscapes[escaped];
      continue;
    }

    const remaining = value.slice(index);
    const codePoint = escaped === 'u'
      ? remaining.match(/^u\{([0-9A-Fa-f]{1,6})\}/)
      : null;
    if (codePoint && Number.parseInt(codePoint[1], 16) <= 0x10FFFF) {
      output += String.fromCodePoint(Number.parseInt(codePoint[1], 16));
      index += codePoint[0].length - 1;
      continue;
    }

    const fixedEscape = escaped === 'u'
      ? remaining.match(/^u([0-9A-Fa-f]{4})/)
      : escaped === 'x'
        ? remaining.match(/^x([0-9A-Fa-f]{2})/)
        : null;
    if (fixedEscape) {
      output += String.fromCharCode(Number.parseInt(fixedEscape[1], 16));
      index += fixedEscape[0].length - 1;
      continue;
    }

    // JavaScript permits escaping a non-special character; its value is the
    // character itself. Keeping that behavior avoids evaluating source text.
    output += escaped;
  }

  return output;
}

function sourceTokens(source) {
  const tokens = [];
  // Only inspect string positions that can reach the interface. A generic quote
  // scanner mistakes apostrophes in JSX text for JavaScript delimiters.
  const visibleStrings = [
    /(?:placeholder|title|aria-label|alt|label|description|help)\s*=\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /(?:label|description|title|placeholder|help|text|message)\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
    /(?:toast\.(?:success|error)|window\.(?:confirm|prompt)|new Error)\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
  ];
  for (const pattern of visibleStrings) {
    for (const match of source.matchAll(pattern)) {
      const value = decode(match[2], match[1]);
      if (value != null) tokens.push({ index: match.index, value: value.replace(/\s+/g, ' ').trim() });
    }
  }
  const jsxText = />([^<>{}]+)</g;
  for (const match of source.matchAll(jsxText)) tokens.push({ index: match.index, value: match[1].replace(/\s+/g, ' ').trim() });
  return tokens.filter(token => token.value).sort((a, b) => a.index - b.index).map(token => token.value);
}

function htmlTokens(source) {
  return [...source.matchAll(/>([^<>]+)</g)]
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function lcsPairs(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (left[i] === right[j]) { pairs.push([i, j]); i += 1; j += 1; }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

function collectPairs(oldTokens, currentTokens, output) {
  const anchors = [[-1, -1], ...lcsPairs(oldTokens, currentTokens), [oldTokens.length, currentTokens.length]];
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const [oldStart, currentStart] = anchors[anchorIndex - 1];
    const [oldEnd, currentEnd] = anchors[anchorIndex];
    const oldGap = oldTokens.slice(oldStart + 1, oldEnd);
    const currentGap = currentTokens.slice(currentStart + 1, currentEnd);
    if (oldGap.length !== currentGap.length) continue;
    currentGap.forEach((english, index) => {
      const turkish = oldGap[index];
      if (!english || !turkish || english === turkish || english.length > 500 || turkish.length > 500) return;
      if (legacyPairExclusions.has(english)) return;
      if (/\b(?:v|tahosapp\s+)?\d+\.\d+\.\d+\b/i.test(english)) return;
      if (!/[A-Za-z]/.test(english) || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(turkish)) return;
      if (/[{}]|className|=>|\b(?:const|return|function|import|socket|set[A-Z])\b/.test(english)) return;
      output.set(english, turkish);
    });
  }
}

function fromRevision(relativePath) {
  return execFileSync('git', ['show', `${turkishRevision}:${relativePath.replaceAll('\\', '/')}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const appCatalog = new Map();
const frontendRoot = join(repoRoot, 'frontend', 'src');
for (const file of walk(frontendRoot, target => /\.(?:js|jsx)$/.test(target))) {
  const relativePath = relative(repoRoot, file);
  let oldSource;
  try { oldSource = fromRevision(relativePath); } catch (_) { continue; }
  collectPairs(sourceTokens(oldSource), sourceTokens(readFileSync(file, 'utf8')), appCatalog);
}

const siteCatalog = new Map();
const siteRoot = join(repoRoot, 'deployment', 'site');
for (const file of walk(siteRoot, target => target.endsWith('.html'))) {
  const relativePath = relative(repoRoot, file);
  let oldSource;
  try { oldSource = fromRevision(relativePath); } catch (_) { continue; }
  collectPairs(htmlTokens(oldSource), htmlTokens(readFileSync(file, 'utf8')), siteCatalog);
}

const sortedObject = map => Object.fromEntries([...map].sort(([first], [second]) => first.localeCompare(second, 'en')));
writeFileSync(join(frontendRoot, 'i18n', 'legacyTurkish.generated.js'), `// Generated by scripts/generate-legacy-translations.mjs\nexport default ${JSON.stringify(sortedObject(appCatalog), null, 2)};\n`);
writeFileSync(join(siteRoot, 'assets', 'site-tr.generated.js'), `// Generated by scripts/generate-legacy-translations.mjs\nglobalThis.__TAHOSAPP_SITE_TR = ${JSON.stringify(sortedObject(siteCatalog), null, 2)};\n`);
console.log(`Generated ${appCatalog.size} app phrases and ${siteCatalog.size} site phrases.`);
