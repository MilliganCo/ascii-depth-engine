import { z } from 'zod';

const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
const id = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет должен иметь формат #RRGGBB');
const point = z.object({ x: finite(-8000, 8000), y: finite(-8000, 8000) });
const point3 = z.object({ x: finite(-4096, 4096), y: finite(-4096, 4096), z: finite(-4096, 4096) });
export const spatialSchema = z.object({
  enabled: z.boolean(), navigation: z.enum(['orbit', 'walk']), speed: finite(1, 30),
  camera: z.object({ position: point3, target: point3 }).refine(camera =>
    Math.hypot(camera.position.x - camera.target.x, camera.position.y - camera.target.y, camera.position.z - camera.target.z) > 0.01,
  'Направление 3D-камеры не может быть нулевым'),
});
export type Spatial = z.infer<typeof spatialSchema>;
export const defaultSpatial = (): Spatial => ({
  enabled: true, navigation: 'orbit', speed: 8,
  camera: { position: { x: 18, y: 20, z: 38 }, target: { x: 0, y: 3, z: 0 } },
});
export const glyphModes = ['basic', 'structural', 'block', 'braille'] as const;
export const generatorNames = ['rays', 'terrain', 'kelp', 'fish', 'haze', 'stars', 'trees', 'city', 'water', 'crane', 'boats'] as const;
export const particleNames = ['bubbles', 'dust', 'rain', 'fireflies'] as const;
const base = z.object({
  id, name: z.string().min(1).max(100), visible: z.boolean(), locked: z.boolean(),
  depth: finite(0, 1), parallaxFactor: z.union([finite(0, 2), z.literal('auto')]),
  position: point, scale: finite(0.1, 4), opacity: finite(0, 1),
  fogInfluence: finite(0, 2), lightResponse: finite(0, 2),
  blendMode: z.enum(['normal', 'additive']), tint: color,
  seedOffset: z.number().int().min(0).max(0xffffffff),
});
export const layerSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('textGrid'), text: z.string().max(12000).refine(text =>
    text.split('\n').length <= 100 && text.split('\n').every(line => [...line].length <= 200) &&
    [...text].every(char => char === '\n' || char === '\r' || /^[\x20-\x7e\u2500-\u259f\u2800-\u28ff]$/.test(char)),
  'Текст: до 200 × 100 символов; ASCII, линии, блоки или Braille, без управляющих кодов и emoji'), }),
  base.extend({ type: z.literal('procedural'), generator: z.object({
    name: z.enum(generatorNames), density: finite(0, 1), amplitude: finite(0, 1),
    frequency: finite(0.2, 8), speed: finite(0, 3), variation: finite(0, 1),
    horizon: finite(0, 1), count: z.number().int().min(1).max(120),
  }) }),
  base.extend({ type: z.literal('particles'), system: z.object({
    name: z.enum(particleNames), count: z.number().int().min(0).max(800), speed: finite(0, 3), size: finite(0.5, 2),
  }) }),
]);
const trackSchema = z.object({
  id, target: z.enum(['camera', 'layer', 'light']), targetId: id.optional(),
  property: z.enum(['x', 'y', 'zoom', 'opacity', 'intensity', 'visible']),
  keys: z.array(z.object({ time: finite(0, 600), value: z.union([finite(-8000, 8000), z.boolean()]), interpolation: z.enum(['linear', 'easeInOut', 'step']) })).min(1).max(256),
});
export const projectSchema = z.object({
  format: z.literal('ascii-depth-engine'), schemaVersion: z.literal(1),
  id, name: z.string().min(1).max(100),
  scene: z.object({
    seed: z.number().int().min(0).max(0xffffffff),
    resolution: z.object({ width: z.number().int().min(320).max(2560), height: z.number().int().min(240).max(1440) }),
    cell: z.object({ width: finite(8, 32), height: finite(12, 48), glyphMode: z.enum(glyphModes) }),
    camera: z.object({ x: finite(-8000, 8000), y: finite(-8000, 8000), zoom: finite(0.3, 4), cinematic: z.boolean() }),
    spatial: spatialSchema.optional(),
    environment: z.object({ background: color, fogColor: color, fogDensity: finite(0, 4), fogStart: finite(0, 1),
      ambient: finite(0, 1.5), wind: finite(0, 2), timeOfDay: finite(0, 1), palette: z.enum(['ocean', 'forest', 'neon', 'mono', 'amber']) }),
    layers: z.array(layerSchema).max(64),
    lights: z.array(z.object({ id, ...point.shape, radius: finite(20, 2400), intensity: finite(0, 3), color, motion: finite(0, 1), spot: z.boolean() })).max(4),
    timeline: z.object({ duration: finite(1, 600), loop: z.boolean(), tracks: z.array(trackSchema).max(64) }),
  }).superRefine((scene, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (scene.resolution.width / scene.cell.width * scene.resolution.height / scene.cell.height > 24000) fail('Сетка превышает 24 000 ячеек');
    const ids = [...scene.layers, ...scene.lights, ...scene.timeline.tracks].map(item => item.id);
    if (new Set(ids).size !== ids.length) fail('ID объектов должны быть уникальными');
    if (scene.timeline.tracks.reduce((sum, track) => sum + track.keys.length, 0) > 2048) fail('Слишком много ключевых кадров');
    for (const track of scene.timeline.tracks) {
      const allowed = track.target === 'camera' ? ['x', 'y', 'zoom'] : track.target === 'layer' ? ['x', 'y', 'opacity', 'visible'] : ['intensity'];
      if (!allowed.includes(track.property)) fail('Недопустимое свойство дорожки');
      if (track.target !== 'camera' && !(track.target === 'layer' ? scene.layers : scene.lights).some(item => item.id === track.targetId)) fail('Дорожка ссылается на отсутствующий объект');
      let previous = -1;
      for (const key of track.keys) {
        if (key.time <= previous || key.time > scene.timeline.duration) fail('Времена ключей должны возрастать и находиться внутри длительности');
        previous = key.time;
        if (track.property === 'visible' ? typeof key.value !== 'boolean' : typeof key.value !== 'number') fail('Тип значения ключа не соответствует свойству');
        if (typeof key.value === 'number') {
          const [min, max] = track.property === 'zoom' ? [0.3, 4] : track.property === 'opacity' ? [0, 1] : track.property === 'intensity' ? [0, 3] : [-8000, 8000];
          if (key.value < min || key.value > max) fail('Значение ключа вне диапазона');
        }
      }
    }
  }),
});
export type Project = z.infer<typeof projectSchema>;
export type Scene = Project['scene'];
export type Layer = Scene['layers'][number];
export type Track = Scene['timeline']['tracks'][number];
export type GlyphMode = Scene['cell']['glyphMode'];
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

