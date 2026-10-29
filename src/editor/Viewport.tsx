import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Project, Scene } from '../model';
import { Compositor } from '../engine/compositor';
import { advanceTime, clamp } from '../engine/math';
import { CanvasRenderer } from '../renderers/canvas';
import { WebGLRenderer } from '../renderers/webgl';

export type Transport = { time: number; playing: boolean; speed: number };
export type Metrics = { fps: number; ms: number; glyphs: number; generated: number; draws: number; backend: string; width: number; height: number; time: number; clipped: boolean };
type Props = {
  project: Project; transport: MutableRefObject<Transport>; grid: boolean; hud: boolean;
  quality: 'low' | 'medium' | 'high'; preference: 'auto' | 'canvas';
  onCamera: (camera: Scene['camera'], group: string) => void;
  onMetrics: (metrics: Metrics) => void; onError: (message: string) => void;
};
export function Viewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), gpu = useRef<HTMLCanvasElement>(null), fallback = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props); latest.current = props;
  const [backend, setBackend] = useState('WebGL2');
  const space = useRef(false), dragged = useRef(false);
  useEffect(() => {
    const glCanvas = gpu.current!, canvas = fallback.current!, container = host.current!;
    const compositor = new Compositor();
    let renderer: CanvasRenderer | WebGLRenderer;
    let gpuRenderer: WebGLRenderer | undefined, canvasRenderer: CanvasRenderer | undefined;
    let width = 1, height = 1, raf = 0, previous = performance.now(), lastStats = previous, frames = 0, elapsed = 0, drawCalls = 0;
    const useCanvas = () => {
      canvasRenderer ??= new CanvasRenderer(canvas);
      renderer = canvasRenderer; setBackend(renderer.backend);
    };
    try {
      if (props.preference === 'canvas') useCanvas();
      else { gpuRenderer = new WebGLRenderer(glCanvas); renderer = gpuRenderer; setBackend(renderer.backend); }
    } catch (error) { useCanvas(); latest.current.onError(String(error) + '. Включён резервный Canvas2D; частицы ограничены.'); }
    const lost = (event: Event) => {
      event.preventDefault(); useCanvas();
      latest.current.onError('Контекст WebGL потерян. Просмотр продолжен через Canvas2D.');
    };
    const restored = () => {
      try {
        gpuRenderer?.dispose(); gpuRenderer = new WebGLRenderer(glCanvas);
        renderer = gpuRenderer; setBackend(renderer.backend); latest.current.onError('WebGL восстановлен.');
      } catch (error) { useCanvas(); latest.current.onError(String(error)); }
    };
    glCanvas.addEventListener('webglcontextlost', lost); glCanvas.addEventListener('webglcontextrestored', restored);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const target of [glCanvas, canvas]) { target.width = Math.round(width * dpr); target.height = Math.round(height * dpr); }
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const visibility = () => { previous = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    const render = (now: number) => {
      const current = latest.current, transport = current.transport.current;
      const delta = Math.min(0.1, (now - previous) / 1000); previous = now;
      if (!document.hidden && width > 1 && height > 1) {
        if (transport.playing) transport.time = advanceTime(transport.time, delta * transport.speed, current.project.scene.timeline.duration, current.project.scene.timeline.loop);
        const started = performance.now();
        const quality = renderer.backend === 'Canvas2D' ? 'low' : current.quality;
        const frame = compositor.compose(current.project.scene, transport.time, width, height, quality);
        drawCalls = renderer.render(frame);
        elapsed += performance.now() - started; frames++;
        if (now - lastStats >= 250) {
          current.onMetrics({ fps: frames * 1000 / (now - lastStats), ms: elapsed / Math.max(1, frames), glyphs: frame.count,
            generated: frame.generated, draws: drawCalls, backend: renderer.backend, width: Math.round(width), height: Math.round(height), time: transport.time, clipped: frame.clipped });
          lastStats = now; frames = 0; elapsed = 0;
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); gpuRenderer?.dispose(); canvasRenderer?.dispose();
      glCanvas.removeEventListener('webglcontextlost', lost); glCanvas.removeEventListener('webglcontextrestored', restored); document.removeEventListener('visibilitychange', visibility);
    };
  }, [props.preference]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement)?.tagName)) { space.current = true; dragged.current = false; }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        if (dragged.current) event.preventDefault();
        space.current = false;
      }
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  const drag = useRef<{ x: number; y: number; camera: Scene['camera'] } | null>(null);
  useEffect(() => {
    const element = host.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const { project, onCamera } = latest.current, camera = project.scene.camera;
      const rect = element.getBoundingClientRect();
      const fit = Math.min(rect.width / project.scene.resolution.width, rect.height / project.scene.resolution.height);
      const zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.001), 0.3, 4);
      // Cursor anchoring uses the reference plane (parallax = 1); other depths shift naturally.
      const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
      onCamera({ ...camera, cinematic: false, zoom, x: clamp(camera.x + dx / fit * (1 / camera.zoom - 1 / zoom), -8000, 8000), y: clamp(camera.y + dy / fit * (1 / camera.zoom - 1 / zoom), -8000, 8000) }, 'camera-wheel');
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return <div ref={host} className={'viewport ' + (props.grid ? 'show-grid' : '')}
    onPointerDown={event => {
      if (event.button !== 1 && !(event.button === 0 && space.current) && event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, camera: { ...props.project.scene.camera } };
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) < 2) return;
      dragged.current = true;
      const fit = Math.min(event.currentTarget.clientWidth / props.project.scene.resolution.width, event.currentTarget.clientHeight / props.project.scene.resolution.height);
      const camera = drag.current.camera;
      props.onCamera({ ...camera, cinematic: false, x: clamp(camera.x - (event.clientX - drag.current.x) / (fit * camera.zoom), -8000, 8000), y: clamp(camera.y - (event.clientY - drag.current.y) / (fit * camera.zoom), -8000, 8000) }, 'camera-drag');
    }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} tabIndex={0} aria-label="Сцена: перетаскивайте для движения камеры, колесо для масштаба"
    data-backend={backend} data-testid="viewport">
    <canvas ref={gpu} aria-label="ASCII-сцена WebGL2" style={{ visibility: backend === 'WebGL2' ? 'visible' : 'hidden' }} />
    <canvas ref={fallback} aria-label="ASCII-сцена Canvas2D" style={{ visibility: backend === 'Canvas2D' ? 'visible' : 'hidden' }} />
    {props.grid && <div className="glyph-grid" style={{ backgroundSize: Math.min(host.current?.clientWidth ?? 800, (host.current?.clientHeight ?? 450) * 16 / 9) / props.project.scene.resolution.width * props.project.scene.cell.width * props.project.scene.camera.zoom + 'px ' + Math.min(host.current?.clientHeight ?? 450, (host.current?.clientWidth ?? 800) * 9 / 16) / props.project.scene.resolution.height * props.project.scene.cell.height * props.project.scene.camera.zoom + 'px' }} />}
  </div>;
}
