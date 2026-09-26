/** Phone-sized touch screen: drawers, tap-to-add, and drawing a wire with a finger. */
import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** One-finger drag using real touch events. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  for (let i = 1; i <= 10; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapAdd(page: Page, name: string) {
  await page.getByRole('button', { name: 'Parts', exact: true }).tap();
  await page.getByPlaceholder('Search parts').fill(name);
  await page.locator('.part-tile', { has: page.locator(`.part-tile-name:text-is("${name}")`) }).tap();
  await expect(page.locator('.app.drawer-parts')).toHaveCount(0); // drawer closes after adding
  await page.waitForTimeout(400); // drawer slide + pan-to-part animations
}

test('build a small diagram on a phone', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  // Nothing wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

  await tapAdd(page, 'Reed Switch');
  await tapAdd(page, 'Buzzer');
  const parts = page.locator('.react-flow__node-part');
  await expect(parts).toHaveCount(2);
  // Tapped parts don't land on top of each other.
  const [a, b] = [(await parts.nth(0).boundingBox())!, (await parts.nth(1).boundingBox())!];
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap).toBe(false);

  // Fit both parts on screen (the ⛶ under the zoom buttons), then draw a
  // wire with a finger: Reed NO → Buzzer +.
  await page.locator('.react-flow__controls-fitview').tap();
  await page.waitForTimeout(400);
  const from = await center(page.locator('.react-flow__handle[data-handleid="NO"]'));
  const to = await center(page.locator('.react-flow__handle[data-handleid="+"]'));
  await touchDrag(page, from, to);
  await expect(page.locator('g.wire')).toHaveCount(1);
  await page.locator('.wire-bar-colors [title="Yellow"]').tap();
  await expect(page.locator('g.wire .wire-core')).toHaveAttribute('stroke', '#F9C80E');

  // Info drawer shows the connection; the backdrop closes it.
  await page.getByRole('button', { name: 'Title block and connections' }).tap();
  await page.getByRole('tab', { name: /Connections/ }).tap();
  await expect(page.locator('table.connections tbody tr')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('phone-connections.png') });
  await page.locator('.drawer-backdrop').tap({ position: { x: 10, y: 300 } });
  await expect(page.locator('.title-panel')).toHaveCount(0);

  // Toolbar actions work by tap (undo removes the wire color change, then the wire).
  await page.getByRole('button', { name: 'Undo' }).tap();
  await page.getByRole('button', { name: 'Undo' }).tap();
  await expect(page.locator('g.wire')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone.png') });
});
