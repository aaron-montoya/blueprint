/** Changing a part's value (a resistor's ohms) on the canvas. */
import { expect, test, type Page } from '@playwright/test';

async function dropPart(page: Page, name: string, x: number, y: number) {
  await page.getByPlaceholder('Search parts').fill(name);
  await page
    .locator('.part-tile', { has: page.locator(`.part-tile-name:text-is("${name}")`) })
    .dragTo(page.locator('.react-flow__pane'), { targetPosition: { x, y } });
  await page.getByPlaceholder('Search parts').fill('');
}

test("double-click a resistor's value to change it", async ({ page }, testInfo) => {
  await page.goto('/');
  await dropPart(page, 'Resistor', 300, 260);
  const resistor = page.locator('.react-flow__node-part').first();
  const value = resistor.locator('.part-subtitle');
  await expect(value).toHaveText('220Ω');

  await value.dblclick();
  const input = resistor.getByLabel('Value');
  await expect(input).toHaveValue('220Ω');
  await input.fill('1kΩ');
  await input.press('Enter');
  await expect(value).toHaveText('1kΩ');
  // The name didn't change.
  await expect(resistor.locator('.part-title')).toHaveText('Resistor');
  await page.screenshot({ path: testInfo.outputPath('value.png') });

  // Escape cancels; clearing goes back to the library value.
  await value.dblclick();
  await resistor.getByLabel('Value').fill('10kΩ');
  await resistor.getByLabel('Value').press('Escape');
  await expect(value).toHaveText('1kΩ');
  await value.dblclick();
  await resistor.getByLabel('Value').fill('');
  await resistor.getByLabel('Value').press('Enter');
  await expect(value).toHaveText('220Ω');

  // Undo brings the edited value back.
  await page.keyboard.press('Control+z');
  await expect(value).toHaveText('1kΩ');
});
