import { z } from 'zod';
import { WORLD_LIMIT, groundHeight } from './world';
const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const identifier = z.string().max(100).regex(/^[a-z][a-z0-9:-]*$/);
const coordinates = { x: number(-WORLD_LIMIT, WORLD_LIMIT), z: number(-WORLD_LIMIT, WORLD_LIMIT) };
export const maxHealth = (level: number) => 100 + (level - 1) * 10;
export const saveSchema = z.object({
  format: z.literal('ascii-fantasy-rpg'), version: z.literal(1), seed: number(0, 0xffffffff).int(),
  player: z.object({ ...coordinates, y: number(-100, 100), yaw: number(-Math.PI, Math.PI), pitch: number(-1.4, 1.4),
    health: number(0, 590), stamina: number(0, 100), level: number(1, 50).int(), xp: number(0, 100000).int(),
    gold: number(0, 9999999).int(), potions: number(0, 999).int() }),
  checkpoint: z.object(coordinates), quest: z.enum(['available', 'active', 'relic', 'complete']),
  enemies: z.record(identifier, number(0, 100)).refine(value => Object.keys(value).length <= 20000, 'Слишком много состояний врагов'),
  opened: z.array(identifier).max(2048), discovered: z.array(identifier).max(2048),
  visited: z.array(z.string().max(16).regex(/^-?\d+:-?\d+$/)).max(8192),
}).superRefine((save, ctx) => {
  if (save.player.health > maxHealth(save.player.level)) ctx.addIssue({ code: 'custom', message: 'Здоровье превышает максимум уровня' });
  for (const key of ['opened', 'discovered', 'visited'] as const) if (new Set(save[key]).size !== save[key].length) ctx.addIssue({ code: 'custom', message: 'Повторяющиеся ID в ' + key });
});
export type GameSave = z.infer<typeof saveSchema>;
export const SAVE_KEY = 'ascii-fantasy-rpg/save-v1', MAX_SAVE_BYTES = 2 * 1024 * 1024;
export function newGame(seed: number): GameSave {
  return saveSchema.parse({ format: 'ascii-fantasy-rpg', version: 1, seed,
    player: { x: 0, y: groundHeight(seed, 0, 12), z: 12, yaw: 0, pitch: 0, health: 100, stamina: 100, level: 1, xp: 0, gold: 5, potions: 3 },
    checkpoint: { x: 0, z: 12 }, quest: 'available', enemies: {}, opened: [], discovered: ['village:start'], visited: ['0:0'] });
}
export function parseSave(text: string): GameSave {
  if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES) throw new Error('Сохранение больше 2 МБ');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Сохранение не содержит корректный JSON'); }
  const parsed = saveSchema.safeParse(value);
  if (!parsed.success) throw new Error('Некорректное сохранение RPG: ' + parsed.error.issues.slice(0, 2).map(issue => issue.message).join('; '));
  return parsed.data;
}
export function serializeSave(save: GameSave) {
  const text = JSON.stringify(saveSchema.parse(save), null, 2);
  if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES) throw new Error('Сохранение больше 2 МБ');
  return text;
}
