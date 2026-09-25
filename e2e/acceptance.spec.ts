/**
 * The acceptance test from the brief, driven through the real UI:
 *  1. ESP32 wired to six renamed XLR jacks, each wire a different color.
 *  2. Three LEDs, each through a 220Ω resistor to D4/D13/D14, cathodes to GND.
 *  3. Move the ESP32; every wire stays on its pins.
 *  4. Export .blueprint, start with empty browser storage, import, all back.
 *  5. Export a PDF.
 * The prop is made up (the repo is public — no real room wiring here).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';

const part = (page: Page, title: string) =>
  page.locator('.react-flow__node-part', { has: page.locator(`.part-title:text-is("${title}")`) });
const pin = (page: Page, title: string, pinId: string) =>
  part(page, title).locator(`.react-flow__handle[data-handleid="${pinId}"]`);

async function center(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function dropPart(page: Page, name: string, x: number, y: number) {
  await page.getByPlaceholder('Search parts').fill(name);
  const tile = page.locator('.part-tile', { has: page.locator(`.part-tile-name:text-is("${name}")`) }).first();
  await tile.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x, y } });
  await page.getByPlaceholder('Search parts').fill('');
}

async function rename(page: Page, from: string, to: string) {
  await part(page, from).last().locator('.part-title').dblclick();
  const input = page.locator('.part-title-input');
  await input.fill(to);
  await input.press('Enter');
  await expect(part(page, to)).toHaveCount(1);
}

async function setWireColor(page: Page, label: string) {
  await page.getByRole('button', { name: /New wire/ }).click();
  await page.locator(`.swatch-panel .swatch[title="${label}"]`).click();
}

async function wire(page: Page, a: Locator, b: Locator) {
  const p = await center(a);
  const q = await center(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 5 });
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
}

/** Every wire path must start and end on the centre of a pin (checked in flow coordinates). */
async function wireEndsOnPins(page: Page) {
  return page.evaluate(() => {
    const vp = document.querySelector<HTMLElement>('.react-flow__viewport')!;
    const m = new DOMMatrix(getComputedStyle(vp).transform);
    const origin = vp.parentElement!.getBoundingClientRect();
    const toFlow = (x: number, y: number) => ({ x: (x - origin.left - m.e) / m.a, y: (y - origin.top - m.f) / m.d });
    const pins = [...document.querySelectorAll('.react-flow__handle.pin')].map((h) => {
      const r = h.getBoundingClientRect();
      return toFlow(r.left + r.width / 2, r.top + r.height / 2);
    });
    const bad: string[] = [];
    for (const g of document.querySelectorAll<SVGGElement>('g.wire')) {
      const path = g.querySelector<SVGPathElement>('.wire-core')!;
      for (const len of [0, path.getTotalLength()]) {
        const pt = path.getPointAtLength(len);
        if (!pins.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 1)) bad.push(`${g.dataset.wireId}@${Math.round(len)}`);
      }
    }
    return { wires: document.querySelectorAll('g.wire').length, bad };
  });
}

/** Click the middle of a wire (on the path itself, not its bounding box). */
async function clickWire(page: Page, index: number) {
  const pt = await page.evaluate((i) => {
    const vp = document.querySelector<HTMLElement>('.react-flow__viewport')!;
    const m = new DOMMatrix(getComputedStyle(vp).transform);
    const origin = vp.parentElement!.getBoundingClientRect();
    const path = document.querySelectorAll<SVGPathElement>('g.wire .wire-core')[i];
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    return { x: origin.left + m.e + p.x * m.a, y: origin.top + m.f + p.y * m.d };
  }, index);
  await page.mouse.click(pt.x, pt.y);
}

