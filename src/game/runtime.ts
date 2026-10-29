import { clamp, hash } from '../engine/math';
import { movementVector } from '../engine/world';
import { maxHealth, saveSchema, type GameSave } from './state';
import { CHUNK_SIZE, WORLD_LIMIT, START_RUIN, biomeAt, biomeNames, generateGameChunk, groundHeight, intersects, lineBlocked, nearbyLandmarks, neighboringChunks,
  type EnemySpawn, type GameChunk, type GameObject, type Landmark } from './world';

export type Enemy = EnemySpawn & { homeX: number; homeZ: number; y: number; cooldown: number };
export type Input = { forward: number; right: number; sprint: boolean };
export const enemyNames = { wolf: 'Северный волк', bandit: 'Разбойник', guardian: 'Серый страж' };
export class GameRuntime {
  readonly save: GameSave;
  readonly chunks = new Map<string, GameChunk>();
  readonly enemies = new Map<string, Enemy>();
  objects: GameObject[] = [];
  elapsed = 0;
  velocityY = 0;
  grounded = true;
  attackCooldown = 0;
  swing = 0;
  message = 'Найдите старосту Эллина у очага Тихолесья.';
  messageTime = 0;
  private chunkCenter = '';
  constructor(save: GameSave) {
    this.save = saveSchema.parse(save);
    this.save.player.y = Math.max(this.save.player.y, groundHeight(this.save.seed, this.save.player.x, this.save.player.z));
    this.grounded = this.save.player.y <= groundHeight(this.save.seed, this.save.player.x, this.save.player.z) + 0.01;
    if (this.save.quest !== 'available') this.message = this.save.quest === 'active' ? 'Найдите Северную реликвию в Башне Серого Стража.' :
      this.save.quest === 'relic' ? 'Верните Северную реликвию Эллину в Тихолесье.' : 'Реликвия возвращена. Исследуйте дальние земли.';
    this.loadChunks();
  }
  get player() { return this.save.player; }
  get healthMax() { return maxHealth(this.player.level); }
  get damage() { return 18 + (this.player.level - 1) * 3; }
  get region() { return biomeNames[biomeAt(this.save.seed, this.player.x, this.player.z)]; }
  get aliveEnemies() { return [...this.enemies.values()].filter(enemy => this.hp(enemy) > 0); }
  hp(enemy: Enemy) { return this.save.enemies[enemy.id] ?? enemy.hp; }
  log(message: string) { this.message = message; this.messageTime = this.elapsed; }
  loadChunks() {
    const center = Math.floor(this.player.x / CHUNK_SIZE) + ':' + Math.floor(this.player.z / CHUNK_SIZE);
    if (center === this.chunkCenter) return;
    this.chunkCenter = center;
    const needed = new Set<string>(), enemyIDs = new Set<string>();
    for (const [x, z] of neighboringChunks(this.player.x, this.player.z)) {
      const key = x + ':' + z; needed.add(key);
      let chunk = this.chunks.get(key);
      if (!chunk) { chunk = generateGameChunk(this.save.seed, x, z); this.chunks.set(key, chunk); }
      for (const spawn of chunk.enemies) {
        enemyIDs.add(spawn.id);
        if (!this.enemies.has(spawn.id)) this.enemies.set(spawn.id, { ...spawn, homeX: spawn.x, homeZ: spawn.z, y: groundHeight(this.save.seed, spawn.x, spawn.z), cooldown: 0 });
      }
    }
    for (const key of this.chunks.keys()) if (!needed.has(key)) this.chunks.delete(key);
    for (const id of this.enemies.keys()) if (!enemyIDs.has(id)) this.enemies.delete(id);
    this.objects = [...this.chunks.values()].flatMap(chunk => chunk.objects);
    if (!this.save.visited.includes(center)) this.save.visited.push(center);
  }
  private move(x: number, z: number, y: number, dx: number, dz: number) {
    const can = (px: number, pz: number) => Math.abs(px) <= WORLD_LIMIT && Math.abs(pz) <= WORLD_LIMIT &&
      groundHeight(this.save.seed, px, pz) - y <= 0.65 && !this.objects.some(object => intersects(object, px, y, pz));
    if (can(x + dx, z)) x += dx;
    if (can(x, z + dz)) z += dz;
    return { x, z };
  }
  update(seconds: number, input: Input) {
    if (this.player.health <= 0) return;
    const delta = clamp(seconds, 0, 0.1), steps = Math.max(1, Math.ceil(delta / (1 / 60)));
    for (let i = 0; i < steps; i++) this.step(delta / steps, input);
  }
  private step(dt: number, input: Input) {
    this.elapsed += dt; this.attackCooldown = Math.max(0, this.attackCooldown - dt); this.swing = Math.max(0, this.swing - dt);
    const moving = Boolean(input.forward || input.right), sprint = input.sprint && moving && this.player.stamina > 2 && this.grounded;
    const motion = movementVector(this.player.yaw, input.forward, input.right, 0, sprint ? 7 : 4.2, dt);
    const next = this.move(this.player.x, this.player.z, this.player.y, motion.x, motion.z);
    this.player.x = next.x; this.player.z = next.z;
    this.player.stamina = clamp(this.player.stamina + (sprint ? -24 : 16) * dt, 0, 100);
    this.velocityY -= 20 * dt; this.player.y += this.velocityY * dt;
    const floor = groundHeight(this.save.seed, this.player.x, this.player.z);
    this.grounded = this.player.y <= floor;
    if (this.grounded) { this.player.y = floor; this.velocityY = 0; }
    this.loadChunks();
    for (const enemy of this.aliveEnemies) {
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      const distance = Math.hypot(enemy.x - this.player.x, enemy.z - this.player.z), aggro = distance < 14;
      const targetX = aggro ? this.player.x : enemy.homeX, targetZ = aggro ? this.player.z : enemy.homeZ;
      const length = Math.hypot(targetX - enemy.x, targetZ - enemy.z);
      if (length > (aggro ? 1.2 : 0.2)) {
        const speed = enemy.kind === 'wolf' ? 2.7 : 2.1;
        const position = this.move(enemy.x, enemy.z, enemy.y, (targetX - enemy.x) / length * speed * dt, (targetZ - enemy.z) / length * speed * dt);
        enemy.x = position.x; enemy.z = position.z; enemy.y = groundHeight(this.save.seed, enemy.x, enemy.z);
      }
      if (aggro && distance < 1.8 && Math.abs(enemy.y - this.player.y) < 1.8 && enemy.cooldown === 0 &&
        !lineBlocked(this.objects, enemy.x, enemy.z, this.player.x, this.player.z, this.player.y + 0.5)) {
        this.player.health = Math.max(0, this.player.health - (enemy.kind === 'guardian' ? 10 : 8)); enemy.cooldown = 1.2;
        this.log(this.player.health === 0 ? 'Вы пали. Возвращение к последнему очагу доступно в меню.' : enemyNames[enemy.kind] + ' наносит удар.');
      }
    }
    for (const point of nearbyLandmarks(this.save.seed, this.player.x, this.player.z)) {
      if (Math.hypot(point.x - this.player.x, point.z - this.player.z) < 27 && !this.save.discovered.includes(point.id)) {
        this.save.discovered.push(point.id); this.awardXP(15); this.log('Открыто: ' + point.name + ' · +15 опыта');
      }
    }
  }
  jump() {
    if (!this.grounded || this.player.stamina < 12 || this.player.health <= 0) return false;
    this.velocityY = 7; this.grounded = false; this.player.stamina -= 12; return true;
  }
  attack() {
    if (this.attackCooldown > 0 || this.player.health <= 0) return false;
    this.attackCooldown = 0.48; this.swing = 0.28;
    const target = this.aliveEnemies.filter(enemy => {
      const dx = enemy.x - this.player.x, dz = enemy.z - this.player.z, distance = Math.hypot(dx, dz);
      return distance <= 3.2 && Math.abs(enemy.y - this.player.y) < 2 &&
        (distance < 0.6 || (dx * -Math.sin(this.player.yaw) + dz * -Math.cos(this.player.yaw)) / distance > 0.55) &&
        !lineBlocked(this.objects, this.player.x, this.player.z, enemy.x, enemy.z, this.player.y + 0.5);
    }).sort((a, b) => Math.hypot(a.x - this.player.x, a.z - this.player.z) - Math.hypot(b.x - this.player.x, b.z - this.player.z))[0];
    if (!target) return false;
    this.save.enemies[target.id] = Math.max(0, this.hp(target) - this.damage);
    if (this.hp(target) === 0) {
      const gold = 5 + Math.floor(hash(this.save.seed, Math.round(target.homeX), Math.round(target.homeZ)) * 8);
      this.player.gold = Math.min(9999999, this.player.gold + gold); this.awardXP(target.kind === 'guardian' ? 35 : 25);
      this.log(enemyNames[target.kind] + ' повержен · +' + gold + ' золота');
    } else this.log(enemyNames[target.kind] + ': −' + this.damage + ' здоровья');
    return true;
  }
  potion() {
    if (this.player.health <= 0 || this.player.potions <= 0 || this.player.health >= this.healthMax) return false;
    this.player.potions--; this.player.health = Math.min(this.healthMax, this.player.health + 45); this.log('Зелье восстанавливает здоровье.'); return true;
  }
  awardXP(amount: number) {
    this.player.xp += amount;
    while (this.player.level < 50 && this.player.xp >= this.player.level * 75) {
      this.player.xp -= this.player.level * 75; this.player.level++; this.player.health = Math.min(this.healthMax, this.player.health + 10);
    }
    this.player.xp = Math.min(this.player.xp, this.player.level * 75 - 1);
  }
  target(): GameObject | undefined {
    return this.objects.filter(object => ['npc', 'chest', 'shrine'].includes(object.kind) &&
      Math.abs(object.y - this.player.y) < 2.3 && Math.hypot(object.x - this.player.x, object.z - this.player.z) < 3.3 &&
      !lineBlocked(this.objects.filter(value => value.id !== object.id), this.player.x, this.player.z, object.x, object.z, this.player.y + 0.5))
      .sort((a, b) => Math.hypot(a.x - this.player.x, a.z - this.player.z) - Math.hypot(b.x - this.player.x, b.z - this.player.z))[0];
  }
  interact(): GameObject | undefined {
    if (this.player.health <= 0) return;
    const target = this.target(); if (!target) { this.log('Подойдите к человеку, сундуку или древнему камню.'); return; }
    if (target.kind === 'npc') return target;
    if (this.save.opened.includes(target.id)) { this.log('Здесь уже ничего не осталось.'); return; }
    if (target.kind === 'chest' && this.aliveEnemies.some(enemy => Math.hypot(enemy.x - target.x, enemy.z - target.z) < 13)) {
      this.log('Стражи руин не дадут открыть сундук.'); return;
    }
    this.save.opened.push(target.id);
    if (target.kind === 'shrine') { this.player.health = this.healthMax; this.player.potions = Math.min(999, this.player.potions + 1); this.awardXP(20); this.log('Древний камень дарует исцеление и зелье.'); }
    else if (target.landmark?.id === START_RUIN.id && this.save.quest !== 'complete') { this.save.quest = 'relic'; this.log('Найдена Северная реликвия. Вернитесь к Эллину в Тихолесье.'); }
    else { this.player.gold = Math.min(9999999, this.player.gold + 25); this.player.potions = Math.min(999, this.player.potions + 1); this.awardXP(20); this.log('В сундуке: 25 золота и зелье.'); }
  }
  acceptQuest() {
    if (this.save.quest !== 'available') return;
    this.save.quest = 'active'; this.log('Задание: найти Северную реликвию в Башне Серого Стража.');
  }
  completeQuest() {
    if (this.save.quest !== 'relic') return false;
    this.save.quest = 'complete'; this.player.gold = Math.min(9999999, this.player.gold + 80); this.player.potions = Math.min(999, this.player.potions + 2);
    this.awardXP(90); this.log('Северная реликвия возвращена · +80 золота · +90 опыта'); return true;
  }
  rest(point: Landmark) {
    this.save.checkpoint = { x: point.x, z: point.z + 12 }; this.player.health = this.healthMax; this.player.stamina = 100;
    this.log('Вы отдохнули. Этот очаг стал местом возвращения.');
  }
  respawn() {
    this.player.x = this.save.checkpoint.x; this.player.z = this.save.checkpoint.z; this.player.y = groundHeight(this.save.seed, this.player.x, this.player.z);
    this.player.health = this.healthMax; this.player.stamina = 100; this.player.gold = Math.floor(this.player.gold * 0.8);
    this.player.yaw = 0; this.player.pitch = 0; this.velocityY = 0; this.grounded = true; this.attackCooldown = 0;
    this.chunkCenter = ''; this.loadChunks(); this.log('Вы вернулись к очагу. Потеряно 20% золота.');
  }
}
