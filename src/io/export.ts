import type { Scene } from '../model';
import { Compositor, FRAME_STRIDE, type RenderFrame } from '../engine/compositor';
import { CanvasRenderer } from '../renderers/canvas';
import { WebGLRenderer } from '../renderers/webgl';
import { SpatialRenderer } from '../renderers/spatial';
import { defaultSpatial } from '../model';

export function textFrame(frame: RenderFrame, columns: number, rows: number, ansi = false): string {
  const chars = new Array<string>(columns * rows).fill(' ');
  const colors = new Uint8Array(columns * rows * 3);
  const cw = frame.width / columns, ch = frame.height / rows;
  for (let i = 0; i < frame.count; i++) {
    const p = i * FRAME_STRIDE, data = frame.data;
    const x = Math.floor((data[p] + data[p + 2] / 2) / cw), y = Math.floor((data[p + 1] + data[p + 3] / 2) / ch);
    if (x < 0 || y < 0 || x >= columns || y >= rows || data[p + 8] < 0.12) continue;
    const code = data[p + 4];
    // Escape, C0/C1, bidi and wide characters can never become terminal control data.
    if (!(code >= 32 && code <= 126 || code >= 0x2500 && code <= 0x259f || code >= 0x2800 && code <= 0x28ff)) continue;
    const index = y * columns + x;
    chars[index] = String.fromCodePoint(code);
    for (let c = 0; c < 3; c++) colors[index * 3 + c] = Math.round(data[p + 5 + c] * 255);
  }
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '', previous = '';
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      if (ansi && chars[i] !== ' ') {
        const color = colors.subarray(i * 3, i * 3 + 3).join(';');
        if (color !== previous) { line += '\x1b[38;2;' + color + 'm'; previous = color; }
      }
      line += chars[i];
    }
    lines.push(line + (ansi ? '\x1b[0m' : ''));
  }
  return lines.join('\n') + (ansi ? '\x1b[0m' : '');
}
export function exportText(scene: Scene, time: number, ansi: boolean): string {
  if (scene.spatial?.enabled) throw new Error('Для 3D используйте exportSpatialText');
  const width = scene.resolution.width, height = scene.resolution.height;
  return textFrame(new Compositor().compose(scene, time, width, height), Math.floor(width / scene.cell.width), Math.floor(height / scene.cell.height), ansi);
}
export async function exportSpatialText(scene: Scene, time: number, ansi: boolean): Promise<string> {
  const canvas = document.createElement('canvas'), renderer = new SpatialRenderer(canvas);
  try {
    renderer.resize(scene.resolution.width, scene.resolution.height);
    renderer.setCamera((scene.spatial ?? defaultSpatial()).camera); renderer.render(scene, time);
    return await renderer.text(ansi);
  } finally { renderer.dispose(); canvas.width = 0; canvas.height = 0; }
}
export async function exportPNG(scene: Scene, time: number, width: number, height: number, backend = 'WebGL2'): Promise<Blob> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240 || width > 4096 || height > 4096 || width * height > 12000000) throw new Error('PNG: от 320 × 240 до 4096 × 4096, максимум 12 Мп');
  let canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  let renderer: CanvasRenderer | WebGLRenderer | SpatialRenderer;
  try { renderer = scene.spatial?.enabled ? new SpatialRenderer(canvas) : backend === 'Canvas2D' ? new CanvasRenderer(canvas) : new WebGLRenderer(canvas); }
  catch {
    if (scene.spatial?.enabled) throw new Error('Для экспорта 3D требуется WebGL2');
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    renderer = new CanvasRenderer(canvas);
  }
  try {
    if (renderer instanceof SpatialRenderer) {
      renderer.resize(width, height); renderer.setCamera((scene.spatial ?? defaultSpatial()).camera); renderer.render(scene, time);
    } else renderer.render(new Compositor().compose(scene, time, width, height));
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Браузер не смог создать PNG');
    return blob;
  } finally { renderer.dispose(); canvas.width = 0; canvas.height = 0; }
}
