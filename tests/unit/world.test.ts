import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultSpatial, parseProject, serializeProject } from '../../src/model';
import { makeDemo } from '../../src/scenes';
import { CHUNK_SIZE, TERRAIN_SEGMENTS, generateChunk, movementVector, neighboringChunks, spatialGlyph, spatialRamp } from '../../src/engine/world';

describe('game world data', () => {
  const project = makeDemo('forest');
  const terrain = project.scene.layers.find(layer => layer.type === 'procedural' && layer.generator.name === 'terrain')!;
  it('has seamless boundaries, stable chunks and independent seeds', () => {
    const a = generateChunk(123, terrain, -1, 0), b = generateChunk(123, terrain, 0, 0);
    for (let row = 0; row <= TERRAIN_SEGMENTS; row++) {
      const offset = row * (TERRAIN_SEGMENTS + 1);
      expect([...a.positions.slice((offset + TERRAIN_SEGMENTS) * 3, (offset + TERRAIN_SEGMENTS + 1) * 3)])
        .toEqual([...b.positions.slice(offset * 3, offset * 3 + 3)]);
    }
    expect(generateChunk(123, terrain, -1, 0)).toEqual(a);
    expect(generateChunk(124, terrain, -1, 0).positions).not.toEqual(a.positions);
    expect(() => generateChunk(123, terrain, Infinity, 0)).toThrow();
  });
  it('places distinct entities deterministically and handles negative chunk coordinates', () => {
    const trees = project.scene.layers.find(layer => layer.type === 'procedural' && layer.generator.name === 'trees')!;
    const chunk = generateChunk(42, trees, -1, -1);
    expect(generateChunk(42, trees, -1, -1).entities).toEqual(chunk.entities);
    expect(new Set(chunk.entities.map(entity => entity.id)).size).toBe(chunk.entities.length);
    expect(chunk.entities.every(entity => entity.x >= -CHUNK_SIZE && entity.x < 0 && entity.z >= -CHUNK_SIZE && entity.z < 0)).toBe(true);
    expect(neighboringChunks(-0.1, 0)).toContainEqual([-1, 0]);
    expect(neighboringChunks(1000, -1000)).toHaveLength(9);
  });
  it('normalizes diagonal motion, respects yaw and bounds stalled frames', () => {
    expect(movementVector(0, 1, 0, 0, 10, 0.1)).toEqual({ x: 0, y: 0, z: -1 });
    expect(movementVector(Math.PI / 2, 1, 0, 0, 10, 0.1).x).toBeCloseTo(-1);
    const d = movementVector(0, 1, 1, 1, 10, 99);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    const still = movementVector(0, 0, 0, 0, 10, 0.1);
    expect(Math.hypot(still.x, still.y, still.z)).toBe(0);
  });
  it('keeps old JSON unchanged and validates/persists spatial camera', () => {
    expect(parseProject(serializeProject(project)).scene.spatial).toBeUndefined();
    project.scene.spatial = defaultSpatial();
    expect(parseProject(serializeProject(project)).scene.spatial).toEqual(project.scene.spatial);
    project.scene.spatial.camera.target = { ...project.scene.spatial.camera.position };
    expect(() => serializeProject(project)).toThrow();
    delete project.scene.spatial;
  });
  it('uses strict ASCII ramps and ignores the empty background', () => {
    for (const mode of ['basic', 'structural'] as const) expect(spatialRamp(mode).every(code => code >= 32 && code <= 126)).toBe(true);
    expect(spatialGlyph([0.01, 0.02, 0.03], [0.01, 0.02, 0.03], spatialRamp('basic'))).toBe(32);
    expect(spatialGlyph([1, 1, 1], [0, 0, 0], spatialRamp('basic'))).toBe(64);
  });
  it('opens the game fixture and generates the same data outside the editor', () => {
    const example = parseProject(readFileSync('examples/game-world.ade.json', 'utf8'));
    expect(example.scene.spatial?.navigation).toBe('walk');
    const layer = example.scene.layers.find(layer => layer.type === 'procedural' && layer.generator.name === 'trees')!;
    const chunk = generateChunk(example.scene.seed, layer, 0, 0);
    expect(chunk.entities.length).toBeGreaterThan(0);
    expect(generateChunk(example.scene.seed, layer, 0, 0)).toEqual(chunk);
  });
  it('supports the full camera range at the smallest layer scale', () => {
    const small = { ...terrain, scale: 0.1, position: { x: -8000, y: 0 } };
    for (const [x, z] of neighboringChunks((4000 - small.position.x / 20) / small.scale, 4000 / small.scale)) {
      const chunk = generateChunk(123, small, x, z);
      expect([...chunk.positions].every(Number.isFinite)).toBe(true);
    }
    expect(() => generateChunk(123, terrain, 1025, 0)).toThrow();
  });
});