test('build, move, round-trip and print the XLR + LED test prop', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();

  await page.getByLabel('Room').fill('Test Room');
  await page.getByLabel('Prop').fill('XLR + LED demo');

  // ---- 1. ESP32 + six XLR jacks
  await dropPart(page, 'ESP32 DevKit V1', 700, 200);
  const xlrs = ['Top XLR 1', 'Top XLR 2', 'Top XLR 3', 'Bottom XLR 1', 'Bottom XLR 2', 'Bottom XLR 3'];
  for (let i = 0; i < 6; i++) {
    await dropPart(page, 'XLR Jack', i < 3 ? 1100 : 1350, 120 + (i % 3) * 190);
    await rename(page, 'XLR Jack', xlrs[i]);
  }
  const xlrWires: [string, string, string][] = [
    ['D23', 'Top XLR 1', 'Red'],
    ['D22', 'Top XLR 2', 'Yellow'],
    ['D21', 'Top XLR 3', 'Green'],
    ['D18', 'Bottom XLR 1', 'Blue'],
    ['D17', 'Bottom XLR 2', 'Orange'],
    ['D16', 'Bottom XLR 3', 'Purple'],
  ];
  for (const [gpio, jack, color] of xlrWires) {
    await setWireColor(page, color);
    await wire(page, pin(page, 'ESP32 DevKit V1', gpio), pin(page, jack, '1'));
  }
  await expect(page.locator('g.wire')).toHaveCount(6);

  // ---- 2. three LEDs through 220Ω resistors, cathodes to GND
  const leds: [string, string][] = [
    ['D4', 'White'],
    ['D13', 'Brown'],
    ['D14', 'Gray'],
  ];
  for (let i = 0; i < 3; i++) {
    await dropPart(page, 'Resistor', 420, 430 + i * 130);
    await rename(page, 'Resistor', `R${i + 1}`);
    await dropPart(page, 'LED', 160, 430 + i * 130);
    await rename(page, 'LED', `LED ${i + 1}`);
  }
  for (let i = 0; i < 3; i++) {
    const [gpio, color] = leds[i];
    await setWireColor(page, color);
    await wire(page, pin(page, 'ESP32 DevKit V1', gpio), pin(page, `R${i + 1}`, '2'));
    await wire(page, pin(page, `R${i + 1}`, '1'), pin(page, `LED ${i + 1}`, '+ (A)'));
    await setWireColor(page, 'Black');
    await wire(page, pin(page, `LED ${i + 1}`, '− (K)'), pin(page, 'ESP32 DevKit V1', 'GND'));
  }
  await expect(page.locator('g.wire')).toHaveCount(15);
  await page.screenshot({ path: testInfo.outputPath('wired.png') });
  expect((await wireEndsOnPins(page)).bad).toEqual([]);

  // A wire label, set through the popover.
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await clickWire(page, 0);
  await page.getByPlaceholder('e.g. D23 → Top XLR 1').fill('D23 → Top XLR 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wire-label', { hasText: 'D23 → Top XLR 1' })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('built.png') });

  // ---- 3. move the ESP32; wires follow
  const header = part(page, 'ESP32 DevKit V1').locator('.part-header');
  const h = await center(header);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x - 60, h.y + 90, { steps: 8 });
  await page.mouse.up();
  const after = await wireEndsOnPins(page);
  expect(after.wires).toBe(15);
  expect(after.bad).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('moved.png') });

  // Undo puts it back, redo moves it again — still attached either way.
  await page.keyboard.press('Control+z');
  expect((await wireEndsOnPins(page)).bad).toEqual([]);
  await page.keyboard.press('Control+y');

  // ---- 4. export .blueprint → fresh browser storage → import
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = testInfo.outputPath('test-prop.blueprint');
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.formatVersion).toBe(1);
  expect(saved.parts).toHaveLength(13);
  expect(saved.wires).toHaveLength(15);

  const fresh = await browser.newContext({ viewport: { width: 1920, height: 1200 }, acceptDownloads: true });
  const page2 = await fresh.newPage();
  await page2.goto('/');
  await expect(page2.locator('.react-flow__pane')).toBeVisible();
  await expect(page2.locator('.react-flow__node')).toHaveCount(0);
  await page2.getByRole('button', { name: 'File ▾' }).click();
  const [chooser] = await Promise.all([page2.waitForEvent('filechooser'), page2.getByText('Import .blueprint…').click()]);
  await chooser.setFiles(file);
  await expect(page2.locator('.react-flow__node-part')).toHaveCount(13);
  await expect(page2.locator('g.wire')).toHaveCount(15);
  await expect(page2.getByLabel('Room')).toHaveValue('Test Room');
  await expect(part(page2, 'Bottom XLR 3')).toHaveCount(1);
  await expect(page2.locator('.wire-label', { hasText: 'D23 → Top XLR 1' })).toHaveCount(1);
  expect((await wireEndsOnPins(page2)).bad).toEqual([]);
  // Re-export and compare: nothing was lost in the round trip.
  const [download2] = await Promise.all([page2.waitForEvent('download'), page2.keyboard.press('Control+s')]);
  const file2 = testInfo.outputPath('roundtrip.blueprint');
  await download2.saveAs(file2);
  expect(JSON.parse(fs.readFileSync(file2, 'utf8'))).toEqual(saved);

  // ---- 5. PDF
  await page2.getByRole('button', { name: 'File ▾' }).click();
  const [pdf] = await Promise.all([page2.waitForEvent('download'), page2.getByText('Export PDF').click()]);
  const pdfPath = testInfo.outputPath('test-prop.pdf');
  await pdf.saveAs(pdfPath);
  const bytes = fs.readFileSync(pdfPath);
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  expect(bytes.length).toBeGreaterThan(20_000);
  await fresh.close();
});
