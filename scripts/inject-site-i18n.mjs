import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'deployment', 'site');
const repoRoot = resolve(siteRoot, '..', '..');
const { version: assetVersion } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
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
  if (file === join(siteRoot, 'index.html')) {
    content = content
      .replace(/"softwareVersion"\s*:\s*"\d+\.\d+\.\d+"/, `"softwareVersion":"${assetVersion}"`)
      .replace(/v\d+\.\d+\.\d+ · Windows 10\/11 · 64-bit · Web version · Independent and free/, `v${assetVersion} · Windows 10/11 · 64-bit · Web version · Independent and free`)
      .replace(/(<h2 id="current-release-title">tahosapp )\d+\.\d+\.\d+(<\/h2>)/, (_, prefix, suffix) => `${prefix}${assetVersion}${suffix}`)
      .replace(/(>Download )\d+\.\d+\.\d+(<\/a>)/, (_, prefix, suffix) => `${prefix}${assetVersion}${suffix}`);
  }
  writeFileSync(file, content);
}
