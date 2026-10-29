import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { capturePointer, releasePointer } from '../io/pointer';
import { Euler, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { defaultSpatial, type Project, type Spatial } from '../model';
import { advanceTime, clamp } from '../engine/math';
import { movementVector } from '../engine/world';
import { SpatialRenderer } from '../renderers/spatial';
import type { Metrics, Transport } from './Viewport';

type Props = {
  project: Project; transport: MutableRefObject<Transport>; grid: boolean; suspended: boolean;
  quality: 'low' | 'medium' | 'high';
  onCamera: (pose: Spatial['camera'], group: string) => void;
  onMetrics: (metrics: Metrics) => void; onError: (message: string) => void;
};
export function SpatialViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props); latest.current = props;
  const [locked, setLocked] = useState(false), [failure, setFailure] = useState(''), [retry, setRetry] = useState(0), [lost, setLost] = useState(false);
  useEffect(() => {
    const element = host.current!, target = canvas.current!;
    let view: SpatialRenderer;
    try { view = new SpatialRenderer(target); setFailure(''); }
    catch (cause) { const message = '3D требует WebGL2: ' + String(cause); setFailure(message); latest.current.onError(message); return; }
    const orbit = new OrbitControls(view.camera, target), walk = new PointerLockControls(view.camera, target);
    orbit.minDistance = 2; orbit.maxDistance = 140; orbit.maxTargetRadius = 3800;
    orbit.minPolarAngle = 0.05; orbit.maxPolarAngle = Math.PI / 2 - 0.05;
    const direction = new Vector3(), rotation = new Euler(0, 0, 0, 'YXZ'), keys = new Set<string>();
    let lastPose = '', dirty = false, contextLost = false, dragging: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let previous = performance.now(), lastStats = previous, lastCommit = previous, frames = 0, elapsed = 0, raf = 0, width = 1, height = 1;
    const pose = (): Spatial['camera'] => {
      view.camera.position.clampScalar(-4000, 4000);
      if (latest.current.project.scene.spatial?.navigation === 'walk') {
        view.camera.getWorldDirection(direction);
        orbit.target.copy(view.camera.position).addScaledVector(direction, 20);
      }
      return { position: { x: view.camera.position.x, y: view.camera.position.y, z: view.camera.position.z },
        target: { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z } };
    };
    const commit = () => {
      if (!dirty) return;
      const next = pose(); lastPose = JSON.stringify(next); dirty = false; lastCommit = performance.now();
      latest.current.onCamera(next, 'spatial-camera');
    };
    const change = () => { dirty = true; };
    orbit.addEventListener('change', change); orbit.addEventListener('end', commit);
    const unlock = () => { keys.clear(); dragging = null; commit(); setLocked(false); };
    const lock = () => { element.focus(); setLocked(true); };
    walk.addEventListener('unlock', unlock); walk.addEventListener('lock', lock);
    const stop = () => { keys.clear(); dragging = null; commit(); void releasePointer(target, latest.current.onError); previous = performance.now(); };
    const pointerError = () => latest.current.onError('Захват мыши недоступен. В режиме перемещения удерживайте ЛКМ для обзора; WASD работают при фокусе на сцене.');
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && walk.isLocked) { void releasePointer(target, latest.current.onError); return; }
      if (latest.current.suspended || latest.current.project.scene.spatial?.navigation !== 'walk' || contextLost ||
        event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement)?.tagName)) return;
      if (!walk.isLocked && !element.contains(document.activeElement)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) { event.preventDefault(); keys.add(event.code); }
    };
    const keyUp = (event: KeyboardEvent) => { if (keys.delete(event.code)) commit(); };
    const mouseMove = () => { if (walk.isLocked) dirty = true; };
    const down = (event: PointerEvent) => {
      element.focus();
      if (latest.current.suspended || latest.current.project.scene.spatial?.navigation !== 'walk' || walk.isLocked || event.button !== 0) return;
      event.preventDefault(); target.setPointerCapture(event.pointerId); rotation.setFromQuaternion(view.camera.quaternion);
      dragging = { x: event.clientX, y: event.clientY, yaw: rotation.y, pitch: rotation.x };
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      rotation.set(clamp(dragging.pitch - (event.clientY - dragging.y) * 0.003, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01),
        dragging.yaw - (event.clientX - dragging.x) * 0.003, 0, 'YXZ');
      view.camera.quaternion.setFromEuler(rotation); dirty = true;
    };
    const up = () => { dragging = null; commit(); };
    const lose = (event: Event) => { event.preventDefault(); contextLost = true; setLost(true); stop(); latest.current.onError('Контекст 3D потерян. Ожидается восстановление WebGL2.'); };
    const restore = () => { contextLost = false; previous = performance.now(); setLost(false); latest.current.onError('Контекст 3D восстановлен.'); };
    const resize = () => { const rect = element.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height); view.resize(width, height, Math.min(devicePixelRatio || 1, 2)); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    target.addEventListener('pointerdown', down); target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
    target.addEventListener('webglcontextlost', lose); target.addEventListener('webglcontextrestored', restore);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', stop);
    document.addEventListener('mousemove', mouseMove); document.addEventListener('visibilitychange', stop); document.addEventListener('pointerlockerror', pointerError);
    const render = (now: number) => {
      const current = latest.current, spatial = current.project.scene.spatial ?? defaultSpatial();
      const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
      const incoming = JSON.stringify(spatial.camera);
      if (incoming !== lastPose) {
        lastPose = incoming; view.setCamera(spatial.camera); orbit.target.set(spatial.camera.target.x, spatial.camera.target.y, spatial.camera.target.z);
        if (spatial.navigation === 'orbit') orbit.update();
        dirty = false;
      }
      orbit.enabled = spatial.navigation === 'orbit' && !current.suspended && !contextLost;
      if (current.suspended || spatial.navigation !== 'walk') { keys.clear(); dragging = null; void releasePointer(target, current.onError); }
      if (!document.hidden && !contextLost && width > 1 && height > 1) {
        if (spatial.navigation === 'walk' && keys.size) {
          rotation.setFromQuaternion(view.camera.quaternion);
          const motion = movementVector(rotation.y, Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
            Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyE')) - Number(keys.has('KeyQ')),
            spatial.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1), delta);
          view.camera.position.add(new Vector3(motion.x, motion.y, motion.z)).clampScalar(-4000, 4000); dirty = true;
        }
        if (dirty && now - lastCommit >= 120) commit();
        const transport = current.transport.current;
        if (transport.playing) transport.time = advanceTime(transport.time, delta * transport.speed, current.project.scene.timeline.duration, current.project.scene.timeline.loop);
        const started = performance.now();
        try {
          const calls = view.render(current.project.scene, transport.time, current.quality);
          elapsed += performance.now() - started; frames++;
          if (now - lastStats >= 250) {
            const camera = pose();
            element.dataset.camera = JSON.stringify(camera); element.dataset.objects = String(view.objects);
            element.dataset.chunks = JSON.stringify(view.chunkKeys);
            current.onMetrics({ fps: frames * 1000 / (now - lastStats), ms: elapsed / Math.max(1, frames),
              glyphs: view.columns * view.rows, generated: view.objects, draws: calls, backend: view.backend,
              width: Math.round(width), height: Math.round(height), time: transport.time, clipped: false });
            lastStats = now; frames = 0; elapsed = 0;
          }
        } catch (cause) { const message = 'Ошибка 3D: ' + String(cause); setFailure(message); current.onError(message); return; }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf); keys.clear(); dirty = false; void releasePointer(target, latest.current.onError);
      orbit.dispose(); walk.dispose(); observer.disconnect(); view.dispose();
      target.removeEventListener('pointerdown', down); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      target.removeEventListener('webglcontextlost', lose); target.removeEventListener('webglcontextrestored', restore);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', stop);
      document.removeEventListener('mousemove', mouseMove); document.removeEventListener('visibilitychange', stop); document.removeEventListener('pointerlockerror', pointerError);
    };
  }, [props.project.id, retry]);
  return <div ref={host} className="viewport spatial-viewport" tabIndex={0} data-testid="viewport"
    data-backend={failure ? '3D недоступно' : lost ? '3D: контекст потерян' : 'Three.js / WebGL2'}
    aria-label="3D-мир: вращение мышью; режим перемещения — WASD, Q/E, Shift">
    <canvas ref={canvas} aria-label="Процедурный 3D-мир в ASCII" onContextMenu={event => event.preventDefault()} />
    {props.grid && <div className="glyph-grid" style={{ backgroundSize: 100 / Math.floor(props.project.scene.resolution.width / props.project.scene.cell.width) + '% ' + 100 / Math.floor(props.project.scene.resolution.height / props.project.scene.cell.height) + '%' }} />}
    {props.project.scene.spatial?.navigation === 'walk' && !failure && <div className="walk-controls">
      <button onClick={() => { if (locked) { if (canvas.current) void releasePointer(canvas.current, latest.current.onError); }
        else { host.current?.focus(); if (canvas.current) void capturePointer(canvas.current, () => latest.current.onError('Захват мыши недоступен. Для обзора удерживайте ЛКМ.')); }
      }}>{locked ? 'Освободить мышь · Esc' : 'Захватить мышь'}</button>
      <span>WASD · Q/E — высота · Shift — быстрее · ЛКМ — обзор</span>
    </div>}
    {locked && <div className="crosshair" aria-hidden="true">+</div>}
    {(failure || lost) && <div className="spatial-error" role="alert">{failure || 'Восстанавливаем WebGL2…'}{failure && <button onClick={() => setRetry(value => value + 1)}>Повторить запуск 3D</button>}</div>}
  </div>;
}
