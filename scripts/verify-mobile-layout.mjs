import { chromium } from 'playwright';
import { resolve } from 'node:path';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const user = { id: 'mobile-qa-user', username: 'Mobil Test', email: 'mobile@example.com', locale: 'tr', localeExplicit: true };
  await page.addInitScript((mockUser) => {
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('chat_token', 'mobile-layout-test-token');
  }, user);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/auth/verify') ? { user } : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/socket.io/**', route => route.abort());
  await page.goto('http://127.0.0.1:4173/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor();
  await page.locator('.mobile-header').waitFor({ state: 'visible' });
  await page.locator('.mobile-tabs').waitFor({ state: 'visible' });

  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (viewport.scrollWidth > viewport.innerWidth || viewport.scrollHeight > viewport.innerHeight) {
    throw new Error(`Mobile shell overflows the viewport: ${JSON.stringify(viewport)}`);
  }

  await page.getByRole('button', { name: 'Mesajlar', exact: true }).click();
  await page.locator('.app-navigation.is-open').waitFor({ state: 'visible' });
  const drawerBox = await page.locator('.app-navigation.is-open').boundingBox();
  if (!drawerBox || drawerBox.width > 366 || drawerBox.x < 0) throw new Error(`Invalid mobile drawer bounds: ${JSON.stringify(drawerBox)}`);
  await page.screenshot({ path: resolve('mobile/qa-mobile.png'), fullPage: false });
  await page.locator('#app-navigation').getByRole('button', { name: 'Kapat' }).click();
  await page.locator('.app-navigation').waitFor({ state: 'hidden' });
  console.log(`Mobile layout verified at ${viewport.innerWidth}x${viewport.innerHeight}; drawer width ${drawerBox.width}px.`);
} finally {
  await browser.close();
}
