import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { newGame, SAVE_KEY, type GameSave } from '../../src/game/state';
import { groundHeight } from '../../src/game/world';

const viewport = (page: Page) => page.getByTestId('game-viewport');
const player = async (page: Page) => JSON.parse((await viewport(page).getAttribute('data-player'))!) as GameSave['player'];
const enemies = async (page: Page) => JSON.parse((await viewport(page).getAttribute('data-enemies'))!) as { id: string; hp: number; x: number; z: number }[];
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать путешествие', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-backend', 'Three.js / WebGL2');
  await expect(viewport(page)).toHaveAttribute('data-player', /"health":100/);
}
async function walkUntil(page: Page, key: string, condition: (position: GameSave['player']) => boolean, timeout = 22000) {
  await viewport(page).focus(); await page.keyboard.down(key);
  try { await expect.poll(async () => condition(await player(page)), { timeout, intervals: [150] }).toBe(true); }
  finally { await page.keyboard.up(key); }
}
async function pause(page: Page) {
  await page.getByRole('button', { name: 'Меню · Esc', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('У очага');
}
async function download(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать сохранение RPG', exact: true }).click();
  const file = await pending;
  return JSON.parse(await readFile((await file.path())!, 'utf8')) as GameSave;
}
async function importSave(page: Page, save: GameSave | object) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Загрузить сохранение RPG', exact: true }).click();
  await (await pending).setFiles({ name: 'journey.rpg.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(save)) });
}
async function defeat(page: Page, id: string) {
  await expect.poll(async () => {
    const guard = (await enemies(page)).find(value => value.id === id), p = await player(page);
    return guard && Math.hypot(guard.x - p.x, guard.z - p.z) < 3;
  }, { timeout: 12000, intervals: [150] }).toBe(true);
  await viewport(page).focus();
  for (let i = 0; i < 8; i++) {
    if ((await enemies(page)).find(value => value.id === id)?.hp === 0) break;
    await page.keyboard.press('KeyF'); await page.waitForTimeout(530);
  }
  await expect.poll(async () => (await enemies(page)).find(value => value.id === id)?.hp).toBe(0);
}
test('a real journey: elder → walk to ruins → both guardians → relic → reward → save', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const pixels = await viewport(page).locator('canvas').screenshot();
  const groundColor = await page.evaluate(encoded => new Promise<number[]>(resolve => {
    const image = new Image(); image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      resolve([...context.getImageData(Math.floor(image.width * .25), Math.floor(image.height * .9), 1, 1).data].slice(0, 3));
    }; image.src = 'data:image/png;base64,' + encoded;
  }), pixels.toString('base64'));
  expect(Math.min(...groundColor)).toBeGreaterThan(20);
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/rpg-village.png' });
  await walkUntil(page, 'KeyW', p => p.z < 6);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog')).toContainText('Эллин');
  await page.getByRole('button', { name: 'Я найду реликвию', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-quest', 'active');
  await walkUntil(page, 'KeyA', p => p.x < -2);
  const beforeJump = await player(page);
  await page.keyboard.press('Space'); await page.waitForTimeout(220);
  expect((await player(page)).y).toBeGreaterThan(beforeJump.y + 0.3);
  await page.waitForTimeout(800);
  await walkUntil(page, 'KeyW', p => p.z < -52);
  await defeat(page, 'guard:ruin:start:0');
  await walkUntil(page, 'KeyW', p => p.z < -65);
  await defeat(page, 'guard:ruin:start:1');
  await walkUntil(page, 'KeyW', p => p.z < -68);
  await walkUntil(page, 'KeyD', p => p.x > -1.6, 4000);
  await expect(page.getByRole('button', { name: 'E · Открыть сундук', exact: true })).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(viewport(page)).toHaveAttribute('data-quest', 'relic');
  const hurt = await player(page);
  expect(hurt.health).toBeLessThan(100);
  await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await player(page)).health).toBeGreaterThan(hurt.health);
  await page.screenshot({ path: 'docs/screenshots/rpg-ruins.png' });
  await walkUntil(page, 'KeyA', p => p.x < -2, 4000);
  await walkUntil(page, 'KeyS', p => p.z > 5.2);
  await walkUntil(page, 'KeyD', p => p.x > -0.3, 4000);
  await walkUntil(page, 'KeyW', p => Math.hypot(p.x, p.z - 3) < 2.8, 4000);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: 'Вернуть реликвию · получить награду', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-quest', 'complete');
  expect((await player(page)).level).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('KeyM');
  await expect(page.getByRole('img', { name: 'Карта исследованных земель: север сверху' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/rpg-map.png' });
  await page.keyboard.press('Escape'); await page.keyboard.press('KeyI');
  await expect(page.getByRole('dialog')).toContainText('Железный меч');
  await page.keyboard.press('Escape'); await pause(page);
  const save = await download(page);
  expect(save.format).toBe('ascii-fantasy-rpg'); expect(save.quest).toBe('complete');
  expect(save.enemies['guard:ruin:start:0']).toBe(0); expect(save.enemies['guard:ruin:start:1']).toBe(0);
  expect(save.discovered).toContain('ruin:start'); expect(save.opened).toContain('ruin:start:chest');
  await page.reload();
  await page.getByRole('button', { name: /Продолжить путешествие/ }).click();
  await expect(viewport(page)).toHaveAttribute('data-quest', 'complete');
  expect((await player(page)).gold).toBe(save.player.gold);
  expect(errors).toEqual([]);
});
test('mouse, stamina, streaming, ASCII, pause, death and validated save import', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const canvas = viewport(page).locator('canvas'), bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .6);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(bounds.x + bounds.width * .5 + 90, bounds.y + bounds.height * .6 - 20, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => Math.abs((await player(page)).yaw)).toBeGreaterThan(.1);
  await viewport(page).focus(); await page.keyboard.down('Shift'); await page.keyboard.down('KeyD');
  await page.waitForTimeout(800); await page.keyboard.up('KeyD'); await page.keyboard.up('Shift');
  expect((await player(page)).stamina).toBeLessThan(100);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('dialog')).toContainText('У очага');
  await page.getByRole('button', { name: 'Вернуться в мир', exact: true }).click();
  await canvas.evaluate(target => {
    const extension = (target as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    extension.loseContext(); setTimeout(() => extension.restoreContext(), 700);
  });
  await expect(page.getByRole('alert')).toContainText('Восстанавливаем графический контекст');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('У очага');
  await page.getByRole('button', { name: 'Вернуться в мир', exact: true }).click();
  await page.getByRole('button', { name: /Захватить мышь/ }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(false);
  await expect(page.getByRole('dialog')).toContainText('У очага');
  const frozen = await player(page);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await page.keyboard.up('KeyW');
  expect((await player(page)).z).toBe(frozen.z);
  await page.getByRole('button', { name: 'Отображение: 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуться в мир', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-ascii', 'true');
  await page.screenshot({ path: 'docs/screenshots/rpg-ascii.png' });
  await pause(page);
  const original = await download(page);
  await importSave(page, { format: 'ascii-depth-engine' });
  await expect(page.getByRole('status').filter({ hasText: 'Некорректное сохранение RPG' })).toBeVisible();
  expect((await download(page)).seed).toBe(original.seed);
  const travel = newGame(42017); travel.quest = 'active';
  travel.player.x = 500; travel.player.z = -500; travel.player.y = groundHeight(travel.seed, 500, -500);
  await importSave(page, travel);
  await expect.poll(async () => (await player(page)).x).toBe(500);
  await expect.poll(async () => JSON.parse((await viewport(page).getAttribute('data-chunks'))!).includes('10:-11')).toBe(true);
  expect(JSON.parse((await viewport(page).getAttribute('data-chunks'))!).length).toBe(9);
  await pause(page);
  travel.player.health = 0; travel.player.gold = 100;
  await importSave(page, travel);
  await expect(page.getByRole('dialog')).toContainText('Ваш путь ещё не окончен');
  await expect.poll(async () => (await player(page)).health).toBe(0);
  await page.getByRole('button', { name: 'Вернуться к очагу', exact: true }).click();
  await expect.poll(async () => (await player(page)).health).toBe(100);
  await expect.poll(async () => (await player(page)).gold).toBe(80);
  await expect(viewport(page)).toHaveAttribute('data-quest', 'active');
  expect(errors).toEqual([]);
});
test('new world confirmation, damaged autosave preservation and editor handoff', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => localStorage.setItem(key, '{"broken":"keep me"}'), SAVE_KEY);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Не удалось прочитать');
  await page.getByRole('button', { name: 'Начать путешествие', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('заменит текущее автосохранение');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe('{"broken":"keep me"}');
  await page.getByRole('button', { name: 'Начать путешествие', exact: true }).click();
  await page.getByRole('button', { name: 'Создать новый мир', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-player', /"health":100/);
  await pause(page);
  await page.getByRole('button', { name: 'Редактор ASCII', exact: true }).click();
  await expect(page.getByText('Открываем локальную студию…')).toBeHidden();
  await page.getByRole('spinbutton', { name: 'Непрозрачность', exact: true }).fill('0.68');
  await page.getByRole('button', { name: 'Играть · RPG', exact: true }).click();
  await expect(page.getByRole('button', { name: /Продолжить путешествие/ })).toBeVisible();
  await page.getByRole('button', { name: 'Редактор ASCII', exact: true }).click();
  await expect(page.getByText('Открываем локальную студию…')).toBeHidden();
  await page.getByRole('button', { name: /^Стайка серебристых рыб/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Непрозрачность', exact: true })).toHaveValue('0.68');
});
test('title screen fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Начать путешествие', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'docs/screenshots/rpg-title.png' });
});
