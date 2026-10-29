export const ATLAS_COLS = 16, TILE_W = 32, TILE_H = 48;
export const atlasCodes = [0, ...Array.from({ length: 95 }, (_, i) => i + 32), 0x2591, 0x2592, 0x2593, 0x2588, ...Array.from({ length: 256 }, (_, i) => 0x2800 + i)];
export const atlasIndex = new Map(atlasCodes.map((code, i) => [code, i]));
export function createAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_W; canvas.height = Math.ceil(atlasCodes.length / ATLAS_COLS) * TILE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.font = '38px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  atlasCodes.forEach((code, index) => {
    const x = index % ATLAS_COLS * TILE_W, y = Math.floor(index / ATLAS_COLS) * TILE_H;
    if (code === 0) ctx.fillRect(x + 2, y + 2, TILE_W - 4, TILE_H - 4);
    else ctx.fillText(String.fromCodePoint(code), x + TILE_W / 2, y + TILE_H / 2, TILE_W - 4);
  });
  return canvas;
}
