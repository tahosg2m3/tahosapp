import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`Version ${version} must use x.x.x format.`);
if (Number(match[3]) > 9) throw new Error(`Version ${version} violates the release policy: the patch number cannot exceed 9.`);
console.log(`Version ${version} follows the x.x.0–x.x.9 release policy.`);
