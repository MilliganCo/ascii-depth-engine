import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/?editor=1');
  await expect(page.getByText('Открываем локальную студию…')).toBeHidden();
  const pause = page.getByRole('button', { name: 'Пауза', exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.getByRole('combobox', { name: 'Пространство', exact: true }).selectOption('3d');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'Three.js / WebGL2');
  await expect.poll(async () => Number(await page.getByTestId('viewport').getAttribute('data-objects'))).toBeGreaterThan(100);
}
async function camera(page: Page) {
  return JSON.parse((await page.getByTestId('viewport').getAttribute('data-camera'))!);
}
async function json(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const file = await download;
  return { path: (await file.path())!, data: JSON.parse(await readFile((await file.path())!, 'utf8')) };
}
test('3D orbit, free movement, persistence and exports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await ready(page);
  const initial = await camera(page), viewport = page.getByTestId('viewport'), bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 110, bounds.y + bounds.height / 2 - 35, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await camera(page)).position.x).not.toBe(initial.position.x);
  const rotated = await camera(page);
  await page.getByRole('combobox', { name: 'Управление камерой', exact: true }).selectOption('walk');
  await viewport.focus(); await page.keyboard.down('KeyW'); await page.waitForTimeout(450); await page.keyboard.up('KeyW');
  await expect.poll(async () => (await camera(page)).position.z).not.toBe(rotated.position.z);
  let moved = await camera(page);
  await page.getByRole('button', { name: 'Захватить мышь', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(false);
  const saved = await json(page);
  expect(saved.data.scene.spatial.enabled).toBe(true);
  await expect.poll(async () => (await camera(page)).position.x).toBeCloseTo(saved.data.scene.spatial.camera.position.x, 1);
  moved = saved.data.scene.spatial.camera;
  await page.getByRole('button', { name: 'Вписать', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(saved.path);
  await page.getByRole('button', { name: 'Отложить в черновики', exact: true }).click();
  await expect.poll(async () => (await camera(page)).position.z).toBeCloseTo(moved.position.z, 1);
  await page.getByRole('button', { name: 'Вписать', exact: true }).click();
  await page.getByRole('combobox', { name: 'Режим символов', exact: true }).selectOption('basic');
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await mkdir('docs/screenshots', { recursive: true });
  for (const kind of ['PNG', 'TXT', 'ANSI']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Сохранить ' + kind, exact: true }).click();
    const file = await download, bytes = await readFile((await file.path())!);
    if (kind === 'PNG') {
      expect(bytes.readUInt32BE(16)).toBe(1920); expect(bytes.readUInt32BE(20)).toBe(1080);
      expect(bytes.length).toBeGreaterThan(15000);
      await file.saveAs('docs/screenshots/3d-abyss-export.png');
    } else {
      const content = bytes.toString('utf8');
      if (kind === 'TXT') {
        expect(content.split('\n')).toHaveLength(48); expect(content.split('\n').every(line => line.length === 128)).toBe(true);
        expect(content).toMatch(/^[\x20-\x7e\n]+$/); expect(content.replace(/\s/g, '').length).toBeGreaterThan(100);
        await writeFile('docs/screenshots/3d-abyss.txt', content);
      } else expect(content).toContain('\x1b[0m');
    }
  }
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/3d-abyss-editor.png' });
  await page.getByRole('combobox', { name: 'Пространство', exact: true }).selectOption('2d');
  await expect(viewport).toHaveAttribute('data-backend', 'WebGL2');
  expect(errors).toEqual([]);
});

test('3D deterministic demos, context recovery and chunk travel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  for (const demo of ['forest', 'harbor']) {
    await json(page);
    await page.getByRole('combobox', { name: 'Открыть демо', exact: true }).selectOption(demo);
    const pause = page.getByRole('button', { name: 'Пауза', exact: true });
    if (await pause.isVisible()) await pause.click();
    await page.getByRole('combobox', { name: 'Пространство', exact: true }).selectOption('3d');
    await expect.poll(async () => Number(await page.getByTestId('viewport').getAttribute('data-objects'))).toBeGreaterThan(100);
    await page.screenshot({ path: 'docs/screenshots/3d-' + demo + '-editor.png' });
  }
  await page.getByTestId('viewport').locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!, extension = gl.getExtension('WEBGL_lose_context')!;
    extension.loseContext(); setTimeout(() => extension.restoreContext(), 700);
  });
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', '3D: контекст потерян');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-backend', 'Three.js / WebGL2');
  const doc = (await json(page)).data;
  doc.scene.spatial.camera.position = { x: -120, y: 12, z: -120 };
  doc.scene.spatial.camera.target = { x: -120, y: 3, z: -145 };
  await page.locator('input[type=file]').setInputFiles({ name: 'travel.ade.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect.poll(async () => (await camera(page)).position.x).toBe(-120);
  const city = doc.scene.layers.find((layer: { type: string; generator?: { name: string } }) => layer.generator?.name === 'city');
  await expect.poll(async () => JSON.parse((await page.getByTestId('viewport').getAttribute('data-chunks'))!))
    .toContain(city.id + ':-3:-3');
  await expect.poll(async () => Number(await page.getByTestId('viewport').getAttribute('data-objects'))).toBeGreaterThan(100);
  await page.screenshot({ path: 'docs/screenshots/3d-chunk-travel.png' });
  const extreme = (await json(page)).data;
  const terrain = extreme.scene.layers.find((layer: { generator?: { name: string } }) => layer.generator?.name === 'terrain');
  terrain.scale = 0.1; terrain.position.x = -8000;
  extreme.scene.layers = [terrain];
  extreme.scene.spatial.navigation = 'walk';
  extreme.scene.spatial.camera = { position: { x: 4000, y: 12, z: 4000 }, target: { x: 4000, y: 3, z: 3980 } };
  await page.locator('input[type=file]').setInputFiles({ name: 'edge.ade.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(extreme)) });
  await expect.poll(async () => JSON.parse((await page.getByTestId('viewport').getAttribute('data-chunks'))!))
    .toContain(terrain.id + ':916:833');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Новый', exact: true }).click();
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await page.getByRole('button', { name: '+ Добавить', exact: true }).click();
  await expect(page.locator('.layer-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
