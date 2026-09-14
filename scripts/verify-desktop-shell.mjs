import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const splashPath = resolve(root, 'electron', 'splash.html');
const updatePath = resolve(root, 'electron', 'update.html');

for (const target of [edgePath, splashPath, updatePath]) {
  if (!existsSync(target)) throw new Error(`Gerekli dosya bulunamadı: ${target}`);
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
try {
  const splash = await browser.newPage({ viewport: { width: 420, height: 330 } });
  await splash.goto(pathToFileURL(splashPath).href);
  if (await splash.title() !== 'tahosapp açılıyor') throw new Error('Açılış penceresi başlığı yanlış.');
  if (!await splash.locator('.logo-wrap img').isVisible()) throw new Error('Açılış logosu görünmüyor.');
  const splashOverflow = await splash.evaluate(() => [
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.documentElement.scrollHeight - document.documentElement.clientHeight,
  ]);
  if (splashOverflow.some(value => value > 0)) throw new Error('Açılış penceresinde taşma var.');
  await splash.screenshot({ path: resolve(root, 'release', 'qa-splash.png') });

  const update = await browser.newPage({ viewport: { width: 450, height: 330 } });
  await update.addInitScript(() => {
    globalThis.tahosappUpdate = {
      hide() {},
      onState(callback) {
        callback({
          status: 'downloading',
          availableVersion: '1.3.1',
          progress: 46,
          message: 'Güncelleme indiriliyor: %46',
        });
      },
    };
  });
  await update.goto(pathToFileURL(updatePath).href);
  if (await update.title() !== 'tahosapp güncelleniyor') throw new Error('Güncelleme penceresi başlığı yanlış.');
  if (await update.locator('.percent').textContent() !== '%46') throw new Error('Güncelleme ilerlemesi görünmüyor.');
  await update.screenshot({ path: resolve(root, 'release', 'qa-update.png') });

  console.log('Desktop splash and update windows verified at 420x330 and 450x330.');
} finally {
  await browser.close();
}
