/** Part Maker and connection list, driven through the UI (made-up parts only). */
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';

const part = (page: Page, title: string) =>
  page.locator('.react-flow__node-part', { has: page.locator(`.part-title:text-is("${title}")`) });

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('make a part, copy a part, wire them, see the connection list and PDF', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();

  // ---- new part from scratch
  await page.getByRole('button', { name: '+ New part' }).click();
  const maker = page.getByRole('dialog', { name: 'Part Maker' });
  await maker.getByPlaceholder('e.g. Hall Sensor').fill('Test Light Sensor');
  await maker.getByPlaceholder('Sidebar section').fill('Test Sensors');
  await maker.locator('.pm-side').first().getByRole('button', { name: '+ Add several…' }).click();
  await maker.locator('.pm-bulk textarea').fill('VCC\nGND\nOUT');
  await maker.getByRole('button', { name: 'Add pins' }).click();
  await expect(maker.locator('.pm-preview .preview-pin')).toHaveCount(3);
  // GND guessed as ground, VCC as power.
  await expect(maker.locator('.pm-pin select[aria-label="Pin type"]').nth(1)).toHaveValue('gnd');
  // Move OUT to the top of the list.
  await maker.locator('.pm-pin').nth(2).getByTitle('Move up / left').click();
  await maker.locator('.pm-pin').nth(1).getByTitle('Move up / left').click();
  await expect(maker.locator('.pm-pin input').first()).toHaveValue('OUT');
  await page.screenshot({ path: testInfo.outputPath('part-maker.png') });
  await maker.getByRole('button', { name: 'Save & add to canvas' }).click();
  await expect(maker).toHaveCount(0);
  await expect(part(page, 'Test Light Sensor')).toHaveCount(1);
  await expect(page.locator('.sidebar-section-title', { hasText: 'Test Sensors' })).toBeVisible();

  // ---- copy of a built-in part, edited
  await page.getByPlaceholder('Search parts').fill('Reed Switch');
  const tile = page.locator('.part-tile', { has: page.locator('.part-tile-name:text-is("Reed Switch")') });
  await tile.hover();
  await tile.getByTitle('Make a new part starting from a copy of this one').click();
  await expect(maker.getByPlaceholder('e.g. Hall Sensor')).toHaveValue('Reed Switch (copy)');
  await maker.getByPlaceholder('e.g. Hall Sensor').fill('Test Reed (NC)');
  await maker.getByRole('button', { name: 'Save & add to canvas' }).click();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByPlaceholder('Search parts')).toHaveValue('');
  await expect(part(page, 'Test Reed (NC)')).toHaveCount(1);
  // The built-in is untouched.
  await page.getByPlaceholder('Search parts').fill('Reed Switch');
  await expect(page.locator('.part-tile-name:text-is("Reed Switch")')).toHaveCount(1);
  await page.getByPlaceholder('Search parts').fill('');

  // Parts were placed on top of each other: move one aside, then wire them.
  const h = await center(part(page, 'Test Reed (NC)').locator('.part-header'));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 300, h.y, { steps: 5 });
  await page.mouse.up();
  const a = await center(part(page, 'Test Light Sensor').locator('.react-flow__handle[data-handleid="OUT"]'));
  const b = await center(part(page, 'Test Reed (NC)').locator('.react-flow__handle[data-handleid="NO"]'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.locator('.wire-bar-colors [title="Green"]').click();
  await page.locator('.wire-bar input#wire-label').fill('sensor → reed');

  // ---- connection list
  await page.getByRole('tab', { name: /Connections/ }).click();
  const row = page.locator('table.connections tbody tr:not(.conn-editor)');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Test Light Sensor');
  await expect(row).toContainText('OUT');
  await expect(row).toContainText('Green');
  await expect(row).toContainText('Test Reed (NC)');
  await expect(row).toContainText('sensor → reed');
  // Recolor from the list; the wire on the canvas follows.
  await row.getByTitle('Change color or label').click();
  await page.locator('tr.conn-editor .swatches').first().getByTitle('Orange').click();
  await expect(row).toContainText('Orange');
  await expect(page.locator('g.wire .wire-core')).toHaveAttribute('stroke', '#F57C00');
  await page.screenshot({ path: testInfo.outputPath('connections.png') });
  await page.getByRole('button', { name: 'Done' }).click();

  // ---- PDF has the diagram page plus a connections page
  await page.getByRole('button', { name: 'File ▾' }).click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByText('Export PDF').click()]);
  const pdfPath = testInfo.outputPath('with-connections.pdf');
  await pdf.saveAs(pdfPath);
  const text = fs.readFileSync(pdfPath, 'latin1');
  expect(text.match(/\/Type \/Page\b/g)?.length).toBe(2);

  // ---- delete from the list, undo brings it back
  await row.getByRole('button', { name: 'Delete wire' }).click();
  await expect(page.locator('table.connections tbody tr')).toHaveCount(0);
  await expect(page.locator('g.wire')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('g.wire')).toHaveCount(1);

  // ---- the side panel hides and comes back
  await page.getByTitle('Hide this panel').click();
  await expect(page.locator('.title-panel')).toHaveCount(0);
  await page.getByTitle('Show the title block and connection list').click();
  await expect(page.locator('.title-panel')).toBeVisible();

  // ---- custom parts survive a reload
  await page.reload();
  await page.getByPlaceholder('Search parts').fill('Test');
  await expect(page.locator('.part-tile-name:text-is("Test Light Sensor")')).toHaveCount(1);
});
