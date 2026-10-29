import { describe, expect, it } from 'vitest';
import { makeDemo } from '../../src/scenes';
import { createLayer, parseProject, projectSchema } from '../../src/model';
import { advanceTime, clamp, fogVisibility, hash, keyValue, rgb, sortLayers, toLinear, toSrgb, evaluateScene } from '../../src/engine/math';
import { Compositor, FRAME_STRIDE, modeGlyph } from '../../src/engine/compositor';
import { exportText, textFrame } from '../../src/io/export';
import { History, duplicateLayer, removeLayer, reorderLayer } from '../../src/editor/history';

describe('math, simulation and compositing', () => {
  it('fog and gamma stay bounded at endpoints', () => {
    expect(fogVisibility(1, 0, 0)).toBe(1);
    expect(fogVisibility(0, 4, 0)).toBe(1);
    expect(fogVisibility(1, 4, 0)).toBeGreaterThan(0);
    expect(fogVisibility(1, 4, 0)).toBeLessThan(fogVisibility(0.5, 4, 0));
    expect(rgb('#ff0080')).toEqual([1, 0, 128 / 255]);
    for (const value of [0, 0.003, 0.02, 0.5, 1]) expect(toSrgb(toLinear(value))).toBeCloseTo(value);
    expect(clamp(99)).toBe(1); expect(clamp(-99)).toBe(0);
  });
  it('hash is repeatable, bounded, and varies by coordinates', () => {
    expect(hash(42, 8, 4)).toBe(hash(42, 8, 4));
    expect(hash(42, 8, 4)).not.toBe(hash(42, 8, 5));
    for (let i = 0; i < 100; i++) { expect(hash(42, i)).toBeGreaterThanOrEqual(0); expect(hash(42, i)).toBeLessThan(1); }
  });
  it('timeline interpolates linear, eased and step tracks', () => {
    const track = { id: 'track', target: 'camera' as const, property: 'x' as const, keys: [{ time: 0, value: 0, interpolation: 'linear' as const }, { time: 10, value: 100, interpolation: 'linear' as const }] };
    expect(keyValue(track, -1)).toBe(0); expect(keyValue(track, 5)).toBe(50); expect(keyValue(track, 99)).toBe(100);
    expect(keyValue({ ...track, keys: [{ ...track.keys[0], interpolation: 'easeInOut' }, track.keys[1]] }, 2.5)).toBeCloseTo(15.625);
    expect(keyValue({ ...track, keys: [{ ...track.keys[0], interpolation: 'step' }, track.keys[1]] }, 9)).toBe(0);
    expect(keyValue({ ...track, property: 'visible', target: 'layer', keys: [{ time: 0, value: true, interpolation: 'step' }, { time: 5, value: false, interpolation: 'step' }] }, 5)).toBe(false);
    expect(advanceTime(59, 3, 60, true)).toBe(2); expect(advanceTime(59, 3, 60, false)).toBe(60);
  });
  it('timeline overrides camera, layer and light without mutating document', () => {
    const scene = makeDemo('abyss').scene;
    scene.camera.cinematic = false;
    scene.timeline.tracks = [
      { id: 'camera-track', target: 'camera', property: 'zoom', keys: [{ time: 0, value: 2, interpolation: 'linear' }] },
      { id: 'layer-track', target: 'layer', targetId: scene.layers[0].id, property: 'opacity', keys: [{ time: 0, value: 0.2, interpolation: 'linear' }] },
      { id: 'light-track', target: 'light', targetId: scene.lights[0].id, property: 'intensity', keys: [{ time: 0, value: 0, interpolation: 'linear' }] },
    ];
    const evaluated = evaluateScene(scene, 5);
    expect(evaluated.camera.zoom).toBe(2); expect(evaluated.layers[0].opacity).toBe(0.2); expect(evaluated.lights[0].intensity).toBe(0);
    expect(scene.camera.zoom).toBe(1); expect(scene.lights[0].intensity).toBe(1.35);
  });
  it('depth ordering is stable for equal depths', () => {
    const a = createLayer('textGrid', 'a'), b = createLayer('textGrid', 'b'), c = createLayer('textGrid', 'c');
    c.depth = 0;
    expect(sortLayers([a, b, c]).map(item => item.id)).toEqual(['c', 'a', 'b']);
  });
  it('seeking reproduces every frame; fog/light/visibility affect output', () => {
    const scene = makeDemo('abyss').scene, compositor = new Compositor();
    const frame = compositor.compose(scene, 12, 800, 450);
    const copy = frame.data.slice(0, frame.count * FRAME_STRIDE);
    expect(frame.count).toBeGreaterThan(1000);
    compositor.compose(scene, 27, 800, 450);
    const repeated = compositor.compose(scene, 12, 800, 450);
    expect(repeated.data.slice(0, repeated.count * FRAME_STRIDE)).toEqual(copy);
    const changed = compositor.compose({ ...scene, environment: { ...scene.environment, fogDensity: 4 } }, 12, 800, 450);
    expect(changed.data.slice(0, changed.count * FRAME_STRIDE)).not.toEqual(copy);
    expect(compositor.compose({ ...scene, layers: scene.layers.map(layer => ({ ...layer, visible: false })) }, 12, 800, 450).count).toBe(0);
  });
  it('glyph modes stay inside their documented ranges', () => {
    expect(modeGlyph(47, 0.7, 'basic', 0)).not.toBe(modeGlyph(47, 0.7, 'structural', 0));
    expect(modeGlyph(32, 0.7, 'block', 0)).toBe(32);
    for (let i = 0; i < 40; i++) {
      expect(modeGlyph(0x2588, i / 40, 'basic', i)).toBeGreaterThanOrEqual(32);
      expect(modeGlyph(0x2588, i / 40, 'basic', i)).toBeLessThanOrEqual(126);
      expect(modeGlyph(35, i / 40, 'braille', i)).toBeGreaterThanOrEqual(0x2801);
      expect(modeGlyph(35, i / 40, 'braille', i)).toBeLessThanOrEqual(0x28ff);
    }
  });
});
describe('format boundaries and editor commands', () => {
  it.each([
    (p: ReturnType<typeof makeDemo>) => { p.scene.layers[0].id = ''; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.layers[0].tint = '#oops'; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.layers[0].depth = Infinity; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.layers[1].id = p.scene.layers[0].id; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.cell.width = 0; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.resolution.width = -1; },
    (p: ReturnType<typeof makeDemo>) => { p.scene.timeline.tracks.push({ id: 'bad', target: 'layer', targetId: 'missing', property: 'opacity', keys: [{ time: 0, value: 0.5, interpolation: 'linear' }] }); },
  ])('rejects invalid input %#', mutation => {
    const project = makeDemo('abyss'); mutation(project);
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
  it('bounds file size and disallows unsafe text/type', () => {
    expect(() => parseProject(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 МБ');
    const project = makeDemo('abyss');
    project.scene.layers.push({ ...createLayer('textGrid', 'text'), type: 'textGrid', text: '\x1b[2J' });
    expect(projectSchema.safeParse(project).success).toBe(false);
    const unknown = { ...makeDemo('abyss'), scene: { ...project.scene, layers: [{ ...project.scene.layers[0], type: 'javascript' }] } };
    expect(() => parseProject(JSON.stringify(unknown))).toThrow('Некорректный');
  });
  it('history groups drags, supports undo/redo, and caps history', () => {
    const project = makeDemo('abyss'), history = new History(project);
    history.edit({ ...project, name: 'One' }, 'name', 1);
    history.edit({ ...project, name: 'Two' }, 'name', 2);
    expect(history.past).toHaveLength(1);
    history.undo(); expect(history.document.name).toBe(project.name);
    history.redo(); expect(history.document.name).toBe('Two');
    for (let i = 0; i < 70; i++) history.edit({ ...project, name: 'Name ' + i });
    expect(history.past).toHaveLength(50);
  });
  it('duplicate/delete/reorder preserve IDs, depth and undoable tracks', () => {
    const project = makeDemo('abyss'), id = project.scene.layers[4].id;
    const copied = duplicateLayer(project, id, 'copy');
    expect(copied.scene.layers).toHaveLength(project.scene.layers.length + 1);
    expect(new Set(copied.scene.layers.map(layer => layer.id)).size).toBe(copied.scene.layers.length);
    expect(removeLayer(copied, 'copy')).toEqual(project);
    const moved = reorderLayer(project, id, 1);
    expect(moved.scene.layers.find(layer => layer.id === id)!.depth).toBe(project.scene.layers[5].depth);
    const withTrack = structuredClone(project);
    withTrack.scene.timeline.tracks.push({ id: 'track', target: 'layer', targetId: id, property: 'opacity', keys: [{ time: 0, value: 0.5, interpolation: 'linear' }] });
    expect(removeLayer(withTrack, id).scene.timeline.tracks).toHaveLength(0);
  });
  it('TXT has exact dimensions, ANSI resets and control characters are sanitized', () => {
    const scene = makeDemo('abyss').scene;
    const text = exportText(scene, 0, false);
    expect(text.split('\n')).toHaveLength(48);
    expect(text.split('\n').every(line => line.length === 128)).toBe(true);
    expect(text).toMatch(/^[\x20-\x7e\n]+$/);
    const ansi = exportText(scene, 0, true);
    expect(ansi.endsWith('\x1b[0m')).toBe(true);
    const frame = new Compositor().compose(scene, 0, 800, 450);
    frame.data[4] = 27;
    expect(textFrame(frame, 160, 60)).not.toContain('\x1b');
  });
});
