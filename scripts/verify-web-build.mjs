import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const buildDirectory = resolve(root, process.argv[2] || 'frontend/dist');
const appUrl = new URL('https://tahosapp.com.tr/app/');
const html = readFileSync(resolve(buildDirectory, 'index.html'), 'utf8');
const references = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1]);

if (!references.some(reference => /\.js(?:[?#]|$)/.test(reference))) {
  throw new Error('The web build has no application script.');
}

for (const reference of references) {
  const asset = new URL(reference, appUrl);
  if (asset.origin !== appUrl.origin || !asset.pathname.startsWith(appUrl.pathname)) {
    throw new Error(`Web asset must be served under /app/: ${reference}. Rebuild with npm run build:frontend before deployment.`);
  }
  const assetPath = resolve(buildDirectory, decodeURIComponent(asset.pathname.slice(appUrl.pathname.length)));
  const relativePath = relative(buildDirectory, assetPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath) || !statSync(assetPath).isFile()) {
    throw new Error(`Missing or invalid web asset: ${reference}`);
  }
}

console.log(`Web build verified: ${references.length} assets resolve under /app/.`);
