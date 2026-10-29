import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openNativeText, saveFile } from '../io/files';
import { GameCanvas, type GamePanel } from './GameCanvas';
import { GameRuntime, enemyNames } from './runtime';
import { MAX_SAVE_BYTES, SAVE_KEY, newGame, parseSave, serializeSave, type GameSave } from './state';
import { CHUNK_SIZE, START_RUIN, START_VILLAGE, nearbyLandmarks, type GameObject } from './world';
import './game.css';

function Dialog({ title, close, children }: { title: string; close?: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...box.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const current = box.current!; current.addEventListener('keydown', trap);
    return () => { current.removeEventListener('keydown', trap); (document.querySelector<HTMLElement>('[data-testid=game-viewport]') ?? previous)?.focus(); };
  }, []);
  return <div className="rpg-shade"><div ref={box} className="rpg-dialog" role="dialog" aria-modal="true" aria-labelledby="rpg-dialog-title">
    <div className="rpg-dialog-title"><h2 id="rpg-dialog-title">{title}</h2>{close && <button onClick={close} aria-label="Закрыть окно">×</button>}</div>{children}
  </div></div>;
}
const questText = {
  available: 'Поговорите со старостой Эллином у очага Тихолесья.',
  active: 'Найдите Северную реликвию в Башне Серого Стража. Победите её стражей и откройте сундук.',
  relic: 'Верните Северную реликвию старосте Эллину в Тихолесье.',
  complete: 'Реликвия возвращена. Исследуйте дальние земли, новые поселения и руины.',
};
function WorldMap({ game }: { game: GameRuntime }) {
  const points = new Map<string, ReturnType<typeof nearbyLandmarks>[number]>();
  for (const key of game.save.visited) {
    const [x, z] = key.split(':').map(Number);
    for (const point of nearbyLandmarks(game.save.seed, (x + 0.5) * CHUNK_SIZE, (z + 0.5) * CHUNK_SIZE))
      if (game.save.discovered.includes(point.id)) points.set(point.id, point);
  }
  const cells = game.save.visited.map(key => key.split(':').map(Number));
  const extent = Math.max(160, ...cells.flatMap(([x, z]) => [Math.abs(x * CHUNK_SIZE) + 60, Math.abs(z * CHUNK_SIZE) + 60]));
  return <><svg className="rpg-map" viewBox={[-extent, -extent, extent * 2, extent * 2].join(' ')} role="img" aria-label="Карта исследованных земель: север сверху">
    <rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill="#142625" />
    {cells.map(([x, z]) => <rect key={x + ':' + z} x={x * CHUNK_SIZE} y={z * CHUNK_SIZE} width={CHUNK_SIZE} height={CHUNK_SIZE} fill="#415f4b" stroke="#62806b" strokeWidth={extent / 250} />)}
    {[...points.values()].map(point => <g key={point.id}><circle cx={point.x} cy={point.z} r={extent / 40} fill={point.kind === 'village' ? '#e0c388' : '#99c3bd'} />
      <text x={point.x + extent / 30} y={point.z + extent / 60} fill="#f0e6c8" fontSize={extent / 24}>{point.name}</text></g>)}
    <path d="M0 -7 L5 6 L0 3 L-5 6 Z" fill="#fff4bf" transform={'translate(' + game.player.x + ' ' + game.player.z + ') rotate(' + -game.player.yaw * 180 / Math.PI + ') scale(' + extent / 160 + ')'} />
  </svg><p className="rpg-muted">Север ↑ · светлые области вы исследовали · поселения и памятные места появляются при открытии.</p></>;
}
export default function GameApp({ onEditor }: { onEditor: () => void }) {
  const [stored, setStored] = useState<GameSave | null>(null), [game, setGame] = useState<GameRuntime | null>(null);
  const [seed, setSeed] = useState('42017'), [pendingSeed, setPendingSeed] = useState<number | null>(null);
  const [panel, setPanel] = useState<GamePanel | null>(null), [npc, setNPC] = useState<GameObject | null>(null);
  const [ascii, setAscii] = useState(false), [fps, setFPS] = useState(0), [notice, setNotice] = useState(''), [saveLabel, setSaveLabel] = useState('');
  const [, refresh] = useState(0), file = useRef<HTMLInputElement>(null), current = useRef(game); current.current = game;
  const existingRaw = useRef<string | null>(null);
  useEffect(() => {
    try { existingRaw.current = localStorage.getItem(SAVE_KEY); if (existingRaw.current) setStored(parseSave(existingRaw.current)); }
    catch (cause) { setNotice('Не удалось прочитать автосохранение. Исходные данные оставлены на устройстве. ' + String(cause)); }
  }, []);
  const persist = useCallback(() => {
    const runtime = current.current; if (!runtime) return true;
    try {
      const text = serializeSave(runtime.save); localStorage.setItem(SAVE_KEY, text); existingRaw.current = text;
      setStored(parseSave(text)); setSaveLabel('Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })); return true;
    } catch (cause) { setNotice('Автосохранение не удалось: ' + String(cause) + '. Скачайте JSON через меню.'); return false; }
  }, []);
  useEffect(() => {
    if (!game) return;
    persist();
    const timer = setInterval(persist, 5000);
    window.addEventListener('pagehide', persist); window.addEventListener('blur', persist);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', persist); window.removeEventListener('blur', persist); };
  }, [game, persist]);
  const openPanel = useCallback((next: GamePanel) => { if ((current.current?.player.health ?? 1) <= 0) return; setPanel(next); setNPC(null); persist(); }, [persist]);
  const close = () => { setPanel(null); setNPC(null); setPendingSeed(null); };
  const paused = panel !== null || npc !== null || pendingSeed !== null || (game?.player.health ?? 1) <= 0;
  const latest = useRef({ paused, close, openPanel }); latest.current = { paused, close, openPanel };
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !current.current) return;
      event.preventDefault();
      if (latest.current.paused) latest.current.close(); else latest.current.openPanel('pause');
    };
    window.addEventListener('keydown', down); return () => window.removeEventListener('keydown', down);
  }, []);
  const start = (save: GameSave) => {
    const runtime = new GameRuntime(save); current.current = runtime; setGame(runtime);
    setPanel(null); setNPC(null); setPendingSeed(null); setNotice('');
  };
  const requestNew = () => {
    const value = Number(seed);
    if (!/^\d+$/.test(seed) || !Number.isInteger(value) || value < 0 || value > 0xffffffff) { setNotice('Seed: целое число от 0 до 4294967295.'); return; }
    if (existingRaw.current) setPendingSeed(value); else start(newGame(value));
  };
  const importText = (text: string) => {
    try { const save = parseSave(text); start(save); setNotice('Сохранение RPG загружено.'); }
    catch (cause) { setNotice(String(cause)); }
  };
  const openSave = async () => {
    if (!isTauri()) { file.current?.click(); return; }
    try { const text = await openNativeText('Сохранение Северных осколков'); if (text !== undefined) importText(text); }
    catch (cause) { setNotice(String(cause)); }
  };
  const exportSave = async (prior = false) => {
    try {
      const text = prior ? existingRaw.current : game ? serializeSave(game.save) : existingRaw.current;
      if (text && await saveFile('northern-shards.rpg.json', text)) setNotice('Сохранение RPG передано для записи в файл.');
    } catch (cause) { setNotice(String(cause)); }
  };
  const leave = (editor: boolean) => { if (persist()) { if (editor) onEditor(); else { setGame(null); current.current = null; close(); } } };
  const interact = () => {
    const target = game?.interact(); if (target) { setNPC(target); persist(); }
    refresh(value => value + 1);
  };
  const target = game?.target(), objective = game?.save.quest === 'active' ? START_RUIN : START_VILLAGE;
  const distance = game ? Math.round(Math.hypot(game.player.x - objective.x, game.player.z - objective.z)) : 0;
  const facing = game ? ((-game.player.yaw * 180 / Math.PI) % 360 + 360) % 360 : 0;
  const direction = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(facing / 45) % 8];
  const enemy = game?.aliveEnemies.filter(value => Math.hypot(value.x - game.player.x, value.z - game.player.z) < 5).sort((a, b) =>
    Math.hypot(a.x - game.player.x, a.z - game.player.z) - Math.hypot(b.x - game.player.x, b.z - game.player.z))[0];
  return <main className="rpg">
    <input ref={file} type="file" accept=".json" aria-label="Импорт сохранения RPG" hidden onChange={async event => {
      const chosen = event.target.files?.[0]; event.target.value = '';
      if (!chosen) return;
      try { if (chosen.size > MAX_SAVE_BYTES) throw new Error('Сохранение больше 2 МБ'); importText(await chosen.text()); }
      catch (cause) { setNotice(String(cause)); }
    }} />
    {!game ? <div className="rpg-menu">
      <div className="rpg-menu-art" aria-hidden="true"><div className="rpg-moon" /><div className="rpg-mountain one" /><div className="rpg-mountain two" /><div className="rpg-tower" /></div>
      <section className="rpg-menu-content"><p className="rpg-eyebrow">ASCII DEPTH ENGINE · ИГРОВОЙ ПРОТОТИП</p>
        <h1>Северные<br /><em>осколки</em></h1><p className="rpg-intro">За старым лесом стоят башни забытого королевства.<br />Их камни всё ещё помнят имена.</p>
        <div className="rpg-menu-actions">{stored && <button className="rpg-primary" onClick={() => start(stored)}>Продолжить путешествие <span>Уровень {stored.player.level} · seed {stored.seed}</span></button>}
          <label className="rpg-seed">Seed мира <input aria-label="Seed игрового мира" inputMode="numeric" value={seed} onChange={event => setSeed(event.target.value)} /></label>
          <button className={stored ? '' : 'rpg-primary'} onClick={requestNew}>Начать путешествие</button>
          <button onClick={openSave}>Загрузить сохранение RPG</button>
          <button className="rpg-link" onClick={() => leave(true)}>Редактор ASCII</button>
        </div><p className="rpg-muted">Процедурный мир · от первого лица · меч и древние реликвии</p>
      </section><p className="rpg-menu-footer">Локальная игра. Прогресс сохраняется на этом устройстве.</p>
    </div> : <>
      <GameCanvas game={game} paused={paused} ascii={ascii} onStats={setFPS} onInteract={interact} onPanel={openPanel} onError={setNotice} />
      <div className="rpg-top">
        <div className="rpg-place"><span className="rpg-eyebrow">СЕВЕРНЫЕ ОСКОЛКИ</span><strong>{game.region}</strong><small>Уровень {game.player.level} · {game.player.gold} золота</small></div>
        <div className="rpg-compass"><span>З</span><strong>{direction} <small>{Math.round(facing)}°</small></strong><span>В</span>
          {game.save.quest !== 'complete' && <small>{objective.name} · {distance} м</small>}</div>
        <button className="rpg-menu-button" onClick={() => openPanel('pause')}>Меню · Esc</button>
      </div>
      <div className="rpg-objective"><span className="rpg-eyebrow">СЕВЕРНАЯ РЕЛИКВИЯ</span><p>{questText[game.save.quest]}</p><button onClick={() => openPanel('journal')}>Журнал · J</button></div>
      {!paused && <><div className="rpg-crosshair" aria-hidden="true">+</div>
        {enemy && <div className="rpg-enemy">{enemyNames[enemy.kind]}<meter aria-label="Здоровье противника" value={game.hp(enemy)} max={enemy.hp} /></div>}
        {target && <button className="rpg-interact" onClick={interact}>E · {target.kind === 'npc' ? 'Поговорить' : target.kind === 'chest' ? 'Открыть сундук' : 'Коснуться камня'}</button>}</>}
      <div className="rpg-bottom"><div className="rpg-vitals">
        <label>Здоровье <span>{Math.ceil(game.player.health)} / {game.healthMax}</span><meter className="health" aria-label="Здоровье" value={game.player.health} max={game.healthMax} /></label>
        <label>Выносливость <span>{Math.round(game.player.stamina)}</span><meter className="stamina" aria-label="Выносливость" value={game.player.stamina} max={100} /></label>
      </div><div className="rpg-quick">
        <button disabled={paused} onClick={() => { game.attack(); refresh(value => value + 1); }}><b>Меч</b><small>ЛКМ / F · {game.damage} урона</small></button>
        <button disabled={paused || !game.player.potions} onClick={() => { game.potion(); refresh(value => value + 1); }}><b>Зелье ×{game.player.potions}</b><small>Q · +45 здоровья</small></button>
        <button onClick={() => openPanel('map')}>Карта · M</button><button onClick={() => openPanel('inventory')}>Сумка · I</button>
      </div></div>
      {!paused && game.elapsed - game.messageTime < 9 && <p className="rpg-message" role="status">{game.message}</p>}
      <span className="rpg-performance">{Math.round(fps)} FPS · {ascii ? 'ASCII' : '3D'}</span>
      {panel && <Dialog title={{ pause: 'У очага', map: 'Исследованные земли', journal: 'Журнал странника', inventory: 'Сумка' }[panel]} close={close}>
        {panel === 'pause' && <><p className="rpg-muted">{saveLabel || 'Автосохранение каждые 5 секунд.'}</p>
          <div className="rpg-actions"><button className="rpg-primary" onClick={close}>Вернуться в мир</button>
            <button onClick={() => { setAscii(value => !value); }}>Отображение: {ascii ? 'ASCII' : '3D'}</button>
            <button onClick={() => exportSave()}>Скачать сохранение RPG</button><button onClick={openSave}>Загрузить сохранение RPG</button>
            <button onClick={() => leave(false)}>Главное меню</button><button onClick={() => leave(true)}>Редактор ASCII</button></div>
          <p className="rpg-controls">WASD — идти · мышь / ПКМ / стрелки — обзор<br />Shift — бежать · Space — прыгнуть<br />ЛКМ / F — удар · E — действие · Q — зелье<br />M — карта · J — журнал · I — сумка · Esc — пауза</p></>}
        {panel === 'map' && <WorldMap game={game} />}
        {panel === 'journal' && <><p className="rpg-eyebrow">{game.save.quest === 'complete' ? 'ЗАВЕРШЕНО' : 'ЗАДАНИЕ'}</p>
          <h3>Северная реликвия</h3><p>{questText[game.save.quest]}</p><p className="rpg-muted">Эллин: «Из Серой башни снова слышен металл. Принеси реликвию к нашему очагу, пока стражи не проснулись окончательно».</p>
          <p>Открыто мест: {game.save.discovered.length} · исследовано участков: {game.save.visited.length}</p></>}
        {panel === 'inventory' && <><div className="rpg-inventory"><div><b>Железный меч</b><span>{game.damage} урона · уже в руке</span></div>
          <div><b>Зелье здоровья ×{game.player.potions}</b><span>Восстанавливает 45 здоровья</span></div>
          <div><b>Золото: {game.player.gold}</b><span>Уровень {game.player.level} · опыт {game.player.xp} / {game.player.level * 75}</span></div>
          {game.save.quest === 'relic' && <div><b>Северная реликвия</b><span>Отнести Эллину в Тихолесье</span></div>}</div>
          <button disabled={!game.player.potions || game.player.health >= game.healthMax || game.player.health <= 0} onClick={() => { game.potion(); refresh(value => value + 1); persist(); }}>Выпить зелье</button></>}
      </Dialog>}
      {npc && <Dialog title={npc.landmark?.id === START_VILLAGE.id ? 'Эллин · староста Тихолесья' : 'Хранитель очага'} close={close}>
        <p className="rpg-eyebrow">{npc.landmark?.name}</p>
        <p>{npc.landmark?.id !== START_VILLAGE.id ? 'У нашего очага страннику всегда найдётся место. Отдохни, прежде чем снова идти в туман.' :
          game.save.quest === 'available' ? 'Путник, в Серой башне на севере осталась реликвия нашего рода. Стражи уже проснулись. Верни её — и наш очаг будет твоим домом.' :
          game.save.quest === 'relic' ? 'Ты принёс её! Теперь старые камни снова будут хранить наш лес. Прими награду, странник.' :
          game.save.quest === 'complete' ? 'Тихолесье помнит твою помощь. За лесом ещё много забытых мест.' : 'Башня стоит к северу от посёлка. Победи стражей и загляни в сундук.'}</p>
        <div className="rpg-actions">
          {npc.landmark?.id === START_VILLAGE.id && game.save.quest === 'available' && <button className="rpg-primary" onClick={() => { game.acceptQuest(); persist(); close(); }}>Я найду реликвию</button>}
          {npc.landmark?.id === START_VILLAGE.id && game.save.quest === 'relic' && <button className="rpg-primary" onClick={() => { game.completeQuest(); persist(); close(); }}>Вернуть реликвию · получить награду</button>}
          <button onClick={() => { if (npc.landmark) game.rest(npc.landmark); persist(); close(); }}>Отдохнуть у очага</button>
          <button onClick={close}>До встречи</button></div>
      </Dialog>}
      {game.player.health <= 0 && <Dialog title="Ваш путь ещё не окончен">
        <p>Очаг зовёт вас обратно. Вы сохраните открытия, опыт и реликвию, но потеряете 20% золота.</p>
        <button className="rpg-primary" onClick={() => { game.respawn(); close(); refresh(value => value + 1); persist(); }}>Вернуться к очагу</button>
      </Dialog>}
    </>}
    {pendingSeed !== null && <Dialog title="Новое путешествие" close={close}><p>Новое путешествие заменит текущее автосохранение. Можно сначала сохранить его отдельным файлом.</p>
      <div className="rpg-actions"><button onClick={() => exportSave(true)}>Скачать прежнее сохранение</button>
        <button className="rpg-primary" onClick={() => start(newGame(pendingSeed))}>Создать новый мир</button><button onClick={close}>Отмена</button></div></Dialog>}
    {notice && <div className="rpg-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть сообщение">×</button></div>}
  </main>;
}
