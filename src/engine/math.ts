import type { Layer, Scene, Track } from '../model';

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const modulo = (value: number, size: number) => ((value % size) + size) % size;
export function hash(seed: number, x: number, y = 0): number {
  let n = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function noise(seed: number, x: number): number {
  const i = Math.floor(x);
  return lerp(hash(seed, i), hash(seed, i + 1), smooth(x - i));
}
export const effectiveParallax = (layer: Layer) => layer.parallaxFactor === 'auto' ? 0.08 + layer.depth * 1.32 : layer.parallaxFactor;
export const fogVisibility = (distance: number, density: number, start: number) => Math.exp(-density * Math.max(0, distance - start));
export const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
export const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const toSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
export function projectWorldToScreen(x: number, y: number, layer: Layer, camera: Scene['camera'], width: number, height: number, fit: number) {
  const scale = layer.scale * camera.zoom * fit;
  const parallax = effectiveParallax(layer);
  return { x: width / 2 + (x + layer.position.x - camera.x * parallax) * scale,
    y: height / 2 + (y + layer.position.y - camera.y * parallax) * scale };
}
export function screenToWorld(x: number, y: number, layer: Layer, camera: Scene['camera'], width: number, height: number, fit: number) {
  const scale = layer.scale * camera.zoom * fit;
  return { x: (x - width / 2) / scale - layer.position.x + camera.x * effectiveParallax(layer),
    y: (y - height / 2) / scale - layer.position.y + camera.y * effectiveParallax(layer) };
}
export const sortLayers = (layers: Layer[]) => layers.map((layer, index) => ({ layer, index })).sort((a, b) => a.layer.depth - b.layer.depth || a.index - b.index).map(item => item.layer);
export function keyValue(track: Track, time: number): number | boolean {
  const keys = track.keys;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (time < keys[i].time) {
      const a = keys[i - 1], b = keys[i];
      if (a.interpolation === 'step' || typeof a.value === 'boolean' || typeof b.value === 'boolean') return a.value;
      const t = clamp((time - a.time) / (b.time - a.time));
      return lerp(a.value, b.value, a.interpolation === 'easeInOut' ? smooth(t) : t);
    }
  }
  return keys[keys.length - 1].value;
}
export function evaluateScene(scene: Scene, time: number): Scene {
  const result = { ...scene, camera: { ...scene.camera }, layers: scene.layers.map(layer => ({ ...layer, position: { ...layer.position } })), lights: scene.lights.map(light => ({ ...light })) };
  for (const track of scene.timeline.tracks) {
    const value = keyValue(track, time);
    if (track.target === 'camera' && ['x', 'y', 'zoom'].includes(track.property)) (result.camera as unknown as Record<string, number | boolean>)[track.property] = value;
    const layer = track.target === 'layer' && result.layers.find(item => item.id === track.targetId);
    if (layer) {
      if (track.property === 'x' || track.property === 'y') layer.position[track.property] = value as number;
      else if (track.property === 'visible') layer.visible = value as boolean;
      else if (track.property === 'opacity') layer.opacity = value as number;
    }
    const light = track.target === 'light' && result.lights.find(item => item.id === track.targetId);
    if (light && track.property === 'intensity') light.intensity = value as number;
  }
  if (result.camera.cinematic) {
    result.camera.x += Math.sin(time * 0.09) * 24;
    result.camera.y += Math.sin(time * 0.07) * 10;
  }
  return result;
}
export function advanceTime(time: number, delta: number, duration: number, loop: boolean): number {
  return loop ? modulo(time + delta, duration) : clamp(time + delta, 0, duration);
}
