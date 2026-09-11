import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`Version ${version} must use x.x.x format.`);
if (Number(match[3]) > 9) throw new Error(`Version ${version} violates the release policy: the patch number cannot exceed 9.`);

const landingPage = readFileSync(resolve(repoRoot, 'deployment', 'site', 'index.html'), 'utf8');
const releaseNotes = readFileSync(resolve(repoRoot, 'deployment', 'site', 'surum-notlari', 'index.html'), 'utf8');
const expectedLandingValues = [
  `\"softwareVersion\":\"${version}\"`,
  `v${version} · Windows`,
  `id=\"current-release-title\">tahosapp ${version}<`,
  `>Download ${version}<`,
];
const missingLandingValue = expectedLandingValues.find(value => !landingPage.includes(value));
if (missingLandingValue) {
  throw new Error(`The website release information is not synchronized with version ${version}: ${missingLandingValue}`);
}
if (!releaseNotes.includes(`<p class=\"eyebrow\">Current release</p><h2>tahosapp ${version}</h2>`)) {
  throw new Error(`The website release notes do not identify ${version} as the current release.`);
}
console.log(`Version ${version} follows the x.x.0–x.x.9 release policy.`);
