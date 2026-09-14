import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const siteRoot = join(root, 'deployment', 'site');
const { version } = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(root, 'package.json'), 'utf8')));
const apkPath = join(root, 'mobile', 'releases', `tahosapp-android-${version}.apk`);
const installerPath = join(root, 'release', 'nsis-web', `tahosapp-Online-Setup-${version}.exe`);
const screenshotPath = join(root, 'mobile', 'qa-download-page.png');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const types = { '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

if (!existsSync(apkPath)) throw new Error(`APK bulunamadı: ${apkPath}`);
if (!existsSync(installerPath)) throw new Error(`Windows kurucusu bulunamadı: ${installerPath}`);
if (!existsSync(edgePath)) throw new Error(`Microsoft Edge bulunamadı: ${edgePath}`);

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/downloads/tahosapp-Android-latest.apk') {
    response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive' });
    createReadStream(apkPath).pipe(response);
    return;
  }
  if (pathname === '/downloads/tahosapp-Online-Setup-latest.exe') {
    response.writeHead(200, { 'Content-Type': 'application/vnd.microsoft.portable-executable' });
    createReadStream(installerPath).pipe(response);
    return;
  }
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = normalize(join(siteRoot, relative));
  if (!target.startsWith(siteRoot) || !existsSync(target)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(response);
});

await new Promise(resolveListen => server.listen(4181, '127.0.0.1', resolveListen));
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
try {
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4181/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.lang === 'tr');

  const title = page.locator('.download-title');
  if (await title.textContent() !== 'Uygulamamızı indir') throw new Error('Türkçe indirme başlığı görünmüyor.');
  if (await page.locator('.platform-download').count() !== 2) throw new Error('İki platform seçeneği bulunamadı.');
  if (await page.locator('.platform-download svg').count() !== 2) throw new Error('Platform logoları bulunamadı.');
  if (await page.locator('.platform-download.android').getAttribute('href') !== '/downloads/tahosapp-Android-latest.apk') throw new Error('Android bağlantısı yanlış.');
  if (await page.locator('.platform-download.windows').getAttribute('href') !== '/downloads/tahosapp-Online-Setup-latest.exe') throw new Error('Windows bağlantısı yanlış.');

  const apkResponse = await context.request.get('http://127.0.0.1:4181/downloads/tahosapp-Android-latest.apk');
  if (!apkResponse.ok() || (await apkResponse.body()).byteLength < 4_000_000) throw new Error('APK indirme bağlantısı geçerli dosya döndürmüyor.');

  const installerResponse = await context.request.get('http://127.0.0.1:4181/downloads/tahosapp-Online-Setup-latest.exe');
  const installerBytes = (await installerResponse.body()).byteLength;
  if (!installerResponse.ok() || installerBytes < 100_000) throw new Error('Windows kurulum bağlantısı geçerli EXE döndürmüyor.');
  if (installerBytes > 10_000_000) throw new Error(`Windows çevrimiçi kurucusu beklenenden büyük: ${installerBytes} bayt.`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#downloads').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Mobil sayfada ${overflow}px yatay taşma var.`);
  const columns = await page.locator('.platform-download').evaluateAll(items => items.map(item => item.getBoundingClientRect().width));
  if (columns.some(width => width < 300)) throw new Error('Mobil indirme seçenekleri yeterince geniş değil.');

  console.log('Download page verified: Turkish copy, compact Windows EXE, Android APK, desktop and 390px mobile layout.');
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
