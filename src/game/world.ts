import { createLayer } from '../model';
import { hash, lerp, smooth } from '../engine/math';
import { CHUNK_SIZE, TERRAIN_SEGMENTS, generateChunk, neighboringChunks, terrainHeight } from '../engine/world';

export const WORLD_LIMIT = 1920, REGION_SIZE = 144, GRID_STEP = CHUNK_SIZE / TERRAIN_SEGMENTS;
export type Biome = 'forest' | 'heath' | 'frost';
export const biomeNames: Record<Biome, string> = { forest: 'Старый лес', heath: 'Вересковая пустошь', frost: 'Снежное нагорье' };
export type Landmark = { id: string; kind: 'village' | 'ruin' | 'shrine'; x: number; z: number; name: string };
export type GameObject = { id: string; kind: 'tree' | 'rock' | 'house' | 'wall' | 'tower' | 'chest' | 'npc' | 'shrine' | 'fire';
  x: number; y: number; z: number; rx: number; rz: number; height: number; landmark?: Landmark };
export type EnemySpawn = { id: string; kind: 'wolf' | 'bandit' | 'guardian'; x: number; z: number; hp: number };
export type GameChunk = { key: string; x: number; z: number; biome: Biome; positions: Float32Array; indices: Uint16Array; objects: GameObject[]; enemies: EnemySpawn[] };
export const START_VILLAGE: Landmark = { id: 'village:start', kind: 'village', x: 0, z: 0, name: 'Тихолесье' };
export const START_RUIN: Landmark = { id: 'ruin:start', kind: 'ruin', x: 0, z: -72, name: 'Башня Серого Стража' };

