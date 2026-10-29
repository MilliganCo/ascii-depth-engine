import { useId, useState } from 'react';
import { generatorNames, layerSchema, particleNames, type Layer, type Project, type Scene, type Track } from '../model';
import { effectiveParallax, evaluateScene } from '../engine/math';
import { applyPalette, generatorLabels, palettes } from '../scenes';

export function NumberField({ label, value, min, max, step = 0.01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const id = useId();
  const change = (raw: string) => { const number = Number(raw); if (raw !== '' && Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number))); };
  return <div className="number-field"><label htmlFor={id}>{label}</label><input id={id} aria-label={label} type="number" value={Math.round(value * 1000) / 1000} min={min} max={max} step={step} onChange={event => change(event.target.value)} />
    <input aria-label={label + ' — ползунок'} type="range" value={value} min={min} max={max} step={step} onChange={event => change(event.target.value)} /></div>;
}
type Props = { project: Project; selected: string; update: (next: Project, group?: string) => void; time: number; onError: (message: string) => void };
export function Inspector({ project, selected, update, time, onError }: Props) {
  const [tab, setTab] = useState<'layer' | 'scene' | 'keys'>('layer');
  const [lightId, setLightId] = useState('');
  const scene = project.scene, layer = scene.layers.find(item => item.id === selected);
  const light = scene.lights.find(item => item.id === lightId) ?? scene.lights[0];
  const changeScene = (patch: Partial<Scene>, group = '') => update({ ...project, scene: { ...scene, ...patch } }, group);
  const changeLayer = (patch: Partial<Layer>, group = '') => {
    if (!layer || layer.locked) return;
    const result = layerSchema.safeParse({ ...layer, ...patch });
    if (!result.success) { onError(result.error.issues[0].message); return; }
    changeScene({ layers: scene.layers.map(item => item.id === selected ? result.data : item) }, group);
  };
  const layerNumber = (label: string, property: 'depth' | 'scale' | 'opacity' | 'fogInfluence' | 'lightResponse', min: number, max: number) =>
    layer && <NumberField label={label} value={layer[property]} min={min} max={max} onChange={value => changeLayer({ [property]: value }, selected + property)} />;
  const generatorNumber = (label: string, property: 'density' | 'amplitude' | 'frequency' | 'speed' | 'variation' | 'horizon' | 'count', min: number, max: number, step = 0.01) => {
    if (layer?.type !== 'procedural') return null;
    if (scene.spatial?.enabled && (['density', 'horizon'].includes(property) || property === 'variation' && layer.generator.name === 'terrain' ||
      property === 'frequency' && layer.generator.name === 'rays' || property === 'speed' && ['water', 'rays'].includes(layer.generator.name))) return null;
    return <NumberField label={label} value={layer.generator[property]} min={min} max={max} step={step} onChange={value => changeLayer({ generator: { ...layer.generator, [property]: value } }, selected + property)} />;
  };
  return <aside className="inspector panel">
    <div className="tabs" role="tablist" aria-label="Свойства">
      {([['layer', 'Слой'], ['scene', 'Сцена'], ['keys', 'Ключи']] as const).map(([key, name]) => <button role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)}>{name}</button>)}
    </div>
    <div className="inspector-body">
      {tab === 'layer' && (layer ? <>
        <div className="inspector-heading"><span className="color-dot" style={{ background: layer.tint }} /><h2>{layer.name}</h2></div>
        <p className="muted">{layer.type === 'textGrid' ? 'Текстовая сетка' : layer.type === 'particles' ? 'Частицы' : 'Процедурный слой'}</p>
        {layer.locked && <p className="notice">Слой заблокирован. Снимите замок в списке слоёв.</p>}
        <fieldset disabled={layer.locked}>
          <label className="stack">Название<input aria-label="Название слоя" maxLength={100} value={layer.name} onChange={event => changeLayer({ name: event.target.value || 'Слой' }, selected + 'name')} /></label>
          {layerNumber('Глубина', 'depth', 0, 1)}
          {scene.spatial?.enabled ? <p className="muted">В 3D глубина задаёт смещение по Z. Позиции X/Y переводятся в мировые единицы: 20 = 1. Параллакс вычисляет перспективная камера.</p> : <>
          <div className="readout">Эффективный параллакс <strong>{effectiveParallax(layer).toFixed(2)}</strong></div>
          <label className="check"><input type="checkbox" checked={layer.parallaxFactor === 'auto'} onChange={event => changeLayer({ parallaxFactor: event.target.checked ? 'auto' : effectiveParallax(layer) })} />Параллакс по глубине</label>
          {layer.parallaxFactor !== 'auto' && <NumberField label="Параллакс" value={layer.parallaxFactor} min={0} max={2} onChange={value => changeLayer({ parallaxFactor: value }, selected + 'parallax')} />}</>}
          {layerNumber('Непрозрачность', 'opacity', 0, 1)}
          {layerNumber('Масштаб слоя', 'scale', 0.1, 4)}
          <NumberField label="Позиция X" value={layer.position.x} min={-1600} max={1600} step={1} onChange={value => changeLayer({ position: { ...layer.position, x: value } }, selected + 'x')} />
          <NumberField label="Позиция Y" value={layer.position.y} min={-900} max={900} step={1} onChange={value => changeLayer({ position: { ...layer.position, y: value } }, selected + 'y')} />
          <label className="color-field">Цвет<input aria-label="Цвет слоя" type="color" value={layer.tint} onChange={event => changeLayer({ tint: event.target.value }, selected + 'tint')} /><code>{layer.tint}</code></label>
          {scene.spatial?.enabled ? <label className="check"><input type="checkbox" checked={layer.fogInfluence > 0} onChange={event => changeLayer({ fogInfluence: event.target.checked ? 1 : 0 })} />Участвует в тумане</label> : <>
          {layerNumber('Влияние тумана', 'fogInfluence', 0, 2)}
          {layerNumber('Отклик на свет', 'lightResponse', 0, 2)}</>}
          <label className="stack">Наложение<select aria-label="Наложение" value={layer.blendMode} onChange={event => changeLayer({ blendMode: event.target.value as Layer['blendMode'] })}><option value="normal">Обычное</option><option value="additive">Аддитивное свечение</option></select></label>
          {layer.type === 'textGrid' && <label className="stack">Символы<textarea aria-label="Символы" rows={6} value={layer.text} onChange={event => changeLayer({ text: event.target.value }, selected + 'text')} spellCheck={false} /></label>}
          {layer.type === 'procedural' && <>
            <h3>Генератор</h3><select aria-label="Генератор" value={layer.generator.name} onChange={event => changeLayer({ generator: { ...layer.generator, name: event.target.value as typeof layer.generator.name } })}>{generatorNames.map(name => <option key={name} value={name}>{generatorLabels[name]}</option>)}</select>
            {scene.spatial?.enabled && layer.generator.name === 'haze' && <p className="muted">В 3D дымка создаётся общим туманом на вкладке «Сцена».</p>}
            {['rays', 'haze', 'water'].includes(layer.generator.name) && generatorNumber('Плотность', 'density', 0, 1)}
            {!['stars', 'rays'].includes(layer.generator.name) && generatorNumber('Высота / амплитуда', 'amplitude', 0, 1)}
            {['terrain', 'rays'].includes(layer.generator.name) && generatorNumber('Частота формы', 'frequency', 0.2, 8)}
            {['fish', 'boats', 'water', 'kelp', 'rays'].includes(layer.generator.name) && generatorNumber('Скорость движения', 'speed', 0, 3)}
            {['trees', 'kelp', 'city'].includes(layer.generator.name) && generatorNumber('Вариативность', 'variation', 0, 1)}
            {layer.generator.name === 'terrain' && generatorNumber('Рельеф у краёв', 'variation', 0, 1)}
            {!['rays'].includes(layer.generator.name) && generatorNumber('Уровень основания', 'horizon', 0, 1)}
            {['fish', 'boats', 'trees', 'kelp', 'city', 'stars', 'crane'].includes(layer.generator.name) && generatorNumber('Количество объектов', 'count', 1, 120, 1)}
          </>}
          {layer.type === 'particles' && <>
            <h3>Частицы</h3><select aria-label="Тип частиц" value={layer.system.name} onChange={event => changeLayer({ system: { ...layer.system, name: event.target.value as typeof layer.system.name } })}>{particleNames.map(name => <option key={name} value={name}>{generatorLabels[name]}</option>)}</select>
            <NumberField label="Количество частиц" value={layer.system.count} min={0} max={800} step={1} onChange={value => changeLayer({ system: { ...layer.system, count: value } }, selected + 'count')} />
            <NumberField label="Скорость частиц" value={layer.system.speed} min={0} max={3} onChange={value => changeLayer({ system: { ...layer.system, speed: value } }, selected + 'speed')} />
            <NumberField label="Размер частиц" value={layer.system.size} min={0.5} max={2} onChange={value => changeLayer({ system: { ...layer.system, size: value } }, selected + 'size')} />
          </>}
          {layer.type !== 'textGrid' && <NumberField label="Seed слоя" value={layer.seedOffset} min={0} max={1000000} step={1} onChange={value => changeLayer({ seedOffset: value }, selected + 'seed')} />}
        </fieldset>
      </> : <p className="muted">Добавьте слой или выберите его слева.</p>)}
      {tab === 'scene' && <>
        <h2>Атмосфера</h2>
        <label className="stack">Название проекта<input aria-label="Название проекта" value={project.name} maxLength={100} onChange={event => update({ ...project, name: event.target.value || 'Без названия' }, 'project-name')} /></label>
        <label className="stack">Палитра<select aria-label="Палитра" value={scene.environment.palette} onChange={event => update(applyPalette(project, event.target.value as Scene['environment']['palette']))}>{Object.entries(palettes).map(([key, palette]) => <option key={key} value={key}>{palette.name}</option>)}</select></label>
        <NumberField label="Seed сцены" value={scene.seed} min={0} max={1000000} step={1} onChange={value => changeScene({ seed: value }, 'scene-seed')} />
        <NumberField label="Ширина ячейки" value={scene.cell.width} min={8} max={32} step={0.5} onChange={value => changeScene({ cell: { ...scene.cell, width: value, height: value * 1.5 } }, 'cell-size')} />
        {([['Плотность тумана', 'fogDensity', 4], ['Начало тумана', 'fogStart', 1], ['Рассеянный свет', 'ambient', 1.5], ['Ветер', 'wind', 2], ['Время суток', 'timeOfDay', 1]] as const).filter(([, property]) => !scene.spatial?.enabled || property !== 'fogStart').map(([label, property, max]) => <NumberField key={property} label={label} value={scene.environment[property]} min={0} max={max} onChange={value => changeScene({ environment: { ...scene.environment, [property]: value } }, property)} />)}
        <label className="color-field">Цвет тумана<input aria-label="Цвет тумана" type="color" value={scene.environment.fogColor} onChange={event => changeScene({ environment: { ...scene.environment, fogColor: event.target.value } }, 'fog-color')} /></label>
        <h3>Камера</h3>
        {scene.spatial?.enabled ? <>
          <p className="muted">Камера 3D: {scene.spatial.camera.position.x.toFixed(1)} / {scene.spatial.camera.position.y.toFixed(1)} / {scene.spatial.camera.position.z.toFixed(1)}. Управление над сценой.</p>
          <NumberField label="Скорость перемещения" value={scene.spatial.speed} min={1} max={30} step={1} onChange={value => changeScene({ spatial: { ...scene.spatial!, speed: value } }, 'spatial-speed')} />
          <p className="muted">Свободное движение без коллизий. Соседние чанки подгружаются по положению камеры.</p>
        </> : <>
        <label className="check"><input type="checkbox" checked={scene.camera.cinematic} onChange={event => changeScene({ camera: { ...scene.camera, cinematic: event.target.checked } })} />Медленный дрейф</label>
        {(['x', 'y', 'zoom'] as const).map(property => <NumberField key={property} label={property === 'zoom' ? 'Масштаб камеры' : 'Камера ' + property.toUpperCase()} value={scene.camera[property]} min={property === 'zoom' ? 0.3 : -1600} max={property === 'zoom' ? 4 : 1600} step={property === 'zoom' ? 0.01 : 1} onChange={value => changeScene({ camera: { ...scene.camera, [property]: value } }, 'camera-' + property)} />)}</>}
        <h3>Освещение</h3>
        <div className="inline"><select aria-label="Источник света" value={light?.id ?? ''} onChange={event => setLightId(event.target.value)}>{scene.lights.map((item, index) => <option value={item.id} key={item.id}>Источник {index + 1}</option>)}</select>
          <button disabled={scene.lights.length >= 4} onClick={() => changeScene({ lights: [...scene.lights, { id: crypto.randomUUID(), x: 0, y: 0, radius: 500, intensity: 1, color: '#b4dce0', motion: 0, spot: false }] })}>+</button>
          <button disabled={!light} aria-label="Удалить свет" onClick={() => light && changeScene({ lights: scene.lights.filter(item => item.id !== light.id), timeline: { ...scene.timeline, tracks: scene.timeline.tracks.filter(track => track.targetId !== light.id) } })}>−</button></div>
        {light && <>
          {([['Свет X', 'x', -1600, 1600], ['Свет Y', 'y', -900, 900], ['Радиус света', 'radius', 20, 2400], ['Интенсивность света', 'intensity', 0, 3], ['Движение света', 'motion', 0, 1]] as const).map(([label, property, min, max]) => <NumberField key={property} label={label} value={light[property]} min={min} max={max} step={property === 'x' || property === 'y' || property === 'radius' ? 1 : 0.01} onChange={value => changeScene({ lights: scene.lights.map(item => item.id === light.id ? { ...item, [property]: value } : item) }, light.id + property)} />)}
          <label className="color-field">Цвет света<input aria-label="Цвет света" type="color" value={light.color} onChange={event => changeScene({ lights: scene.lights.map(item => item.id === light.id ? { ...item, color: event.target.value } : item) }, light.id + 'color')} /></label>
          {!scene.spatial?.enabled && <label className="check"><input type="checkbox" checked={light.spot} onChange={event => changeScene({ lights: scene.lights.map(item => item.id === light.id ? { ...item, spot: event.target.checked } : item) })} />Направленный прожектор</label>}
        </>}
      </>}
      {tab === 'keys' && <KeyEditor project={project} selected={selected} lightId={light?.id} time={time} update={update} onError={onError} />}
    </div>
  </aside>;
}
function KeyEditor({ project, selected, lightId, time, update, onError }: Props & { lightId?: string }) {
  const [target, setTarget] = useState('camera:x');
  const [interpolation, setInterpolation] = useState<'linear' | 'easeInOut' | 'step'>('easeInOut');
  const scene = project.scene;
  const changeTracks = (tracks: Track[], group = '') => update({ ...project, scene: { ...scene, timeline: { ...scene.timeline, tracks } } }, group);
  const addKey = () => {
    const [kind, property] = target.split(':') as [Track['target'], Track['property']];
    const targetId = kind === 'layer' ? selected : kind === 'light' ? lightId : undefined;
    const evaluated = evaluateScene({ ...scene, camera: { ...scene.camera, cinematic: false } }, time);
    const object = kind === 'camera' ? evaluated.camera : kind === 'layer' ? evaluated.layers.find(layer => layer.id === targetId) : evaluated.lights.find(light => light.id === targetId);
    if (!object) { onError('Сначала выберите объект'); return; }
    const value = property === 'x' || property === 'y' ? 'position' in object ? object.position[property] : (object as Scene['camera'])[property] : (object as unknown as Record<string, number | boolean>)[property];
    const existing = scene.timeline.tracks.find(track => track.target === kind && track.targetId === targetId && track.property === property);
    const at = Math.min(scene.timeline.duration, Math.round(time * 100) / 100);
    const key = { time: at, value, interpolation };
    const track: Track = existing ?? { id: crypto.randomUUID(), target: kind, targetId, property, keys: [] };
    const next = { ...track, keys: [...track.keys.filter(item => Math.abs(item.time - at) > 0.009), key].sort((a, b) => a.time - b.time) };
    changeTracks(existing ? scene.timeline.tracks.map(item => item.id === track.id ? next : item) : [...scene.timeline.tracks, next]);
  };
  return <>
    <h2>Ключевые кадры</h2><p className="muted">Поставьте время на линейке, добавьте ключ. Значения дорожек управляют сценой при просмотре и экспорте.</p>
    {scene.spatial?.enabled && <p className="muted">Ключи камеры X/Y/zoom действуют в 2.5D. В 3D положение камеры сохраняется отдельно; ключи слоёв и света работают.</p>}
    <label className="stack">Свойство<select aria-label="Свойство ключа" value={target} onChange={event => setTarget(event.target.value)}>
      <option value="camera:x">Камера X</option><option value="camera:y">Камера Y</option><option value="camera:zoom">Масштаб камеры</option>
      <option value="layer:opacity">Выбранный слой · непрозрачность</option><option value="layer:x">Выбранный слой · X</option><option value="layer:y">Выбранный слой · Y</option><option value="layer:visible">Выбранный слой · видимость</option>
      <option value="light:intensity">Выбранный свет · интенсивность</option>
    </select></label>
    <label className="stack">Интерполяция<select aria-label="Интерполяция нового ключа" value={interpolation} onChange={event => setInterpolation(event.target.value as typeof interpolation)}><option value="easeInOut">Плавная</option><option value="linear">Линейная</option><option value="step">Ступенчатая</option></select></label>
    <button className="primary wide" onClick={addKey} disabled={scene.timeline.tracks.length >= 64}>Добавить ключ в {time.toFixed(2)} с</button>
    {scene.timeline.tracks.map(track => <div className="track" key={track.id}><h3>{track.target === 'camera' ? 'Камера' : track.target === 'light' ? 'Свет' : scene.layers.find(layer => layer.id === track.targetId)?.name} · {track.property}</h3>
      {track.keys.map((key, index) => <div className="key-row" key={index}>
        <input aria-label="Время ключа" type="number" value={key.time} min={0} max={scene.timeline.duration} step={0.01} onChange={event => {
          const value = Number(event.target.value);
          if (track.keys.some((item, i) => i !== index && item.time === value)) return;
          changeTracks(scene.timeline.tracks.map(item => item.id !== track.id ? item : { ...item, keys: item.keys.map((entry, i) => i === index ? { ...entry, time: value } : entry).sort((a, b) => a.time - b.time) }), track.id + 'time-' + index);
        }} />
        {typeof key.value === 'boolean' ? <input aria-label="Видимость ключа" type="checkbox" checked={key.value} onChange={event => changeTracks(scene.timeline.tracks.map(item => item.id !== track.id ? item : { ...item, keys: item.keys.map((entry, i) => i === index ? { ...entry, value: event.target.checked } : entry) }))} /> :
          <input aria-label="Значение ключа" type="number" value={key.value} step={0.01} onChange={event => changeTracks(scene.timeline.tracks.map(item => item.id !== track.id ? item : { ...item, keys: item.keys.map((entry, i) => i === index ? { ...entry, value: Number(event.target.value) } : entry) }), track.id + 'value-' + index)} />}
        <select aria-label="Интерполяция ключа" value={key.interpolation} onChange={event => changeTracks(scene.timeline.tracks.map(item => item.id !== track.id ? item : { ...item, keys: item.keys.map((entry, i) => i === index ? { ...entry, interpolation: event.target.value as typeof key.interpolation } : entry) }))}><option value="linear">L</option><option value="easeInOut">S</option><option value="step">→</option></select>
        <button aria-label="Удалить ключ" onClick={() => changeTracks(scene.timeline.tracks.map(item => item.id !== track.id ? item : { ...item, keys: item.keys.filter((_, i) => i !== index) }).filter(item => item.keys.length))}>×</button>
      </div>)}
    </div>)}
    {!scene.timeline.tracks.length && <p className="muted">Ключей пока нет. Без дорожек работают параметры сцены и процедурная анимация.</p>}
  </>;
}
