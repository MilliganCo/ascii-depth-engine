import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/?editor=1');
  await expect(page.getByText('Открываем локальную студию…')).toBeHidden();
  await page.getByRole('button', { name: 'Диагностика', exact: true }).click();
  await expect(page.getByTestId('diagnostics')).toContainText('глифов');
}
async function pause(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: 'Пауза', exact: true });
  if (await button.isVisible()) await button.click();
  await page.getByRole('slider', { name: 'Время сцены', exact: true }).fill('12');
}
async function saveJSON(page: import('@playwright/test').Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const file = await download;
  const filepath = await file.path();
  return { filepath: filepath!, json: JSON.parse(await readFile(filepath!, 'utf8')) };
}
test('full editor journey: edit → JSON → reopen → PNG/TXT/ANSI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page); await pause(page);
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'WebGL2');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('0.62');
  await page.getByRole('spinbutton', { name: 'Непрозрачность', exact: true }).fill('0.42');
  const saved = await saveJSON(page);
  const layer = saved.json.scene.layers.find((item: { name: string }) => item.name === 'Стайка серебристых рыб');
  expect(layer.depth).toBe(0.62); expect(layer.opacity).toBe(0.42);
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('0.7');
  await page.locator('input[type=file]').setInputFiles(saved.filepath);
  await page.getByRole('button', { name: 'Отложить в черновики', exact: true }).click();
  await page.locator('.layer-select').filter({ hasText: 'Стайка серебристых рыб' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Глубина', exact: true })).toHaveValue('0.62');
  await expect(page.getByRole('spinbutton', { name: 'Непрозрачность', exact: true })).toHaveValue('0.42');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить PNG', exact: true }).click();
  const png = await pngDownload, bytes = await readFile((await png.path())!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(1920); expect(bytes.readUInt32BE(20)).toBe(1080);
  expect(bytes.length).toBeGreaterThan(15000);
  await mkdir('docs/screenshots', { recursive: true });
  await png.saveAs('docs/screenshots/abyss-export.png');
  for (const kind of ['TXT', 'ANSI']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Сохранить ' + kind, exact: true }).click();
    const file = await download, content = await readFile((await file.path())!, 'utf8');
    if (kind === 'TXT') {
      expect(content.split('\n')).toHaveLength(48);
      expect(content.split('\n').every(line => line.length === 128)).toBe(true);
      expect(content).not.toContain('\x1b');
    } else expect(content).toContain('\x1b[0m');
  }
  expect(errors).toEqual([]);
});
test('layer commands, history, locks and autosave restore', async ({ page }) => {
  await ready(page); await pause(page);
  await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название слоя', exact: true }).fill('Мой силуэт');
  await page.getByRole('textbox', { name: 'Символы', exact: true }).fill('  /\\\n /##\\\n/____\\');
  await page.getByRole('button', { name: 'Копия', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Название слоя', exact: true })).toHaveValue('Мой силуэт · копия');
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.locator('.layer-select').filter({ hasText: 'Мой силуэт · копия' }).click();
  await page.getByRole('button', { name: 'Заблокировать Мой силуэт · копия', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Глубина', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Разблокировать Мой силуэт · копия', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('0.94');
  await page.waitForFunction(() => new Promise<boolean>((resolve, reject) => {
    const opening = indexedDB.open('ascii-depth-engine');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('drafts'), request = transaction.objectStore('drafts').getAll();
      let saved = false;
      request.onerror = () => { database.close(); reject(request.error); };
      request.onsuccess = () => {
        saved = request.result.some((draft: { json: string }) => JSON.parse(draft.json).scene.layers.some(
          (layer: { name: string; depth: number }) => layer.name === 'Мой силуэт · копия' && layer.depth === .94));
      };
      transaction.oncomplete = () => { database.close(); resolve(saved); };
    };
  }));
  await page.reload();
  await expect(page.getByRole('status', { name: 'Состояние проекта' })).toContainText('Восстановлен');
  await page.locator('.layer-select').filter({ hasText: 'Мой силуэт · копия' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Глубина', exact: true })).toHaveValue('0.94');
});
test('all demos and glyph modes produce scene screenshots', async ({ page }) => {
  await ready(page); await pause(page);
  await mkdir('docs/screenshots', { recursive: true });
  for (const demo of ['abyss', 'forest', 'harbor']) {
    if (demo !== 'abyss') {
      await saveJSON(page);
      await page.getByRole('combobox', { name: 'Открыть демо', exact: true }).selectOption(demo);
    }
    await pause(page);
    await expect(page.getByTestId('diagnostics')).toContainText('глифов');
    await page.screenshot({ path: path.join('docs/screenshots', demo + '-editor.png') });
  }
  for (const mode of ['basic', 'structural', 'block', 'braille']) {
    await page.getByRole('combobox', { name: 'Режим символов', exact: true }).selectOption(mode);
    await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'WebGL2');
    await page.getByTestId('viewport').screenshot({ path: path.join('docs/screenshots', 'harbor-' + mode + '.png') });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: 'docs/screenshots/harbor-1920.png' });
});
test('Canvas2D fallback, context loss and restore, pan/zoom and presentation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await pause(page);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { restoreTest: () => void }).restoreTest = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'Canvas2D');
  await page.waitForTimeout(150);
  await page.evaluate(() => (window as unknown as { restoreTest: () => void }).restoreTest());
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'WebGL2');
  await page.getByRole('combobox', { name: 'Рендерер', exact: true }).selectOption('canvas');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'Canvas2D');
  await page.getByTestId('viewport').screenshot({ path: 'docs/screenshots/abyss-canvas.png' });
  const viewport = page.getByTestId('viewport'), box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -400);
  await expect(page.locator('.zoom-readout')).not.toHaveText('100%');
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 25); await page.mouse.up();
  await page.getByRole('button', { name: 'Вписать', exact: true }).click();
  await expect(page.locator('.zoom-readout')).toHaveText('100%');
  await page.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(page.locator('.studio')).toHaveClass(/presentation/);
  await page.getByRole('button', { name: 'Вернуться в редактор · H', exact: true }).click();
  expect(errors).toEqual([]);
});
test('keyframes change exported scene and survive round trip', async ({ page }) => {
  await ready(page); await pause(page);
  await page.getByRole('tab', { name: 'Ключи', exact: true }).click();
  await page.getByRole('combobox', { name: 'Свойство ключа', exact: true }).selectOption('camera:x');
  await page.getByRole('button', { name: /Добавить ключ/ }).click();
  await page.getByRole('spinbutton', { name: 'Значение ключа', exact: true }).fill('200');
  await page.getByRole('slider', { name: 'Время сцены', exact: true }).fill('30');
  await page.getByRole('button', { name: /Добавить ключ/ }).click();
  await page.getByRole('spinbutton', { name: 'Значение ключа', exact: true }).last().fill('-200');
  const { json } = await saveJSON(page);
  expect(json.scene.timeline.tracks[0].keys).toHaveLength(2);
  expect(json.scene.timeline.tracks[0].keys[1].value).toBe(-200);
  await page.getByRole('slider', { name: 'Время сцены', exact: true }).fill('12');
  const a = await page.getByTestId('viewport').screenshot();
  await page.getByRole('slider', { name: 'Время сцены', exact: true }).fill('30');
  const b = await page.getByTestId('viewport').screenshot();
  expect(a.equals(b)).toBe(false);
});
test('bad JSON and control characters do not destroy the scene', async ({ page }) => {
  await ready(page); await pause(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.ade.json', mimeType: 'application/json', buffer: Buffer.from('{"no":') });
  await expect(page.getByRole('status', { name: 'Состояние проекта' })).toContainText('корректный JSON');
  await expect(page.getByTestId('viewport')).toBeVisible();
  await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Символы', exact: true }).fill('\x1b[2Jmalicious');
  await expect(page.getByRole('status', { name: 'Состояние проекта' })).toContainText('управляющих');
  expect((await saveJSON(page)).json.scene.layers.at(-1).text).not.toContain('\x1b');
});
test('keyboard save in text field, modal focus, HiDPI and narrow layout', async ({ page, browser }) => {
  await ready(page); await pause(page);
  await page.getByRole('textbox', { name: 'Название слоя', exact: true }).focus();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await download).suggestedFilename()).toContain('.ade.json');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Сохранить ANSI', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  try {
    const hidpi = await context.newPage();
    await ready(hidpi);
    await expect(hidpi.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible();
    const dimensions = await hidpi.getByTestId('viewport').evaluate(element => {
      const canvas = element.querySelector('canvas')!;
      return { actual: canvas.width, expected: Math.round(element.getBoundingClientRect().width * 2) };
    });
    expect(dimensions.actual).toBe(dimensions.expected);
  } finally { await context.close(); }
});
