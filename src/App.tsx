import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { createLayer, defaultSpatial, parseProject, projectSchema, serializeProject, type Layer, type Project } from './model';
import { demoNames, makeDemo } from './scenes';
import { History, duplicateLayer, removeLayer, reorderLayer } from './editor/history';
import { Inspector, NumberField } from './editor/Inspector';
import { Viewport, type Metrics, type Transport } from './editor/Viewport';
import { SpatialViewport } from './editor/SpatialViewport';
import { clamp, sortLayers } from './engine/math';
import { exportPNG, exportSpatialText, exportText } from './io/export';
import { openNativeProject, readProjectFile, safeFilename, saveFile } from './io/files';
import { latestDraft, listDrafts, saveDraft } from './io/storage';

const newDemo = (key: keyof typeof demoNames): Project => ({ ...makeDemo(key), id: crypto.randomUUID() });
const initialMetrics: Metrics = { fps: 0, ms: 0, glyphs: 0, generated: 0, draws: 0, backend: 'WebGL2', width: 0, height: 0, time: 0, clipped: false };
const glyphLabels = { basic: 'ASCII Basic', structural: 'ASCII Structural', block: 'Unicode Block', braille: 'Braille · 2×4 точки' };

export default function App({ onPlay }: { onPlay: () => void }) {
  const history = useRef<History | null>(null);
  if (!history.current) history.current = new History(newDemo('abyss'));
  const [, refresh] = useState(0);
  const project = history.current.document;
  const [selected, setSelected] = useState(() => project.scene.layers[7]?.id ?? project.scene.layers[0]?.id ?? '');
  const [saved, setSaved] = useState(JSON.stringify(project));
  const dirty = saved !== JSON.stringify(project);
  const [message, setMessage] = useState('Локальная студия. Проекты и экспорт остаются на вашем устройстве.');
  const [booted, setBooted] = useState(false);
  const [metrics, setMetrics] = useState(initialMetrics);
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const transport = useRef<Transport>({ time: 0, playing: !reduced.current, speed: 1 });
  const [playing, setPlaying] = useState(!reduced.current), [speed, setSpeed] = useState(1);
  const [grid, setGrid] = useState(false), [hud, setHud] = useState(false), [presentation, setPresentation] = useState(false);
  const [preference, setPreference] = useState<'auto' | 'canvas'>('auto'), [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [addType, setAddType] = useState<Layer['type']>('textGrid');
  const [modal, setModal] = useState<'export' | 'drafts' | 'help' | null>(null);
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof listDrafts>>>([]);
  const [pending, setPending] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportSize, setExportSize] = useState('1920x1080'), [exportWidth, setExportWidth] = useState(1920), [exportHeight, setExportHeight] = useState(1080);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = useRef(project); current.current = project;
  const error = useCallback((value: string) => setMessage(value), []);
  const update = useCallback((next: Project, group = '') => {
    const validated = projectSchema.safeParse(next);
    if (!validated.success) { setMessage(validated.error.issues[0].message); return; }
    history.current!.edit(validated.data, group); refresh(value => value + 1);
  }, []);
  const togglePlay = useCallback(() => { transport.current.playing = !transport.current.playing; setPlaying(transport.current.playing); }, []);
  const seek = (time: number) => {
    transport.current.time = clamp(time, 0, project.scene.timeline.duration);
    transport.current.playing = false; setPlaying(false); setMetrics(previous => ({ ...previous, time: transport.current.time }));
  };
  const replace = useCallback((next: Project) => {
    if (reduced.current) next = { ...next, scene: { ...next.scene, camera: { ...next.scene.camera, cinematic: false } } };
    history.current = new History(next); setSaved(JSON.stringify(next));
    setSelected(next.scene.layers[next.scene.layers.length - 1]?.id ?? '');
    transport.current.time = 0; setMetrics(initialMetrics); refresh(value => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    latestDraft().then(draft => { if (active && draft) { replace(draft); setSaved(''); setMessage('Восстановлен последний черновик. Сохраните JSON, чтобы получить отдельный файл.'); } })
      .catch(cause => active && setMessage(String(cause))).finally(() => active && setBooted(true));
    return () => { active = false; };
  }, [replace]);
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(() => { saveDraft(project).catch(cause => setMessage(String(cause))); }, 300);
    return () => clearTimeout(timer);
  }, [project, booted]);
  useEffect(() => {
    if (!project.scene.layers.some(layer => layer.id === selected)) setSelected(project.scene.layers[project.scene.layers.length - 1]?.id ?? '');
  }, [project, selected]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const leave = () => { if (booted) void saveDraft(current.current); };
    window.addEventListener('beforeunload', unload); window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('pagehide', leave); };
  }, [dirty, booted]);
  const save = async () => {
    try {
      const doc = current.current;
      if (await saveFile(safeFilename(doc.name) + '.ade.json', serializeProject(doc))) {
        setSaved(JSON.stringify(doc)); setMessage(isTauri() ? 'Проект сохранён в выбранный файл.' : 'JSON передан браузеру для сохранения. Проверьте папку загрузок.');
        return true;
      }
    } catch (cause) { setMessage(String(cause)); }
    return false;
  };
  const requestProject = async (next: Project) => {
    if (dirty) { setPending(next); return; }
    try { await saveDraft(current.current); replace(next); setMessage('Проект открыт.'); }
    catch (cause) { setMessage(String(cause)); }
  };
  const open = async () => {
    if (!isTauri()) { fileInput.current?.click(); return; }
    try { const doc = await openNativeProject(); if (doc) await requestProject(doc); } catch (cause) { setMessage(String(cause)); }
  };
  const undo = () => { history.current!.undo(); refresh(value => value + 1); };
  const redo = () => { history.current!.redo(); refresh(value => value + 1); };
  const remove = () => { const layer = current.current.scene.layers.find(item => item.id === selected); if (layer && !layer.locked) update(removeLayer(current.current, selected)); };
  const resetCamera = () => {
    const doc = current.current;
    update({ ...doc, scene: { ...doc.scene, ...(doc.scene.spatial?.enabled ?
      { spatial: { ...doc.scene.spatial, camera: defaultSpatial().camera } } :
      { camera: { x: 0, y: 0, zoom: 1, cinematic: false } }) } });
  };
  const keyboard = useRef({ save, open, undo, redo, remove, resetCamera, togglePlay }); keyboard.current = { save, open, undo, redo, remove, resetCamera, togglePlay };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = /INPUT|TEXTAREA|SELECT/.test(target?.tagName) || target?.isContentEditable;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (editing && !['s', 'o'].includes(key)) return;
        if (['s', 'o', 'z', 'y'].includes(key)) {
          event.preventDefault();
          if (key === 's') void keyboard.current.save();
          if (key === 'o') void keyboard.current.open();
          if (key === 'z') event.shiftKey ? keyboard.current.redo() : keyboard.current.undo();
          if (key === 'y') keyboard.current.redo();
        }
      } else {
        if (editing) return;
        if (event.code === 'Space' && target.tagName !== 'BUTTON') event.preventDefault();
        if (event.key === 'Delete') keyboard.current.remove();
        if (event.key.toLowerCase() === 'r' || event.key.toLowerCase() === 'f') keyboard.current.resetCamera();
        if (event.key.toLowerCase() === 'g') setGrid(value => !value);
        if (event.key.toLowerCase() === 'h') setPresentation(value => !value);
        if (event.key === 'Escape') { setPresentation(false); setModal(null); setPending(null); }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement)?.tagName)) keyboard.current.togglePlay();
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  useEffect(() => {
    if (!modal && !pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = focusable(), first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('keydown', trap); previous?.focus(); };
  }, [modal, pending]);
  const exportFile = async (kind: 'png' | 'txt' | 'ansi') => {
    setBusy(true);
    try {
      const scene = current.current.scene, time = transport.current.time;
      let width = exportWidth, height = exportHeight;
      if (exportSize === 'viewport') { width = Math.max(320, metrics.width); height = Math.max(240, metrics.height); }
      else if (exportSize !== 'custom') [width, height] = exportSize.split('x').map(Number);
      const content = kind === 'png' ? await exportPNG(scene, time, width, height, metrics.backend) :
        scene.spatial?.enabled ? await exportSpatialText(scene, time, kind === 'ansi') : exportText(scene, time, kind === 'ansi');
      if (await saveFile(safeFilename(current.current.name) + '-' + time.toFixed(2) + '.' + kind, content)) setMessage('Экспорт ' + kind.toUpperCase() + ' сохранён, время ' + time.toFixed(2) + ' с.');
    } catch (cause) { setMessage(String(cause)); }
    finally { setBusy(false); }
  };
  const selectedLayer = project.scene.layers.find(item => item.id === selected);
  const changedLayer = (layer: Layer, patch: Partial<Layer>) => update({ ...project, scene: { ...project.scene, layers: project.scene.layers.map(item => item.id === layer.id ? { ...item, ...patch } as Layer : item) } });
  return <main className={'studio ' + (presentation ? 'presentation' : '')}
    onDragOver={event => event.preventDefault()} onDrop={async event => {
      event.preventDefault(); const file = event.dataTransfer.files[0];
      if (file) try { await requestProject(await readProjectFile(file)); } catch (cause) { setMessage(String(cause)); }
    }}>
    <header className="titlebar"><div className="brand"><span className="brand-mark">a<span>:</span></span><div>ASCII Depth Engine<small>Студия символьных миров</small></div></div>
      <div className="project-title">{project.name}<span className={dirty ? 'dirty' : 'muted'}>{dirty ? '● Есть изменения' : 'Сохранён'}</span></div>
      <button className="help-button" onClick={() => setModal('help')}>Управление</button>
      <button onClick={async () => { try { await saveDraft(current.current); onPlay(); } catch (cause) { setMessage(String(cause)); } }}>Играть · RPG</button>
    </header>
    <nav className="toolbar" aria-label="Основные инструменты">
      <select aria-label="Открыть демо" value="" onChange={event => { if (event.target.value) void requestProject(newDemo(event.target.value as keyof typeof demoNames)); }}>
        <option value="" disabled>Открыть демо</option>{Object.entries(demoNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
      <button onClick={() => { const doc = newDemo('abyss'); doc.name = 'Новая сцена'; doc.scene.layers = []; doc.scene.lights = []; void requestProject(doc); }}>Новый</button>
      <button onClick={() => void open()}>Открыть</button><button className="primary" onClick={() => void save()}>Сохранить JSON</button>
      <button onClick={async () => { try { setDrafts(await listDrafts()); setModal('drafts'); } catch (cause) { setMessage(String(cause)); } }}>Черновики</button>
      <span className="separator" /><button aria-label="Отменить" disabled={!history.current.past.length} onClick={undo}>↶</button><button aria-label="Повторить" disabled={!history.current.future.length} onClick={redo}>↷</button>
      <span className="toolbar-spacer" /><button onClick={() => setModal('export')}>Экспорт</button><button onClick={() => setPresentation(true)}>Просмотр</button>
    </nav>
    <aside className="layers panel">
      <div className="panel-heading"><h2>Слои</h2><span>{project.scene.layers.length} / 64</span></div>
      <div className="add-layer"><select aria-label="Тип нового слоя" value={addType} onChange={event => setAddType(event.target.value as Layer['type'])}><option value="textGrid">Текст</option><option value="procedural">Генератор</option><option value="particles">Частицы</option></select>
        <button disabled={project.scene.layers.length >= 64} onClick={() => { const layer = createLayer(addType, crypto.randomUUID()); update({ ...project, scene: { ...project.scene, layers: [...project.scene.layers, layer] } }); setSelected(layer.id); }}>+ Добавить</button></div>
      <p className="layer-order">Ближние сверху · глубина 0 → 1</p>
      <div className="layer-list">{sortLayers(project.scene.layers).reverse().map(layer => <div key={layer.id} className={'layer-row ' + (selected === layer.id ? 'selected ' : '') + (!layer.visible ? 'hidden-layer' : '')}>
        <button className="visibility" aria-label={(layer.visible ? 'Скрыть ' : 'Показать ') + layer.name} aria-pressed={layer.visible} disabled={layer.locked} onClick={() => changedLayer(layer, { visible: !layer.visible })}>{layer.visible ? '●' : '○'}</button>
        <button className="layer-select" onClick={() => setSelected(layer.id)} onDoubleClick={() => { const input = document.querySelector<HTMLInputElement>('[aria-label="Название слоя"]'); input?.focus(); input?.select(); }}>
          <span><span className="color-dot" style={{ background: layer.tint }} />{layer.name}</span><small>{layer.type === 'textGrid' ? 'Текст' : layer.type === 'particles' ? 'Частицы' : 'Генератор'}<code>z {layer.depth.toFixed(2)}</code></small>
        </button>
        <button className="lock" aria-label={(layer.locked ? 'Разблокировать ' : 'Заблокировать ') + layer.name} aria-pressed={layer.locked} onClick={() => changedLayer(layer, { locked: !layer.locked })}>{layer.locked ? 'L' : '·'}</button>
      </div>)}</div>
      <div className="layer-actions"><button aria-label="Слой ближе" disabled={!selectedLayer || selectedLayer.locked} onClick={() => update(reorderLayer(project, selected, 1))}>↑</button><button aria-label="Слой дальше" disabled={!selectedLayer || selectedLayer.locked} onClick={() => update(reorderLayer(project, selected, -1))}>↓</button>
        <button disabled={!selectedLayer || project.scene.layers.length >= 64} onClick={() => { const id = crypto.randomUUID(); update(duplicateLayer(project, selected, id)); setSelected(id); }}>Копия</button><button disabled={!selectedLayer || selectedLayer.locked} onClick={remove}>Удалить</button></div>
      <p className="layer-order">При перестановке меняется глубина. При равной глубине — порядок списка.</p>
    </aside>
    <section className="stage">
      <div className="stage-toolbar"><select aria-label="Пространство" value={project.scene.spatial?.enabled ? '3d' : '2d'} onChange={event => update({ ...project, scene: { ...project.scene, spatial: { ...(project.scene.spatial ?? defaultSpatial()), enabled: event.target.value === '3d' } } })}><option value="2d">2.5D</option><option value="3d">3D · Three.js</option></select>
        {project.scene.spatial?.enabled && <select aria-label="Управление камерой" value={project.scene.spatial.navigation} onChange={event => update({ ...project, scene: { ...project.scene, spatial: { ...project.scene.spatial!, navigation: event.target.value as 'orbit' | 'walk' } } })}><option value="orbit">Вращение</option><option value="walk">Перемещение · WASD</option></select>}
        <label><span>Символы</span><select aria-label="Режим символов" value={project.scene.cell.glyphMode} onChange={event => update({ ...project, scene: { ...project.scene, cell: { ...project.scene.cell, glyphMode: event.target.value as typeof project.scene.cell.glyphMode } } })}>{Object.entries(glyphLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button className={grid ? 'active' : ''} onClick={() => setGrid(value => !value)}>Сетка</button><button className={hud ? 'active' : ''} onClick={() => setHud(value => !value)}>Диагностика</button><span className="toolbar-spacer" /><button onClick={resetCamera}>Вписать</button></div>
      <div className="canvas-wrap">{project.scene.spatial?.enabled ? <SpatialViewport project={project} transport={transport} grid={grid} suspended={Boolean(modal || pending)} quality={quality}
        onCamera={(camera, group) => update({ ...current.current, scene: { ...current.current.scene, spatial: { ...current.current.scene.spatial!, camera } } }, group)}
        onMetrics={setMetrics} onError={error} /> : <Viewport project={project} transport={transport} grid={grid} hud={hud} preference={preference} quality={quality}
        onCamera={(camera, group) => update({ ...current.current, scene: { ...current.current.scene, camera } }, group)}
        onMetrics={setMetrics} onError={error} />}
        <div className="scene-caption"><span>{project.name}</span><small>{playing ? 'Живой мир' : 'Время остановлено'}</small></div>
        {hud && <div className="hud" data-testid="diagnostics">{metrics.backend}<br />{metrics.fps.toFixed(1)} FPS · {metrics.ms.toFixed(1)} мс<br />{metrics.glyphs.toLocaleString('ru')} глифов<br />{metrics.generated.toLocaleString('ru')} в геометрии · {metrics.draws} вызовов<br />{metrics.width} × {metrics.height}{metrics.clipped && <><br />Достигнут лимит глифов</>}</div>}
      </div>
      <div className="stage-bottom"><span>{project.scene.spatial?.enabled ? 'ЛКМ — вращение · ПКМ — сдвиг · WASD в режиме перемещения' : 'Перетаскивание — камера · колесо — масштаб · H — просмотр'}</span><label>Качество<select aria-label="Качество" value={quality} onChange={event => setQuality(event.target.value as typeof quality)}><option value="high">Высокое</option><option value="medium">Среднее</option><option value="low">Низкое</option></select></label>
        <select aria-label="Рендерер" disabled={project.scene.spatial?.enabled} value={preference} onChange={event => setPreference(event.target.value as typeof preference)}><option value="auto">WebGL2 / авто</option><option value="canvas">Canvas2D</option></select>
      </div>
    </section>
    <Inspector project={project} selected={selected} update={update} time={metrics.time} onError={error} />
    <footer className="timeline"><button className="play" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button><button aria-label="В начало" onClick={() => seek(0)}>↤</button>
      <output className="timecode">{metrics.time.toFixed(2)}<span> / {project.scene.timeline.duration} с</span></output>
      <div className="time-track"><input aria-label="Время сцены" type="range" min={0} max={project.scene.timeline.duration} step={0.01} value={Math.min(metrics.time, project.scene.timeline.duration)} onChange={event => seek(Number(event.target.value))} /><div className="ticks"><span>0</span><span>{project.scene.timeline.duration / 4}</span><span>{project.scene.timeline.duration / 2}</span><span>{project.scene.timeline.duration * 3 / 4}</span><span>{project.scene.timeline.duration} с</span></div></div>
      <label className="check"><input type="checkbox" checked={project.scene.timeline.loop} onChange={event => update({ ...project, scene: { ...project.scene, timeline: { ...project.scene.timeline, loop: event.target.checked } } })} />Цикл</label>
      <label>Длина<input aria-label="Длительность" className="duration" type="number" min={1} max={600} value={project.scene.timeline.duration} onChange={event => { const value = Number(event.target.value); update({ ...project, scene: { ...project.scene, timeline: { ...project.scene.timeline, duration: value } } }, 'duration'); if (value >= 1) transport.current.time = Math.min(transport.current.time, value); }} /></label>
      <select aria-label="Скорость времени" value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); transport.current.speed = value; }}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
      <span className="zoom-readout">{Math.round(project.scene.camera.zoom * 100)}%</span>
    </footer>
    <div className="statusbar"><span role="status" aria-label="Состояние проекта">{message}</span><span>{metrics.backend} · {metrics.fps.toFixed(0)} FPS</span></div>
    {presentation && <div className="presentation-tools"><button onClick={togglePlay}>{playing ? 'Пауза' : 'Играть'}</button><button onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(cause => setMessage(String(cause))); }}>Полный экран</button><button onClick={() => setPresentation(false)}>Вернуться в редактор · H</button></div>}
    <input ref={fileInput} className="file-input" type="file" accept=".json,application/json" aria-label="Открыть файл проекта" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) try { await requestProject(await readProjectFile(file)); } catch (cause) { setMessage(String(cause)); } }} />
    {!booted && <div className="boot">Открываем локальную студию…</div>}
    {(modal || pending) && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) { setModal(null); setPending(null); } }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={pending ? 'Несохранённые изменения' : modal === 'export' ? 'Экспорт сцены' : modal === 'drafts' ? 'Черновики' : 'Управление'}>
        <button className="modal-close" aria-label="Закрыть" disabled={busy} onClick={() => { setModal(null); setPending(null); }}>×</button>
        {pending ? <><h2>Сохранить изменения?</h2><p>Проект «{project.name}» изменён. Можно сохранить файл или отложить текущую версию в локальные черновики.</p>
          <button onClick={async () => { if (await save()) { await saveDraft(current.current).catch(cause => setMessage(String(cause))); replace(pending); setPending(null); } }}>Сохранить файл и открыть</button>
          <button onClick={async () => { try { await saveDraft(current.current); replace(pending); setPending(null); setMessage('Предыдущий проект доступен в «Черновиках».'); } catch (cause) { setMessage(String(cause)); } }}>Отложить в черновики</button><button onClick={() => setPending(null)}>Отмена</button></> :
          modal === 'export' ? <><h2>Экспорт сцены</h2><p>Кадр в момент {transport.current.time.toFixed(2)} с. Фон непрозрачный; интерфейс в файл не попадает.</p>
            <label className="stack">Размер PNG<select aria-label="Размер PNG" value={exportSize} onChange={event => setExportSize(event.target.value)}><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="viewport">Текущий вид</option><option value="custom">Свой размер</option></select></label>
            {exportSize === 'custom' && <><NumberField label="Ширина PNG" value={exportWidth} min={320} max={4096} step={1} onChange={setExportWidth} /><NumberField label="Высота PNG" value={exportHeight} min={240} max={4096} step={1} onChange={setExportHeight} /></>}
            <div className="export-buttons"><button className="primary" disabled={busy} onClick={() => void exportFile('png')}>{busy ? 'Экспорт…' : 'Сохранить PNG'}</button><button disabled={busy} onClick={() => void exportFile('txt')}>Сохранить TXT</button><button disabled={busy} onClick={() => void exportFile('ansi')}>Сохранить ANSI</button></div>
            <p className="muted">TXT/ANSI — {Math.floor(project.scene.resolution.width / project.scene.cell.width)} × {Math.floor(project.scene.resolution.height / project.scene.cell.height)} ячеек. Unicode-режимы содержат символы вне ASCII.</p></> :
          modal === 'drafts' ? <><h2>Локальные черновики</h2><p>Восстановление и переключение сцен не перезаписывают ваши JSON-файлы.</p>{drafts.map(draft => <button className="draft" key={draft.id} onClick={() => { try { const doc = parseProject(draft.json); setModal(null); void requestProject(doc); } catch (cause) { setMessage(String(cause)); } }}><strong>{draft.name}</strong><span>{new Date(draft.updated).toLocaleString('ru-RU')}</span></button>)}{!drafts.length && <p>Черновиков пока нет.</p>}</> :
          <><h2>Управление студией</h2><p>Выберите «3D · Three.js» над сценой. ЛКМ — вращать камеру, ПКМ — сдвигать, колесо — приближать. В режиме «Перемещение» нажмите на сцену: WASD — двигаться, Q/E — высота, Shift — быстрее; удерживайте ЛКМ для обзора или нажмите «Захватить мышь». Esc освобождает мышь. Перемещение свободное, без коллизий.</p><p>Слева выберите слой, справа меняйте его параметры. Глубина 0 — дальний план, 1 — ближний. Замок защищает слой от изменений.</p><p>В 2.5D перетаскивание — камера, колесо — масштаб вокруг курсора. Space — пауза. F / R — сброс камеры. G — сетка. H — просмотр.</p><p>Ctrl+S — JSON; Ctrl+O — открыть; Ctrl+Z / Ctrl+Shift+Z — история. Delete удаляет выбранный незаблокированный слой; отмена восстанавливает его.</p><p>Ключи камеры X/Y/zoom и медленный дрейф относятся к 2.5D. 3D-положение и направление камеры сохраняются в JSON. Ключи слоёв и интенсивности света действуют в обоих режимах.</p></>}
      </section>
    </div>}
  </main>;
}
