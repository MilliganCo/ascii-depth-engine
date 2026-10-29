import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameRuntime } from '../../src/game/runtime';
import { newGame, parseSave, serializeSave } from '../../src/game/state';
import { WORLD_LIMIT, START_VILLAGE, START_RUIN, biomeAt, generateGameChunk, groundHeight, intersects, type GameObject } from '../../src/game/world';

const idle = { forward: 0, right: 0, sprint: false };
const advance = (game: GameRuntime, seconds: number, input = idle) => { for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60, input); };
describe('fantasy RPG world and simulation', () => {
  it('generates stable objects, three biomes and seamless terrain matching physics', () => {
    const a = generateGameChunk(42017, -1, -2), b = generateGameChunk(42017, 0, -2);
    expect(generateGameChunk(42017, -1, -2)).toEqual(a);
    for (let row = 0; row <= 12; row++) {
      const offset = row * 13;
      expect(a.positions[(offset + 12) * 3 + 1]).toBe(b.positions[offset * 3 + 1]);
      expect(groundHeight(42017, b.positions[offset * 3], b.positions[offset * 3 + 2])).toBeCloseTo(b.positions[offset * 3 + 1], 5);
    }
    const biomes = new Set(Array.from({ length: 64 }, (_, i) => biomeAt(42017, (i % 8 - 4) * 260, (Math.floor(i / 8) - 4) * 260)));
    expect([...biomes].sort()).toEqual(['forest', 'frost', 'heath']);
  });
  it('walks to the elder, stops at his body, jumps and returns to the visible floor', () => {
    const game = new GameRuntime(newGame(42017));
    advance(game, 4, { ...idle, forward: 1 });
    expect(game.player.z).toBeGreaterThan(3.6);
    expect(game.target()?.kind).toBe('npc');
    expect(game.jump()).toBe(true); expect(game.jump()).toBe(false);
    advance(game, 0.25);
    expect(game.player.y).toBeGreaterThan(groundHeight(game.save.seed, game.player.x, game.player.z) + 0.5);
    advance(game, 1);
    expect(game.grounded).toBe(true);
    expect(game.player.y).toBeCloseTo(groundHeight(game.save.seed, game.player.x, game.player.z));
  });
  it('blocks structures, permits jumping over low obstacles and bounds the map', () => {
    const object: GameObject = { id: 'test:wall', kind: 'wall', x: 0, z: 0, y: 0, rx: 1, rz: 2, height: 3 };
    expect(intersects(object, 1.2, 0, 0)).toBe(true);
    expect(intersects(object, 1.5, 0, 0)).toBe(false);
    expect(intersects(object, 0, 3.1, 0)).toBe(false);
    const save = newGame(3); save.player.x = WORLD_LIMIT; save.player.y = groundHeight(3, WORLD_LIMIT, 12);
    const game = new GameRuntime(save); advance(game, 1, { ...idle, right: 1 });
    expect(game.player.x).toBe(WORLD_LIMIT);
  });
  it('normalizes sprint movement and consumes/regenerates stamina', () => {
    const a = new GameRuntime(newGame(42017)), b = new GameRuntime(newGame(42017));
    advance(a, 0.3, { ...idle, right: 1, sprint: true });
    advance(b, 0.3, { forward: -1, right: 1, sprint: true });
    expect(Math.hypot(a.player.x, a.player.z - 12)).toBeCloseTo(Math.hypot(b.player.x, b.player.z - 12), 4);
    expect(a.player.stamina).toBeLessThan(100);
    advance(a, 1); expect(a.player.stamina).toBe(100);
  });
  it('runs the relic quest, applies cooldown, persists kills and grants a reward once', () => {
    const save = newGame(42017); save.quest = 'active'; save.player.x = -2; save.player.z = -61.5;
    save.player.y = groundHeight(save.seed, -2, -61.5); save.enemies['guard:ruin:start:1'] = 0;
    const game = new GameRuntime(save), guard = game.enemies.get('guard:ruin:start:0')!;
    expect(game.attack()).toBe(true);
    const hp = game.hp(guard); expect(game.attack()).toBe(false); expect(game.hp(guard)).toBe(hp);
    for (let i = 0; i < 2; i++) { advance(game, 0.5); game.attack(); }
    expect(game.hp(guard)).toBe(0);
    game.player.x = 0; game.player.z = -68; game.player.y = groundHeight(save.seed, 0, -68);
    game.interact(); expect(game.save.quest).toBe('relic');
    expect(game.completeQuest()).toBe(true); expect(game.completeQuest()).toBe(false);
    expect(game.player.level).toBeGreaterThanOrEqual(2);
    const restored = new GameRuntime(parseSave(serializeSave(game.save)));
    expect(restored.save.quest).toBe('complete'); expect(restored.hp(restored.enemies.get(guard.id)!)).toBe(0);
    expect(restored.message).toContain('Исследуйте');
    expect(restored.save.opened).toContain('ruin:start:chest');
  });
  it('keeps the chest guarded, requires a facing attack and lets enemies inflict damage', () => {
    const save = newGame(42017); save.player.x = -2; save.player.z = -61.5; save.player.y = groundHeight(save.seed, -2, -61.5);
    const game = new GameRuntime(save), guard = game.enemies.get('guard:ruin:start:0')!;
    game.player.yaw = Math.PI; expect(game.attack()).toBe(false); expect(game.hp(guard)).toBe(guard.hp);
    advance(game, 1.5); expect(game.player.health).toBeLessThan(100);
    game.player.x = 0; game.player.z = -68; game.player.y = groundHeight(save.seed, 0, -68);
    game.interact(); expect(game.save.opened).not.toContain('ruin:start:chest');
    expect(game.potion()).toBe(true); expect(game.player.potions).toBe(2);
  });
  it('uses a checkpoint after death and retains quest/exploration progress', () => {
    const game = new GameRuntime(newGame(42017)); game.acceptQuest(); game.rest(START_VILLAGE);
    game.player.gold = 100; game.player.health = 0; game.player.x = 25;
    game.respawn(); expect(game.player.x).toBe(0); expect(game.player.z).toBe(12);
    expect(game.player.gold).toBe(80); expect(game.player.health).toBe(game.healthMax); expect(game.save.quest).toBe('active');
  });
  it('does not interact through walls or from another floor', () => {
    const game = new GameRuntime(newGame(42017)); game.player.z = 6;
    expect(game.target()?.kind).toBe('npc');
    game.objects.push({ id: 'test:wall', kind: 'wall', x: 0, z: 4.5, y: game.player.y, rx: 2, rz: .2, height: 4 });
    expect(game.target()).toBeUndefined();
    game.objects.pop(); game.player.y += 4;
    expect(game.target()).toBeUndefined();
  });
  it('streams a bounded active window and records discovered areas', () => {
    const game = new GameRuntime(newGame(42017));
    expect(game.chunks.size).toBe(9);
    game.player.x = 500; game.player.z = -500; game.player.y = groundHeight(game.save.seed, 500, -500); game.loadChunks();
    expect(game.chunks.size).toBe(9); expect(game.chunks.has('0:0')).toBe(false); expect(game.save.visited).toContain('10:-11');
    game.player.x = START_RUIN.x; game.player.z = START_RUIN.z; game.player.y = groundHeight(game.save.seed, game.player.x, game.player.z);
    game.update(0.01, idle); expect(game.save.discovered).toContain(START_RUIN.id);
  });
  it('rejects malformed/oversized saves and never confuses editor JSON with progress', () => {
    const save = newGame(42017);
    expect(parseSave(serializeSave(save))).toEqual(save);
    expect(parseSave(readFileSync('examples/northern-shards.rpg.json', 'utf8'))).toEqual(save);
    expect(() => parseSave('{"format":"ascii-depth-engine","schemaVersion":1}')).toThrow('Некорректное');
    save.player.health = 101; expect(() => serializeSave(save)).toThrow();
    expect(() => parseSave(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 МБ');
  });
  it('restores the quest hint together with saved progress', () => {
    const save = newGame(42017);
    save.quest = 'active'; expect(new GameRuntime(save).message).toContain('Башне Серого Стража');
    save.quest = 'relic'; expect(new GameRuntime(save).message).toContain('Верните');
  });
});
