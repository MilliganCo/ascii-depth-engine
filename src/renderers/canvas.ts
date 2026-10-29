import { FRAME_STRIDE, type RenderFrame } from '../engine/compositor';

export class CanvasRenderer {
  readonly backend = 'Canvas2D';
  private ctx: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas2D недоступен');
    this.ctx = context;
  }
  render(frame: RenderFrame): number {
    const ctx = this.ctx;
    ctx.setTransform(this.canvas.width / frame.width, 0, 0, this.canvas.height / frame.height, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgb(' + frame.background.map(c => Math.round(c * 255)).join(',') + ')';
    ctx.fillRect(0, 0, frame.width, frame.height);
    const background = ctx.fillStyle;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let lastSize = -1;
    for (const batch of frame.batches) {
      ctx.globalCompositeOperation = batch.additive ? 'lighter' : 'source-over';
      for (let i = batch.start; i < batch.start + batch.count; i++) {
        const p = i * FRAME_STRIDE, d = frame.data;
        ctx.globalAlpha = d[p + 8];
        if (d[p + 9]) { ctx.fillStyle = background; ctx.fillRect(d[p], d[p + 1], d[p + 2], d[p + 3]); }
        ctx.fillStyle = 'rgb(' + [5, 6, 7].map(offset => Math.round(d[p + offset] * 255)).join(',') + ')';
        if (lastSize !== d[p + 3]) {
          lastSize = d[p + 3]; ctx.font = lastSize * 0.79 + 'px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
        }
        ctx.fillText(String.fromCodePoint(d[p + 4]), d[p] + d[p + 2] / 2, d[p + 1] + d[p + 3] / 2, d[p + 2] * 0.875);
      }
    }
    ctx.globalAlpha = 1;
    return frame.count;
  }
  dispose() {}
}
