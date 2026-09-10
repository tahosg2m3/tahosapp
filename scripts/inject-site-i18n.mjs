import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'deployment', 'site');
const assetVersion = '1.2.0';
const scripts = `<script defer src="/assets/site-tr.generated.js?v=${assetVersion}"></script><script defer src="/assets/i18n.js?v=${assetVersion}"></script>`;

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const target = join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : (target.endsWith('.html') ? [target] : []);
  });
}

for (const file of walk(siteRoot)) {
  let content = readFileSync(file, 'utf8');
  content = content.replace(/\/assets\/site\.css\?v=[^"']+/g, `/assets/site.css?v=${assetVersion}`);
  if (content.includes('/assets/i18n.js')) {
    content = content
      .replace(/\/assets\/site-tr\.generated\.js\?v=[^"']+/g, `/assets/site-tr.generated.js?v=${assetVersion}`)
      .replace(/\/assets\/i18n\.js\?v=[^"']+/g, `/assets/i18n.js?v=${assetVersion}`);
  } else {
    content = content.replace(/<\/body>/i, `${scripts}</body>`);
  }
  writeFileSync(file, content);
}
