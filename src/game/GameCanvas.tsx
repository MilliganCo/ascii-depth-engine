import { useEffect, useRef, useState } from 'react';
import { Euler } from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { clamp } from '../engine/math';
import { capturePointer, releasePointer } from '../io/pointer';
import { GameRuntime } from './runtime';
import { GameRenderer } from './renderer';

export type GamePanel = 'pause' | 'map' | 'journal' | 'inventory';
type Props = { game: GameRuntime; paused: boolean; ascii: boolean; onStats: (fps: number) => void;
  onInteract: () => void; onPanel: (panel: GamePanel) => void; onError: (message: string) => void };
export function GameCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props); latest.current = props;
  const [locked, setLocked] = useState(false), [failure, setFailure] = useState(''), [lost, setLost] = useState(false);
  useEffect(() => {
    const element = host.current!, target = canvas.current!, game = props.game;
    let renderer: GameRenderer;
    try { renderer = new GameRenderer(target); }
    catch (cause) { const message = 'Не удалось запустить 3D: ' + String(cause); setFailure(message); latest.current.onError(message); return; }
    const camera = renderer.view.camera, rotation = new Euler(0, 0, 0, 'YXZ');
    camera.rotation.set(game.player.pitch, game.player.yaw, 0, 'YXZ');
    const walk = new PointerLockControls(camera, target);
    walk.minPolarAngle = Math.PI / 2 - 1.4; walk.maxPolarAngle = Math.PI / 2 + 1.4;
    const keys = new Set<string>();
    let dragging: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let contextLost = false, raf = 0, previous = performance.now(), lastStats = previous, frames = 0;
    const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
    const active = () => !latest.current.paused && !contextLost && !document.hidden && game.player.health > 0;
    const clear = () => { keys.clear(); dragging = null; previous = performance.now(); };
    const stop = () => { clear(); void releasePointer(target, latest.current.onError); };
    const suspend = () => { stop(); if (!latest.current.paused) latest.current.onPanel('pause'); };
    const lock = () => { element.focus(); setLocked(true); };
    const unlock = () => { clear(); setLocked(false); if (!latest.current.paused) latest.current.onPanel('pause'); };
    walk.addEventListener('lock', lock); walk.addEventListener('unlock', unlock);
    const keyDown = (event: KeyboardEvent) => {
      if (!active() || event.ctrlKey || event.metaKey || event.altKey ||
        /INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement)?.tagName) ||
        (!walk.isLocked && !element.contains(document.activeElement))) return;
      const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      const actionKeys = ['Space', 'KeyF', 'KeyE', 'KeyQ', 'KeyM', 'KeyJ', 'KeyI'];
      if (!moveKeys.includes(event.code) && !actionKeys.includes(event.code)) return;
      event.preventDefault();
      if (moveKeys.includes(event.code)) keys.add(event.code);
      else if (!event.repeat) {
        if (event.code === 'Space') game.jump();
        if (event.code === 'KeyF') game.attack();
        if (event.code === 'KeyE') latest.current.onInteract();
        if (event.code === 'KeyQ') game.potion();
        if (event.code === 'KeyM') latest.current.onPanel('map');
        if (event.code === 'KeyJ') latest.current.onPanel('journal');
        if (event.code === 'KeyI') latest.current.onPanel('inventory');
      }
    };
    const keyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const mouseMove = () => {
      if (!active() || !walk.isLocked) return;
      rotation.setFromQuaternion(camera.quaternion, 'YXZ');
      game.player.yaw = angle(rotation.y); game.player.pitch = clamp(rotation.x, -1.4, 1.4);
    };
    const down = (event: PointerEvent) => {
      if (!active()) return;
      element.focus();
      if (event.button === 0) {
        if (walk.isLocked) game.attack(); else void capturePointer(target, pointerError);
      } else if (event.button === 2 && !walk.isLocked) {
        target.setPointerCapture(event.pointerId);
        dragging = { x: event.clientX, y: event.clientY, yaw: game.player.yaw, pitch: game.player.pitch };
      }
    };
    const move = (event: PointerEvent) => {
      if (!active() || !dragging) return;
      game.player.yaw = angle(dragging.yaw - (event.clientX - dragging.x) * 0.003);
      game.player.pitch = clamp(dragging.pitch - (event.clientY - dragging.y) * 0.003, -1.4, 1.4);
    };
    const up = () => { dragging = null; };
    const pointerError = () => latest.current.onError('Для обзора можно удерживать ПКМ или использовать стрелки. WASD — движение.');
    const lose = (event: Event) => { event.preventDefault(); contextLost = true; setLost(true); suspend(); };
    const restore = () => { contextLost = false; setLost(false); previous = performance.now(); };
    const resize = () => {
      const rect = element.getBoundingClientRect(); renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height), Math.min(devicePixelRatio || 1, 2));
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); element.focus();
    target.addEventListener('pointerdown', down); target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
    target.addEventListener('webglcontextlost', lose); target.addEventListener('webglcontextrestored', restore);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', suspend);
    document.addEventListener('mousemove', mouseMove); document.addEventListener('visibilitychange', suspend);
    document.addEventListener('pointerlockerror', pointerError);
    const render = (now: number) => {
      const current = latest.current, dt = Math.min((now - previous) / 1000, 0.1); previous = now;
      if (!active()) { clear(); void releasePointer(target, current.onError); }
      if (!document.hidden && !contextLost) {
        if (active()) {
          game.player.yaw = angle(game.player.yaw + (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) * dt * 1.8);
          game.player.pitch = clamp(game.player.pitch + (Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'))) * dt * 1.3, -1.4, 1.4);
          game.update(dt, { forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
            right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') });
        }
        try { renderer.render(game, current.ascii); frames++; }
        catch (cause) { const message = 'Ошибка игрового 3D: ' + String(cause); setFailure(message); current.onError(message); return; }
        if (now - lastStats >= 150) {
          element.dataset.player = JSON.stringify(game.player); element.dataset.quest = game.save.quest;
          element.dataset.chunks = JSON.stringify([...game.chunks.keys()]);
          element.dataset.enemies = JSON.stringify([...game.enemies.values()].map(enemy => ({ id: enemy.id, x: enemy.x, z: enemy.z, hp: game.hp(enemy) })));
          current.onStats(frames * 1000 / (now - lastStats)); lastStats = now; frames = 0;
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf); walk.removeEventListener('unlock', unlock); walk.removeEventListener('lock', lock);
      stop(); walk.dispose(); observer.disconnect(); renderer.dispose();
      target.removeEventListener('pointerdown', down); target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      target.removeEventListener('webglcontextlost', lose); target.removeEventListener('webglcontextrestored', restore);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', suspend);
      document.removeEventListener('mousemove', mouseMove); document.removeEventListener('visibilitychange', suspend);
      document.removeEventListener('pointerlockerror', pointerError);
    };
  }, [props.game]);
  useEffect(() => {
    if (props.paused && canvas.current) void releasePointer(canvas.current, latest.current.onError); else host.current?.focus();
  }, [props.paused]);
  return <div ref={host} className="rpg-viewport" tabIndex={0} data-testid="game-viewport" data-backend={failure ? 'error' : 'Three.js / WebGL2'}
    data-ascii={String(props.ascii)} aria-label="Мир RPG: WASD — движение, мышь или стрелки — обзор">
    <canvas ref={canvas} onContextMenu={event => event.preventDefault()} aria-label="Северные осколки: игровой мир" />
    {!locked && !props.paused && !failure && <button className="rpg-capture" onClick={() => {
      if (canvas.current) void capturePointer(canvas.current, () => latest.current.onError('Захват мыши недоступен. Используйте ПКМ или стрелки для обзора.'));
    }}>Захватить мышь · ПКМ / стрелки — обзор без захвата</button>}
    {(failure || lost) && <div className="rpg-render-error" role="alert">{failure || 'Восстанавливаем графический контекст…'}</div>}
  </div>;
}
