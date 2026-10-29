import type { GlyphMode, Scene } from '../model';
import { generate, GEOMETRY_STRIDE, type Geometry } from './generators';
import { clamp, effectiveParallax, evaluateScene, fogVisibility, hash, lerp, modulo, rgb, sortLayers, toLinear, toSrgb } from './math';

export const FRAME_STRIDE = 10;
export const MAX_GLYPHS = 120000;
export type RenderFrame = {
  data: Float32Array; count: number; width: number; height: number; background: [number, number, number];
  batches: { start: number; count: number; additive: boolean }[]; generated: number; clipped: boolean;
};
export function modeGlyph(code: number, luminance: number, mode: GlyphMode, index: number): number {
  if (code === 32) return 32;
  if (mode === 'basic') return '.:-=+*#%@'.charCodeAt(Math.floor(clamp(luminance) * 8));
  if (mode === 'structural') return code >= 32 && code <= 126 ? code : '.:-=+*#%@'.charCodeAt(Math.floor(clamp(luminance) * 8));
  if (mode === 'block') return [0x2591, 0x2592, 0x2593, 0x2588][Math.floor(clamp(luminance) * 3)];
  // A Braille cell samples eight deterministic coverage points in its 2×4 matrix.
  let mask = 0;
  for (let dot = 0; dot < 8; dot++) if (hash(index, dot) < clamp(luminance, 0.12, 1)) mask |= 1 << dot;
  return 0x2800 + (mask || 1);
}
export class Compositor {
  private geometry = new Map<string, { key: string; value: Geometry }>();
  private buffer = new Float32Array(MAX_GLYPHS * FRAME_STRIDE);
  compose(source: Scene, time: number, width: number, height: number, quality: 'low' | 'medium' | 'high' = 'high'): RenderFrame {
    const scene = evaluateScene(source, time);
    const fit = Math.min(width / scene.resolution.width, height / scene.resolution.height);
    const frame: RenderFrame = { data: this.buffer, count: 0, width, height, background: rgb(scene.environment.background), batches: [], generated: 0, clipped: false };
    const fogColor = rgb(scene.environment.fogColor).map(toLinear);
    const lights = scene.lights.map(light => ({
      ...light, x: light.x + Math.sin(time * 0.19) * light.motion * 300,
      y: light.y + Math.cos(time * 0.13) * light.motion * 100, rgb: rgb(light.color).map(toLinear),
    }));
    const liveIds = new Set(scene.layers.map(layer => layer.id));
    for (const id of this.geometry.keys()) if (!liveIds.has(id)) this.geometry.delete(id);
    for (const layer of sortLayers(scene.layers)) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const key = JSON.stringify([scene.seed, scene.resolution, scene.cell.width, scene.cell.height, layer.type, layer.seedOffset,
        layer.type === 'procedural' ? layer.generator : layer.type === 'particles' ? layer.system : layer.text]);
      let entry = this.geometry.get(layer.id);
      if (!entry || entry.key !== key) {
        entry = { key, value: generate(layer, scene) };
        this.geometry.set(layer.id, entry);
      }
      const geo = entry.value;
      frame.generated += geo.count;
      const start = frame.count, parallax = effectiveParallax(layer);
      const scale = layer.scale * scene.camera.zoom * fit;
      const tint = rgb(layer.tint).map(toLinear);
      const fog = fogVisibility(1 - layer.depth, scene.environment.fogDensity * layer.fogInfluence, scene.environment.fogStart);
      const cw = scene.cell.width * scale, ch = scene.cell.height * scale;
      const kind = layer.type === 'procedural' ? layer.generator.name : layer.type === 'particles' ? layer.system.name : 'text';
      const speed = layer.type === 'procedural' ? layer.generator.speed : layer.type === 'particles' ? layer.system.speed : 0;
      const skip = layer.type === 'particles' ? quality === 'low' ? 3 : quality === 'medium' ? 2 : 1 : 1;
      for (let i = 0; i < geo.count; i += skip) {
        const off = i * GEOMETRY_STRIDE, d = geo.data;
        let wx = d[off], wy = d[off + 1], brightness = d[off + 3];
        const phase = d[off + 6], aux = d[off + 7];
        if (kind === 'fish') { wx = modulo(wx + time * speed * 35 + scene.resolution.width / 2 + 100, scene.resolution.width + 200) - scene.resolution.width / 2 - 100; wy += Math.sin(time * 0.7 + phase) * 8; }
        if (kind === 'boats') wy += Math.sin(time * speed + phase) * 4;
        if (kind === 'kelp' || kind === 'trees') wx += Math.sin(time * (0.5 + speed) + phase + wy * 0.007) * scene.environment.wind * (kind === 'kelp' ? 12 : 4);
        if (kind === 'haze') wx += Math.sin(time * 0.12 + phase) * 20;
        if (kind === 'water' || kind === 'rays') brightness *= 0.85 + Math.sin(time * speed + phase) * 0.15;
        if (layer.type === 'particles') {
          const direction = kind === 'rain' ? 1 : -1;
          wy = modulo(wy + direction * time * speed * (kind === 'rain' ? 250 : 45) * aux + scene.resolution.height / 2, scene.resolution.height) - scene.resolution.height / 2;
          wx += Math.sin(time * 0.35 + phase) * (kind === 'rain' ? 5 : 20);
          if (kind === 'fireflies') brightness *= 0.55 + Math.sin(time * 1.2 + phase) * 0.45;
        }
        wx += layer.position.x; wy += layer.position.y;
        const x = width / 2 + (wx - scene.camera.x * parallax) * scale;
        const y = height / 2 + (wy - scene.camera.y * parallax) * scale;
        const cellW = cw * d[off + 5], cellH = ch * d[off + 5];
        if (x + cellW < 0 || y + cellH < 0 || x > width || y > height) continue;
        if (frame.count >= MAX_GLYPHS) { frame.clipped = true; break; }
        const ambient = scene.environment.ambient * (0.6 + scene.environment.timeOfDay * 0.8);
        let lr = ambient, lg = ambient, lb = ambient;
        for (const light of lights) {
          const dx = wx - light.x, dy = wy - light.y;
          let power = Math.max(0, 1 - Math.hypot(dx, dy) / light.radius) ** 2 * light.intensity * layer.lightResponse;
          if (light.spot) power *= Math.max(0, (dy + light.radius * 0.35) / Math.max(1, Math.hypot(dx, dy))) ** 2;
          lr += light.rgb[0] * power; lg += light.rgb[1] * power; lb += light.rgb[2] * power;
        }
        const ptr = frame.count++ * FRAME_STRIDE;
        this.buffer[ptr] = x; this.buffer[ptr + 1] = y; this.buffer[ptr + 2] = cellW; this.buffer[ptr + 3] = cellH;
        this.buffer[ptr + 4] = layer.type === 'textGrid' && (d[off + 2] <= 126 || scene.cell.glyphMode === 'block' || scene.cell.glyphMode === 'braille')
          ? d[off + 2] : modeGlyph(d[off + 2], brightness, scene.cell.glyphMode, i + layer.seedOffset);
        this.buffer[ptr + 5] = clamp(toSrgb(lerp(fogColor[0] * 0.4, tint[0] * brightness * lr, fog)));
        this.buffer[ptr + 6] = clamp(toSrgb(lerp(fogColor[1] * 0.4, tint[1] * brightness * lg, fog)));
        this.buffer[ptr + 7] = clamp(toSrgb(lerp(fogColor[2] * 0.4, tint[2] * brightness * lb, fog)));
        this.buffer[ptr + 8] = layer.opacity * (0.5 + fog * 0.5);
        this.buffer[ptr + 9] = d[off + 4];
      }
      frame.batches.push({ start, count: frame.count - start, additive: layer.blendMode === 'additive' });
    }
    return frame;
  }
}
