import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { MESSAGES, SUPPORTED_LOCALES } = await import(pathToFileURL(join(repoRoot, 'frontend', 'src', 'i18n', 'catalog.js')));
const expectedKeys = Object.keys(MESSAGES.en).sort();
const failures = [];

for (const locale of SUPPORTED_LOCALES) {
  const keys = Object.keys(MESSAGES[locale.code] || {}).sort();
  const missing = expectedKeys.filter(key => !keys.includes(key));
  const extra = keys.filter(key => !expectedKeys.includes(key));
  if (missing.length) failures.push(`${locale.code}: missing ${missing.join(', ')}`);
  if (extra.length) failures.push(`${locale.code}: unknown ${extra.join(', ')}`);
}

function walk(directory, predicate) {
  return readdirSync(directory).flatMap(name => {
    const target = join(directory, name);
    return statSync(target).isDirectory() ? walk(target, predicate) : (predicate(target) ? [target] : []);
  });
}

for (const file of walk(join(repoRoot, 'frontend', 'src'), target => /\.(?:js|jsx)$/.test(target))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    if (!expectedKeys.includes(match[1])) failures.push(`${file}: unknown translation key ${match[1]}`);
  }
}

const backendSource = readFileSync(join(repoRoot, 'backend', 'src', 'storage', 'inMemory.js'), 'utf8');
for (const locale of SUPPORTED_LOCALES) {
  if (!backendSource.includes(`'${locale.code}'`)) failures.push(`backend does not accept locale ${locale.code}`);
}

for (const file of walk(join(repoRoot, 'deployment', 'site'), target => target.endsWith('.html'))) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('/assets/site-tr.generated.js') || !source.includes('/assets/i18n.js')) failures.push(`${file}: site language scripts are missing`);
}

const generatedApp = readFileSync(join(repoRoot, 'frontend', 'src', 'i18n', 'legacyTurkish.generated.js'), 'utf8');
const generatedSite = readFileSync(join(repoRoot, 'deployment', 'site', 'assets', 'site-tr.generated.js'), 'utf8');
if (generatedApp.length < 10_000) failures.push('generated Turkish app catalog is unexpectedly small');
if (generatedSite.length < 10_000) failures.push('generated Turkish site catalog is unexpectedly small');

if (failures.length) {
  console.error(`Translation validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${SUPPORTED_LOCALES.length} language catalogs validated (${expectedKeys.length} required keys).`);
