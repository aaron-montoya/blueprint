/** Moving a selected wire's end to another pin, and a custom PDF heading. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';

const part = (page: Page, title: string) =>
  page.locator('.react-flow__node-part', { has: page.locator(`.part-title:text-is("${title}")`) });
const pin = (page: Page, title: string, id: string) => part(page, title).locator(`.react-flow__handle[data-handleid="${id}"]`);

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
async function dropPart(page: Page, name: string, x: number, y: number) {
  await page.getByPlaceholder('Search parts').fill(name);
  await page
    .locator('.part-tile', { has: page.locator(`.part-tile-name:text-is("${name}")`) })
    .dragTo(page.locator('.react-flow__pane'), { targetPosition: { x, y } });
  await page.getByPlaceholder('Search parts').fill('');
}

test('drag a selected wire end onto another pin; custom heading prints', async ({ page }, testInfo) => {
  await page.goto('/');
  await dropPart(page, 'ESP32 DevKit V1', 200, 80);
  await dropPart(page, 'XLR Jack', 650, 80);
  await drag(page, await center(pin(page, 'ESP32 DevKit V1', 'D23')), await center(pin(page, 'XLR Jack', '1')));
  await page.getByRole('tab', { name: /Connections/ }).click();
  const row = page.locator('table.connections tbody tr:not(.conn-editor)');
  await expect(row).toContainText('D23');

  // The new wire is selected, so its end grips are showing.
  const grips = page.locator('.wire-handle.end');
  await expect(grips).toHaveCount(2);
  // Move the XLR end from pin 1 to pin 3 …
  const xlrGrip = (await grips.nth(0).boundingBox())!.x > (await grips.nth(1).boundingBox())!.x ? grips.nth(0) : grips.nth(1);
  await drag(page, await center(xlrGrip), await center(pin(page, 'XLR Jack', '3')));
  await expect(row.locator('td').nth(2)).toContainText('3');
  // … and the ESP32 end from D23 to D19.
  await page.locator('table.connections tbody tr').first().click();
  const espGrip = (await grips.nth(0).boundingBox())!.x < (await grips.nth(1).boundingBox())!.x ? grips.nth(0) : grips.nth(1);
  await drag(page, await center(espGrip), await center(pin(page, 'ESP32 DevKit V1', 'D19')));
  await expect(row).toContainText('D19');
  await expect(page.locator('g.wire')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('moved-end.png') });
  // Dropping on empty canvas changes nothing.
  await page.locator('table.connections tbody tr').first().click();
  const g = await center(grips.first());
  await drag(page, g, { x: g.x, y: g.y + 200 });
  await expect(row).toContainText('D19');
  await expect(row.locator('td').nth(2)).toContainText('3');
  // Undo walks it back.
  await page.keyboard.press('Control+z');
  await expect(row).toContainText('D23');

  // ---- heading
  await page.getByRole('tab', { name: 'Title block' }).click();
  await page.getByLabel('Heading').fill('TEST WORKSHOP — WIRING');
  await page.getByRole('button', { name: 'File ▾' }).click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByText('Export PDF').click()]);
  const pdfPath = testInfo.outputPath('heading.pdf');
  await pdf.saveAs(pdfPath);
  const raw = fs.readFileSync(pdfPath, 'latin1');
  expect(raw).toContain('TEST WORKSHOP');
  expect(raw).not.toContain('ESCAPES IN TIME');
});
