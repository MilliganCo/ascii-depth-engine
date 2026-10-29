import { describe, expect, it } from 'vitest';
import { createLayer, parseProject, serializeProject } from '../../src/model';
import { makeDemo } from '../../src/scenes';
import { effectiveParallax, projectWorldToScreen, screenToWorld } from '../../src/engine/math';
import { generate } from '../../src/engine/generators';

describe('first working slice', () => {
  it.each(['abyss', 'forest', 'harbor'] as const)('%s passes validation and preserves JSON', key => {
    const project = makeDemo(key);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
  it('camera has an inverse and near planes move further', () => {
    const scene = makeDemo('abyss').scene;
    const layer = createLayer('textGrid', 'sample');
    const camera = { ...scene.camera, x: 120, y: -32, zoom: 1.7 };
    const point = projectWorldToScreen(42, 81, layer, camera, 800, 450, 0.5);
    const inverse = screenToWorld(point.x, point.y, layer, camera, 800, 450, 0.5);
    expect(inverse.x).toBeCloseTo(42);
    expect(inverse.y).toBeCloseTo(81);
    expect(effectiveParallax({ ...layer, depth: 0.9 })).toBeGreaterThan(effectiveParallax({ ...layer, depth: 0.1 }));
  });
  it('geometry is seeded and reproducible', () => {
    const scene = makeDemo('abyss').scene;
    const layer = scene.layers[2];
    expect(generate(layer, scene).data).toEqual(generate(layer, scene).data);
    expect(generate(layer, { ...scene, seed: scene.seed + 1 }).data).not.toEqual(generate(layer, scene).data);
  });
  it('rejects bad projects without executing anything', () => {
    expect(() => parseProject('not json')).toThrow('JSON');
    const project = makeDemo('abyss');
    expect(() => parseProject(JSON.stringify({ ...project, schemaVersion: 999 }))).toThrow('версия');
    project.scene.layers[0].scale = 1e9;
    expect(() => parseProject(JSON.stringify(project))).toThrow('Некорректный');
  });
});