export function parseProject(text: string): Project {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('Проект больше 2 МБ');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Файл не содержит корректный JSON'); }
  // Unknown versions stop at this migration boundary instead of being guessed.
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1) throw new Error('Поддерживается только версия проекта 1');
  const result = projectSchema.safeParse(value);
  if (!result.success) throw new Error('Некорректный проект: ' + result.error.issues.slice(0, 3).map(issue => issue.path.join('.') + ': ' + issue.message).join('; '));
  return result.data;
}
export const serializeProject = (project: Project) => JSON.stringify(projectSchema.parse(project), null, 2);

export function createLayer(type: Layer['type'], layerId: string): Layer {
  const common = { id: layerId, name: 'Новый слой', visible: true, locked: false, depth: 0.8,
    parallaxFactor: 'auto' as const, position: { x: 0, y: 0 }, scale: 1, opacity: 1, fogInfluence: 1,
    lightResponse: 1, blendMode: 'normal' as const, tint: '#83d8ce', seedOffset: 0 };
  if (type === 'textGrid') return { ...common, type, text: '   /\\____/\\\n  (  o  o )\n   > -- <' };
  if (type === 'particles') return { ...common, type, name: 'Частицы', blendMode: 'additive', system: { name: 'bubbles', count: 80, speed: 0.5, size: 1 } };
  return { ...common, type, name: 'Рельеф', generator: { name: 'terrain', density: 0.75, amplitude: 0.3, frequency: 2, speed: 0.2, variation: 0.5, horizon: 0.7, count: 18 } };
}
