import type { GlyphMode, Layer } from '../model';
import { clamp, hash, lerp, smooth } from './math';

export const CHUNK_SIZE = 48, TERRAIN_SEGMENTS = 12;
export type WorldEntity = { id: string; x: number; y: number; z: number; scale: number; angle: number; phase: number };
export type WorldChunk = { x: number; z: number; positions: Float32Array; indices: Uint16Array; entities: WorldEntity[] };

function noise2(seed: number, x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  return lerp(lerp(hash(seed, ix, iz), hash(seed, ix + 1, iz), fx),
    lerp(hash(seed, ix, iz + 1), hash(seed, ix + 1, iz + 1), fx), fz);
}
export function terrainHeight(seed: number, x: number, z: number, amplitude: number, frequency: number) {
  return -5 + amplitude * (noise2(seed, x * frequency / 48, z * frequency / 48) * 12 +
    noise2(seed ^ 0x5a23, x * frequency / 17, z * frequency / 17) * 3);
}

// Pure world data: no DOM, Three.js, editor state or generation-order dependency.
export function generateChunk(seed: number, layer: Layer, chunkX: number, chunkZ: number): WorldChunk {
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || Math.abs(chunkX) > 1024 || Math.abs(chunkZ) > 1024) throw new Error('Координаты чанка вне диапазона');
  const localSeed = (seed + layer.seedOffset) >>> 0;
  const entities: WorldEntity[] = [];
  let positions = new Float32Array(0), indices = new Uint16Array(0);
  if (layer.type === 'procedural' && layer.generator.name === 'terrain') {
    const side = TERRAIN_SEGMENTS + 1;
    positions = new Float32Array(side * side * 3);
    indices = new Uint16Array(TERRAIN_SEGMENTS ** 2 * 6);
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const wx = (chunkX + x / TERRAIN_SEGMENTS) * CHUNK_SIZE, wz = (chunkZ + z / TERRAIN_SEGMENTS) * CHUNK_SIZE;
      positions.set([wx, terrainHeight(localSeed, wx, wz, layer.generator.amplitude, layer.generator.frequency), wz], (z * side + x) * 3);
      if (x < TERRAIN_SEGMENTS && z < TERRAIN_SEGMENTS) {
        const a = z * side + x;
        indices.set([a, a + side, a + 1, a + 1, a + side, a + side + 1], (z * TERRAIN_SEGMENTS + x) * 6);
      }
    }
  } else if (layer.type !== 'textGrid') {
    const count = layer.type === 'particles' ? Math.ceil(layer.system.count / 9) : layer.generator.name === 'water' ? 1 : layer.generator.count;
    const kind = layer.type === 'particles' ? layer.system.name : layer.generator.name;
    const chunkSeed = Math.floor(hash(localSeed, chunkX, chunkZ) * 0xffffffff);
    for (let i = 0; i < count; i++) {
      const x = (chunkX + (kind === 'water' ? 0.5 : hash(chunkSeed, i, 1))) * CHUNK_SIZE,
        z = (chunkZ + (kind === 'water' ? 0.5 : hash(chunkSeed, i, 2))) * CHUNK_SIZE;
      const airborne = layer.type === 'particles' || ['fish', 'stars', 'haze', 'rays'].includes(kind);
      entities.push({ id: layer.id + ':' + chunkX + ':' + chunkZ + ':' + i, x, z,
        y: airborne ? -1 + hash(chunkSeed, i, 3) * (kind === 'stars' ? 55 : 18) : terrainHeight(seed, x, z, 0.3, 2),
        scale: 0.6 + hash(chunkSeed, i, 4) * (layer.type === 'procedural' ? 0.4 + layer.generator.variation * 1.4 : 0.4),
        angle: hash(chunkSeed, i, 5) * Math.PI * 2, phase: hash(chunkSeed, i, 6) * Math.PI * 2 });
    }
  }
  return { x: chunkX, z: chunkZ, positions, indices, entities };
}
export function neighboringChunks(x: number, z: number): [number, number][] {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  return Array.from({ length: 9 }, (_, i) => [cx + i % 3 - 1, cz + Math.floor(i / 3) - 1]);
}
export function movementVector(yaw: number, forward: number, right: number, vertical: number, speed: number, seconds: number) {
  const magnitude = Math.hypot(forward, right, vertical) || 1, distance = speed * clamp(seconds, 0, 0.1) / magnitude;
  return { x: (right * Math.cos(yaw) - forward * Math.sin(yaw)) * distance,
    y: vertical * distance, z: (-forward * Math.cos(yaw) - right * Math.sin(yaw)) * distance };
}
export function spatialRamp(mode: GlyphMode): number[] {
  if (mode === 'block') return [32, 0x2591, 0x2592, 0x2593, 0x2588];
  if (mode === 'braille') return [32, 0x2801, 0x2809, 0x2819, 0x281b, 0x283b, 0x287b, 0x28fb, 0x28ff];
  return [...(mode === 'structural' ? ' .,:;i+txX#%@' : ' .:-=+*#%@')].map(char => char.codePointAt(0)!);
}
export function spatialGlyph(color: ArrayLike<number>, background: ArrayLike<number>, ramp: number[]) {
  const difference = Math.hypot(color[0] - background[0], color[1] - background[1], color[2] - background[2]);
  return difference < 0.012 ? 32 : ramp[Math.round(clamp(Math.max(color[0], color[1], color[2]) * 2.5) * (ramp.length - 1))];
}
