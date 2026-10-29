import type { Layer, Scene } from '../model';
import { hash, noise } from './math';

// x, y, code point, luminance, solid background, size, phase, auxiliary value.
export const GEOMETRY_STRIDE = 8;
export type Geometry = { data: Float32Array; count: number };
export function generate(layer: Layer, scene: Scene): Geometry {
  const cells: number[] = [];
  const seed = (scene.seed + layer.seedOffset) >>> 0;
  const { width: w, height: h } = scene.resolution;
  const { width: cw, height: ch } = scene.cell;
  const cols = Math.ceil(w / cw), rows = Math.ceil(h / ch);
  const put = (x: number, y: number, char: string, luminance = 1, solid = 0, size = 1, phase = 0, aux = 0) =>
    cells.push(x, y, char.codePointAt(0)!, luminance, solid, size, phase, aux);
  const grid = (c: number, r: number, char: string, luminance = 1, solid = 0, phase = 0) => put(c * cw - w / 2, r * ch - h / 2, char, luminance, solid, 1, phase);
  const sprite = (x: number, y: number, lines: string[], brightness = 1, phase = 0, solid = 0) => {
    lines.forEach((line, r) => [...line].forEach((char, c) => { if (char !== ' ') put(x + c * cw, y + r * ch, char, brightness, solid, 1, phase); }));
  };
  const line = (x1: number, y1: number, x2: number, y2: number, char: string, brightness = 1, phase = 0) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1) / cw, Math.abs(y2 - y1) / ch)));
    for (let i = 0; i <= steps; i++) put(Math.round((x1 + (x2 - x1) * i / steps) / cw) * cw, Math.round((y1 + (y2 - y1) * i / steps) / ch) * ch, char, brightness, 1, 1, phase);
  };
  if (layer.type === 'textGrid') {
    const lines = layer.text.replace(/\r/g, '').split('\n');
    sprite(-Math.max(...lines.map(row => [...row].length)) * cw / 2, -lines.length * ch / 2, lines);
  } else if (layer.type === 'particles') {
    for (let i = 0; i < layer.system.count; i++) {
      const chars = layer.system.name === 'bubbles' ? 'oO.' : layer.system.name === 'rain' ? '/|' : layer.system.name === 'fireflies' ? '+*.' : '.:';
      put((hash(seed, i, 1) - 0.5) * w, (hash(seed, i, 2) - 0.5) * h,
        chars[Math.floor(hash(seed, i, 3) * chars.length)], 0.45 + hash(seed, i, 4) * 0.55, 0, layer.system.size, hash(seed, i, 5) * 6.28, 0.5 + hash(seed, i, 6));
    }
  } else {
    const p = layer.generator;
    if (['terrain', 'rays', 'haze', 'water'].includes(p.name)) {
      for (let c = 0; c < cols; c++) {
        const profile = (column: number) => p.horizon - p.amplitude * (
          (noise(seed, column / cols * p.frequency * 4) * 0.75 + noise(seed + 99, column / cols * 12) * 0.25) * (1 - p.variation * 0.75)
          + Math.abs(column / cols * 2 - 1) ** 1.6 * p.variation);
        const ridge = profile(c);
        for (let r = 0; r < rows; r++) {
          const x = c / cols, y = r / rows, random = hash(seed, c, r);
          if (p.name === 'terrain' && y >= ridge) {
            const edge = y - ridge < 2 / rows;
            const distance = (y - ridge) / Math.max(0.1, 1 - ridge);
            const strata = Math.sin(c * 0.2 + r * 0.65 + noise(seed, c * 0.04) * 9);
            const detail = random < p.density * (0.15 + (1 - distance) * 0.5);
            const texture = !detail ? ' ' : strata > 0.8 ? '=' : strata > 0.4 ? '-' : random > 0.6 ? ':' : '.';
            const slope = profile(c + 1) - ridge;
            grid(c, r, edge ? slope < -0.008 ? '/' : slope > 0.008 ? '\\' : '_' : texture, edge ? 1.05 : 0.25 + (1 - distance) * 0.5, 1);
          } else if (p.name === 'rays') {
            const beam = Math.exp(-(((x - 0.44 - y * 0.12) / (0.1 + y * 0.16)) ** 2)) *
              (0.3 + Math.max(0, Math.sin((x - y * 0.12) * (16 + p.frequency * 2))) ** 12 * 0.7);
            if (random < beam * p.density * (1 - y * 0.7)) grid(c, r, random > 0.4 ? ':' : '.', 0.4 + beam * (1 - y) * 0.8, 0, x * 7);
          } else if (p.name === 'haze') {
            const band = Math.exp(-(((y - p.horizon - Math.sin(x * 7) * 0.04) / Math.max(0.025, p.amplitude)) ** 2));
            if (random < band * p.density) grid(c, r, '.:-'[Math.floor(random * 3)], band * 0.6, 0, x * 6);
          } else if (p.name === 'water' && y >= p.horizon && random < p.density) {
            const reflection = (Math.sin(x * 43) ** 8) * (1 - (y - p.horizon));
            grid(c, r, random < 0.3 ? '~' : random < 0.65 ? '-' : '=', 0.25 + reflection * 0.8, 0, x * 12 + y * 17);
          }
        }
      }
    } else if (p.name === 'stars') {
      for (let i = 0; i < p.count; i++) put((hash(seed, i, 1) - 0.5) * w, (hash(seed, i, 2) * p.horizon - 0.5) * h, i % 13 === 0 ? '+' : '.', 0.4 + hash(seed, i, 3) * 0.6, 0, 1, hash(seed, i, 4) * 6);
    } else if (p.name === 'fish' || p.name === 'boats') {
      for (let i = 0; i < p.count; i++) {
        const x = (hash(seed, i, 1) - 0.5) * w;
        const y = (p.horizon + (hash(seed, i, 2) - 0.5) * p.amplitude - 0.5) * h;
        const phase = hash(seed, i, 3) * 6.28;
        if (p.name === 'fish') sprite(x, y, i % 4 === 0 ? ['  __', '><_o>'] : ['><>'], 0.7 + hash(seed, i, 4) * 0.4, phase);
        else sprite(x, y, ['   |', ' __|__', '\\_____/'], 1, phase, 1);
      }
    } else if (p.name === 'kelp' || p.name === 'trees') {
      for (let i = 0; i < p.count; i++) {
        const x = (i / p.count - 0.5) * w + hash(seed, i, 1) * w / p.count;
        const baseY = (p.horizon - 0.5) * h;
        const length = (0.4 + hash(seed, i, 2) * 0.6) * p.amplitude * h;
        const phase = hash(seed, i, 3) * 6.28;
        if (p.name === 'kelp') {
          for (let r = 0; r < length / ch; r++) {
            const sway = Math.sin(r * 0.55 + phase) * (10 + p.variation * 20);
            put(x + sway, baseY - r * ch, r % 2 ? ')' : '(', 0.8, 1, 1, phase, r / Math.max(1, length / ch));
            if (r % 3 === 1) { put(x + sway - cw, baseY - r * ch, '/', 0.65, 1, 1, phase); put(x + sway + cw, baseY - r * ch, '\\', 0.65, 1, 1, phase); }
          }
        } else {
          const bend = (hash(seed, i, 4) - 0.5) * 100 * p.variation;
          line(x, baseY, x + bend, baseY - length, '|', 0.9, phase);
          if (length > 250) line(x + cw, baseY, x + bend + cw, baseY - length * 0.75, ':', 0.5, phase);
          for (let b = 1; b < 7; b++) {
            const fraction = b / 8, direction = b % 2 ? -1 : 1;
            const by = baseY - length * fraction, bx = x + bend * fraction;
            const reach = length * (0.22 + hash(seed + b, i, 5) * 0.18) * (1 - fraction * 0.6);
            const tx = bx + direction * reach, ty = by - reach * 0.65;
            line(bx, by, tx, ty, direction > 0 ? '/' : '\\', 0.8, phase);
            for (let leaf = 0; leaf < 16; leaf++) {
              const lx = tx + (hash(seed + b, i, leaf + 9) - 0.5) * reach * 0.9;
              const ly = ty + (hash(seed + b, i, leaf + 29) - 0.5) * 55;
              put(lx, ly, '*+x'[leaf % 3], 0.6 + hash(seed, i, leaf) * 0.4, 1, 1, phase);
            }
          }
        }
      }
    } else if (p.name === 'city') {
      for (let i = 0; i < p.count; i++) {
        const left = Math.floor(i / p.count * cols);
        const buildingWidth = Math.max(4, Math.floor(cols / p.count) - 1);
        const bottom = Math.floor(p.horizon * rows), top = bottom - Math.floor((0.3 + hash(seed, i) * 0.7) * p.amplitude * rows);
        for (let c = left; c < left + buildingWidth; c++) {
          for (let r = top; r < bottom; r++) {
            const edge = c === left || c === left + buildingWidth - 1;
            const window = !edge && c % 3 === 1 && r % 3 === 1 && hash(seed + i, c, r) < p.variation;
            grid(c, r, edge ? '|' : r === top ? '_' : window ? '#' : ':', window ? 1.5 : edge ? 0.65 : 0.18, 1);
          }
        }
      }
    } else if (p.name === 'crane') {
      for (let i = 0; i < p.count; i++) {
        const x = (i / Math.max(1, p.count - 1) - 0.5) * w * 0.75;
        const y = (p.horizon - 0.5) * h, length = h * p.amplitude * (0.5 + hash(seed, i) * 0.25);
        line(x, y, x, y - length, '|'); line(x - cw * 2, y, x, y - length, '/');
        line(x - 75, y - length, x + 240, y - length, '=');
        line(x, y - length - 55, x + 200, y - length, '\\', 0.8);
        line(x + 195, y - length, x + 195, y - length + 120, '|', 0.7);
        sprite(x + 185, y - length + 120, ['[ ]'], 0.8);
      }
    }
  }
  return { data: new Float32Array(cells), count: cells.length / GEOMETRY_STRIDE };
}