export function biomeAt(seed: number, x: number, z: number): Biome {
  const climate = hash(seed ^ 713, Math.floor((x + 80) / 240), Math.floor((z + 80) / 240));
  return Math.hypot(x, z) < 120 ? 'forest' : climate < 0.43 ? 'forest' : climate < 0.74 ? 'heath' : 'frost';
}
function regionLandmark(seed: number, x: number, z: number): Landmark {
  if (x === 0 && z === 0) return START_VILLAGE;
  const value = hash(seed, x, z), kind = value < 0.28 ? 'village' : value < 0.75 ? 'ruin' : 'shrine';
  const title = ['Седой Сосны', 'Северного Ветра', 'Забытого Короля', 'Тихой Реки'][Math.floor(hash(seed ^ 71, x, z) * 4)];
  return { id: kind + ':' + x + ':' + z, kind, x: x * REGION_SIZE + (hash(seed ^ 33, x, z) - 0.5) * 36,
    z: z * REGION_SIZE + (hash(seed ^ 37, x, z) - 0.5) * 36,
    name: (kind === 'village' ? 'Посёлок ' : kind === 'ruin' ? 'Руины ' : 'Камень ') + title };
}
export function nearbyLandmarks(seed: number, x: number, z: number): Landmark[] {
  const rx = Math.round(x / REGION_SIZE), rz = Math.round(z / REGION_SIZE);
  const result = [START_RUIN];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) result.push(regionLandmark(seed, rx + dx, rz + dz));
  return result.filter(point => Math.abs(point.x) <= WORLD_LIMIT - 24 && Math.abs(point.z) <= WORLD_LIMIT - 24 &&
    Math.hypot(point.x - x, point.z - z) < REGION_SIZE * 2);
}
function rawHeight(seed: number, x: number, z: number) { return terrainHeight(seed, x, z, 1.2, 0.55); }
export function vertexHeight(seed: number, x: number, z: number): number {
  let height = rawHeight(seed, x, z);
  const point = regionLandmark(seed, Math.round(x / REGION_SIZE), Math.round(z / REGION_SIZE));
  for (const landmark of [point, START_RUIN]) {
    const radius = landmark.kind === 'village' ? 20 : 15, distance = Math.hypot(x - landmark.x, z - landmark.z);
    const weight = 1 - smooth(Math.min(1, Math.max(0, (distance - radius) / 10)));
    if (weight > 0) height = lerp(height, rawHeight(seed, landmark.x, landmark.z), weight);
  }
  return height;
}
// Physics samples the same triangles as the visible mesh, rather than another noise surface.
export function groundHeight(seed: number, x: number, z: number): number {
  const gx = Math.floor(x / GRID_STEP) * GRID_STEP, gz = Math.floor(z / GRID_STEP) * GRID_STEP;
  const fx = (x - gx) / GRID_STEP, fz = (z - gz) / GRID_STEP;
  const a = vertexHeight(seed, gx, gz), b = vertexHeight(seed, gx + GRID_STEP, gz), c = vertexHeight(seed, gx, gz + GRID_STEP);
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  const d = vertexHeight(seed, gx + GRID_STEP, gz + GRID_STEP);
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export function generateGameChunk(seed: number, x: number, z: number): GameChunk {
  const recipe = createLayer('procedural', 'game-terrain');
  const terrain = generateChunk(seed, recipe, x, z), biome = biomeAt(seed, (x + 0.5) * CHUNK_SIZE, (z + 0.5) * CHUNK_SIZE);
  for (let i = 0; i < terrain.positions.length; i += 3) terrain.positions[i + 1] = vertexHeight(seed, terrain.positions[i], terrain.positions[i + 2]);
  const objects: GameObject[] = [], enemies: EnemySpawn[] = [];
  const add = (kind: GameObject['kind'], id: string, px: number, pz: number, rx: number, rz: number, height: number, landmark?: Landmark) =>
    objects.push({ id, kind, x: px, z: pz, y: groundHeight(seed, px, pz), rx, rz, height, landmark });
  const landmarks = nearbyLandmarks(seed, (x + 0.5) * CHUNK_SIZE, (z + 0.5) * CHUNK_SIZE);
  const treeRecipe = createLayer('procedural', 'game-trees');
  if (treeRecipe.type === 'procedural') { treeRecipe.generator.name = 'trees'; treeRecipe.generator.count = biome === 'forest' ? 16 : biome === 'frost' ? 8 : 4; }
  const vegetation = generateChunk(seed ^ 61, treeRecipe, x, z);
  for (const [i, entity] of vegetation.entities.entries()) {
    if (landmarks.some(point => Math.hypot(point.x - entity.x, point.z - entity.z) < 24) ||
      Math.abs(entity.x) < 4 && entity.z < 14 && entity.z > -84) continue;
    add(i % 5 === 0 ? 'rock' : 'tree', 'prop:' + x + ':' + z + ':' + i, entity.x, entity.z, i % 5 === 0 ? 0.9 : 0.3, i % 5 === 0 ? 0.9 : 0.3, i % 5 === 0 ? 1.7 : 6 + entity.scale * 2);
  }
  for (const point of landmarks) {
    if (Math.floor(point.x / CHUNK_SIZE) !== x || Math.floor(point.z / CHUNK_SIZE) !== z) continue;
    if (point.kind === 'village') {
      for (const side of [-1, 1]) add('house', point.id + ':house:' + (side + 1), point.x + side * 10, point.z - 3, 3.5, 4, 5, point);
      add('npc', point.id + ':elder', point.x, point.z + 3, 0.35, 0.35, 1.8, point);
      add('fire', point.id + ':fire', point.x + 5, point.z + 5, 0.8, 0.8, 0.7, point);
    } else if (point.kind === 'ruin') {
      for (const side of [-1, 1]) add('wall', point.id + ':wall:' + (side + 1), point.x + side * 8, point.z, 1.1, 7, 5, point);
      add('tower', point.id + ':tower', point.x + 6, point.z - 8, 2.5, 2.5, 9, point);
      add('chest', point.id + ':chest', point.x, point.z + 2, 0.7, 0.5, 0.9, point);
      for (let i = 0; i < 2; i++) enemies.push({ id: 'guard:' + point.id + ':' + i, kind: 'guardian', x: point.x + (i === 0 ? -2 : 3), z: point.z + (i === 0 ? 8 : -4), hp: 48 });
    } else add('shrine', point.id + ':stone', point.x, point.z, 0.8, 0.8, 3.5, point);
  }
  const px = (x + 0.2 + hash(seed ^ 17, x, z) * 0.6) * CHUNK_SIZE, pz = (z + 0.2 + hash(seed ^ 21, x, z) * 0.6) * CHUNK_SIZE;
  if (hash(seed ^ 93, x, z) > 0.35 && !landmarks.some(point => Math.hypot(px - point.x, pz - point.z) < 30) &&
    !(Math.abs(px) < 7 && pz > -90 && pz < 20)) enemies.push({ id: 'enemy:' + x + ':' + z, kind: biome === 'frost' ? 'wolf' : 'bandit', x: px, z: pz, hp: biome === 'frost' ? 32 : 40 });
  return { key: x + ':' + z, x, z, biome, positions: terrain.positions, indices: terrain.indices, objects, enemies };
}
export function intersects(object: GameObject, x: number, y: number, z: number, radius = 0.35) {
  if (object.kind === 'fire' || y >= object.y + object.height || y + 1.8 <= object.y) return false;
  const dx = x - Math.max(object.x - object.rx, Math.min(object.x + object.rx, x));
  const dz = z - Math.max(object.z - object.rz, Math.min(object.z + object.rz, z));
  return dx * dx + dz * dz < radius * radius;
}
export function lineBlocked(objects: GameObject[], ax: number, az: number, bx: number, bz: number, y: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  for (let i = 1; i < steps; i++) if (objects.some(object => object.kind !== 'npc' && intersects(object, lerp(ax, bx, i / steps), y, lerp(az, bz, i / steps), 0.05))) return true;
  return false;
}
export { CHUNK_SIZE, neighboringChunks };
