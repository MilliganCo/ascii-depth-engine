import { createLayer, type Layer, type Project, type Scene } from './model';

export const demoNames = { abyss: 'Погружение', forest: 'Тихий лес', harbor: 'Неоновая гавань' } as const;
export const generatorLabels: Record<string, string> = {
  rays: 'Световые лучи', terrain: 'Рельеф', kelp: 'Водоросли', fish: 'Рыбы', haze: 'Туманные полосы',
  stars: 'Звёзды', trees: 'Деревья', city: 'Здания', water: 'Вода и отражения', crane: 'Портовые краны', boats: 'Лодки',
  bubbles: 'Пузырьки', dust: 'Взвесь', rain: 'Дождь', fireflies: 'Светлячки',
};
export const palettes = {
  ocean: { name: 'Глубокая вода', background: '#040e18', fogColor: '#173b50', colors: ['#284c67', '#39738a', '#58a2b2', '#82d0cd'] },
  forest: { name: 'Рассвет', background: '#101d22', fogColor: '#425d5c', colors: ['#556e72', '#6f9080', '#8cb393', '#d0c998'] },
  neon: { name: 'Ночная гавань', background: '#090e22', fogColor: '#303657', colors: ['#475472', '#74749c', '#c39baf', '#e1bf8b'] },
  mono: { name: 'Mono Terminal · зелёный', background: '#06110c', fogColor: '#0c2617', colors: ['#72df96', '#72df96', '#72df96', '#72df96'] },
  amber: { name: 'Mono Terminal · янтарный', background: '#160c03', fogColor: '#352006', colors: ['#eab76a', '#eab76a', '#eab76a', '#eab76a'] },
};
export function applyPalette(project: Project, key: Scene['environment']['palette']): Project {
  const palette = palettes[key];
  return { ...project, scene: { ...project.scene,
    environment: { ...project.scene.environment, palette: key, background: palette.background, fogColor: palette.fogColor },
    lights: project.scene.lights.map(light => ({ ...light, color: palette.colors[3] })),
    layers: project.scene.layers.map(layer => ({ ...layer, tint: palette.colors[Math.min(3, Math.floor(layer.depth * 4))] })),
  } };
}
export function makeDemo(key: keyof typeof demoNames): Project {
  let sequence = 0;
  const layers: Layer[] = [];
  const proc = (name: string, generator: Extract<Layer, { type: 'procedural' }>['generator']['name'], depth: number, color: string, options: Partial<Extract<Layer, { type: 'procedural' }>['generator']> = {}, extra: Partial<Layer> = {}) => {
    const layer = createLayer('procedural', key + '-layer-' + sequence++) as Extract<Layer, { type: 'procedural' }>;
    layers.push({ ...layer, name, depth, tint: color, seedOffset: sequence * 997, generator: { ...layer.generator, ...options, name: generator }, ...extra } as Layer);
  };
  const particles = (name: string, kind: Extract<Layer, { type: 'particles' }>['system']['name'], depth: number, count: number, tint: string, speed: number) => {
    const layer = createLayer('particles', key + '-layer-' + sequence++) as Extract<Layer, { type: 'particles' }>;
    layers.push({ ...layer, name, depth, tint, seedOffset: sequence * 997, system: { name: kind, count, speed, size: depth > 0.8 ? 1.4 : 0.7 } });
  };
  if (key === 'abyss') {
    proc('Свет с поверхности', 'rays', 0.02, '#87cad2', { density: 0.84, horizon: 0.05, amplitude: 0.65 }, { opacity: 0.9, blendMode: 'additive', fogInfluence: 0.35 });
    proc('Дальняя синева', 'haze', 0.08, '#355a71', { horizon: 0.35, amplitude: 0.15, density: 0.34 }, { opacity: 0.36 });
    proc('Глубинный хребет', 'terrain', 0.16, '#355b79', { horizon: 0.72, amplitude: 0.26, frequency: 2, variation: 0.1 }, { lightResponse: 0.5 });
    particles('Далёкая взвесь', 'dust', 0.22, 100, '#6295ae', 0.15);
    proc('Рыбы в глубине', 'fish', 0.28, '#6b9cb0', { count: 10, horizon: 0.32, amplitude: 0.22, speed: 0.28 }, { scale: 0.55 });
    proc('Средний риф', 'terrain', 0.38, '#5794a5', { horizon: 0.82, amplitude: 0.3, frequency: 2, variation: 0.65 });
    proc('Лес ламинарии', 'kelp', 0.47, '#4b949a', { count: 25, horizon: 0.92, amplitude: 0.42, speed: 0.4 });
    proc('Стайка серебристых рыб', 'fish', 0.56, '#9adad6', { count: 16, horizon: 0.4, amplitude: 0.28, speed: 0.38 });
    particles('Пузырьки среднего плана', 'bubbles', 0.64, 38, '#6dabae', 0.35);
    proc('Скалы переднего плана', 'terrain', 0.73, '#70a5a2', { horizon: 0.99, amplitude: 0.52, frequency: 1.2, density: 0.68, variation: 0.95 }, { fogInfluence: 0.4 });
    proc('Кораллы и растения', 'kelp', 0.84, '#92dcbd', { count: 10, horizon: 1, amplitude: 0.3, speed: 0.55 }, { fogInfluence: 0.3 });
    particles('Близкие пузырьки', 'bubbles', 0.93, 16, '#b3e7df', 0.48);
    proc('Пелена у камеры', 'haze', 0.96, '#598d9b', { horizon: 0.75, amplitude: 0.12, density: 0.18 }, { opacity: 0.15, blendMode: 'additive' });
  } else if (key === 'forest') {
    proc('Рассветное небо', 'rays', 0.02, '#c4cda7', { density: 0.5, amplitude: 0.8 }, { opacity: 0.6, blendMode: 'additive' });
    proc('Дальние горы', 'terrain', 0.1, '#637d84', { horizon: 0.6, amplitude: 0.28, frequency: 3 });
    proc('Низкие облака', 'haze', 0.16, '#96b5aa', { horizon: 0.28, amplitude: 0.1 }, { opacity: 0.25 });
    proc('Дальний лес', 'trees', 0.25, '#54776d', { count: 40, horizon: 0.88, amplitude: 0.48, variation: 0.2 });
    proc('Утренний туман', 'haze', 0.34, '#b9c8ab', { horizon: 0.6, amplitude: 0.15 }, { opacity: 0.4, blendMode: 'additive' });
    proc('Средние деревья', 'trees', 0.44, '#81a28c', { count: 19, horizon: 1, amplitude: 0.8 });
    proc('Полоса земли', 'terrain', 0.53, '#53685b', { horizon: 0.97, amplitude: 0.12, frequency: 4 });
    particles('Светлячки', 'fireflies', 0.61, 42, '#dfdca5', 0.4);
    proc('Ближние стволы', 'trees', 0.72, '#afbea0', { count: 7, horizon: 1, amplitude: 1, variation: 0.85 });
    proc('Папоротники', 'kelp', 0.82, '#9fc59d', { count: 30, horizon: 1, amplitude: 0.24, variation: 0.9 });
    proc('Передние ветви', 'trees', 0.92, '#c1c6a4', { count: 3, horizon: 1, amplitude: 1, variation: 1 }, { position: { x: -420, y: 80 }, scale: 1.3 });
    particles('Пыль в лучах', 'dust', 0.98, 65, '#d9d0a0', 0.15);
  } else {
    proc('Ночное небо', 'stars', 0.03, '#849cc3', { count: 100, horizon: 0.5, density: 0.8 });
    proc('Облака над портом', 'haze', 0.12, '#777da1', { horizon: 0.25, amplitude: 0.12 }, { opacity: 0.27 });
    proc('Дальний квартал', 'city', 0.21, '#485777', { horizon: 0.69, amplitude: 0.52, count: 22, variation: 0.35 });
    proc('Средние здания и окна', 'city', 0.33, '#9d91af', { horizon: 0.7, amplitude: 0.56, count: 15, variation: 0.7 });
    proc('Дым у крыш', 'haze', 0.4, '#777294', { horizon: 0.4, amplitude: 0.12 }, { opacity: 0.23 });
    proc('Портовые краны', 'crane', 0.48, '#b4a6b6', { count: 3, horizon: 0.72, amplitude: 0.64 });
    const sign = createLayer('textGrid', key + '-layer-' + sequence++) as Extract<Layer, { type: 'textGrid' }>;
    layers.push({ ...sign, name: 'Неоновая вывеска', text: '[ N O R T H   P I E R ]', depth: 0.54, position: { x: 170, y: 40 }, scale: 0.9, tint: '#e6af8c', blendMode: 'additive', lightResponse: 0 });
    proc('Вода и отражения', 'water', 0.61, '#827995', { horizon: 0.72, amplitude: 0.6, density: 0.6, speed: 0.3 });
    proc('Лодки', 'boats', 0.69, '#cdb896', { count: 5, horizon: 0.77, amplitude: 0.16, speed: 0.2 });
    proc('Ближний причал', 'terrain', 0.79, '#6f798a', { horizon: 0.99, amplitude: 0.09, frequency: 0.3 });
    particles('Дождь над водой', 'rain', 0.87, 220, '#a9b9d0', 0.6);
    proc('Дымка на набережной', 'haze', 0.95, '#93849e', { horizon: 0.88, amplitude: 0.1 }, { opacity: 0.2, blendMode: 'additive' });
  }
  const palette = palettes[key === 'abyss' ? 'ocean' : key === 'forest' ? 'forest' : 'neon'];
  return {
    format: 'ascii-depth-engine', schemaVersion: 1, id: key, name: demoNames[key],
    scene: { seed: key === 'abyss' ? 73129 : key === 'forest' ? 42017 : 91281,
      resolution: { width: 1600, height: 900 }, cell: { width: 12.5, height: 18.75, glyphMode: 'structural' },
      camera: { x: 0, y: 0, zoom: 1, cinematic: true },
      environment: { background: palette.background, fogColor: palette.fogColor, fogDensity: 0.85, fogStart: 0.1, ambient: 0.65, wind: 0.5, timeOfDay: key === 'forest' ? 0.5 : 0.25, palette: key === 'abyss' ? 'ocean' : key === 'forest' ? 'forest' : 'neon' },
      layers,
      lights: [{ id: key + '-light', x: key === 'abyss' ? -300 : 200, y: -260, radius: 780, intensity: 1.35, color: palette.colors[3], motion: 0.35, spot: key === 'abyss' }],
      timeline: { duration: 60, loop: true, tracks: [] },
    },
  };
}
