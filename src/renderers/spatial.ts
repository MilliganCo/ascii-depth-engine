import * as THREE from 'three';
import type { Layer, Scene, Spatial } from '../model';
import { defaultSpatial } from '../model';
import { evaluateScene, modulo, toSrgb } from '../engine/math';
import { CHUNK_SIZE, generateChunk, neighboringChunks, spatialGlyph, spatialRamp, type WorldEntity } from '../engine/world';
import { ATLAS_COLS, atlasCodes, atlasIndex, createAtlas } from './atlas';

type ChunkView = { group: THREE.Group; entities: WorldEntity[]; meshes: { mesh: THREE.InstancedMesh; offset: THREE.Vector3; scale: THREE.Vector3 }[] };
function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => {
    if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
    material.dispose();
  });
  group.removeFromParent();
}
function shape(kind: string): { geometry: THREE.BufferGeometry; offset: THREE.Vector3; scale: THREE.Vector3 }[] {
  const part = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) =>
    ({ geometry, offset: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(sx, sy, sz) });
  if (kind === 'trees') return [
    part(new THREE.CylinderGeometry(0.25, 0.5, 7, 6), 0, 3.5, 0),
    part(new THREE.ConeGeometry(3, 10, 7), 0, 9, 0),
  ];
  if (kind === 'kelp') return [
    part(new THREE.CylinderGeometry(0.14, 0.25, 8, 5), 0, 4, 0),
    part(new THREE.SphereGeometry(1, 6, 4), 0.4, 5, 0, 0.8, 3, 0.2),
  ];
  if (kind === 'city') return [
    part(new THREE.BoxGeometry(1, 1, 1), 0, 4, 0, 4, 8, 4),
    part(new THREE.BoxGeometry(1, 1, 1), 0, 9, 0, 1.5, 2, 1.5),
  ];
  if (kind === 'crane') return [
    part(new THREE.BoxGeometry(1, 1, 1), 0, 7, 0, 0.7, 14, 0.7),
    part(new THREE.BoxGeometry(1, 1, 1), 4, 13, 0, 11, 0.6, 0.6),
  ];
  if (kind === 'fish' || kind === 'boats') return [
    part(new THREE.SphereGeometry(1, 8, 5), 0, 0, 0, kind === 'fish' ? 1.5 : 3, 0.5, 0.6),
    part(new THREE.ConeGeometry(0.7, 1.3, 3).rotateZ(Math.PI / 2), -1.9, 0, 0, 1, 1, 0.4),
  ];
  if (kind === 'water') return [part(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 4, 4).rotateX(-Math.PI / 2), 0, 0, 0)];
  if (kind === 'rays') return [part(new THREE.CylinderGeometry(0.15, 1.5, 22, 5), 0, 4, 0)];
  return [part(new THREE.IcosahedronGeometry(1, 0), 0, 0, 0)];
}

export class SpatialRenderer {
  readonly backend = 'Three.js / WebGL2';
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 250);
  readonly world = new THREE.Scene();
  private readonly ambient = new THREE.HemisphereLight('#b4e5f4', '#243d38', 2);
  private readonly sun = new THREE.DirectionalLight('#ffe2ac', 3);
  private readonly target = new THREE.WebGLRenderTarget(128, 48, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private readonly atlas = new THREE.CanvasTexture(createAtlas());
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.Camera();
  private readonly post: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly chunks = new Map<string, ChunkView>();
  private readonly lamps: THREE.PointLight[] = [];
  private readonly dummy = new THREE.Object3D();
  private source?: Scene;
  private sourceKey = '';
  private sceneData?: Scene;
  private ramp: number[] = [];
  private background = new THREE.Color();
  columns = 128;
  rows = 48;
  objects = 0;
  get chunkKeys() { return [...this.chunks.keys()]; }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    this.atlas.minFilter = THREE.LinearFilter; this.atlas.magFilter = THREE.LinearFilter; this.atlas.generateMipmaps = false;
    this.sun.position.set(-20, 40, 15);
    this.world.add(this.ambient, this.sun);
    for (let i = 0; i < 4; i++) { const light = new THREE.PointLight(); this.lamps.push(light); this.world.add(light); }
    this.post = new THREE.ShaderMaterial({
      uniforms: { picture: { value: this.target.texture }, atlas: { value: this.atlas }, grid: { value: new THREE.Vector2(128, 48) },
        background: { value: this.background }, ramp: { value: new Array(16).fill(1) }, rampLength: { value: 10 }, atlasRows: { value: Math.ceil(atlasCodes.length / ATLAS_COLS) } },
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: [
        'uniform sampler2D picture, atlas; uniform vec2 grid; uniform vec3 background;',
        'uniform float ramp[16], rampLength, atlasRows; varying vec2 vUv;',
        'void main(){ vec2 cell=floor(vUv*grid); vec3 color=texture2D(picture,(cell+0.5)/grid).rgb;',
        'float brightness=clamp(max(color.r,max(color.g,color.b))*2.5,0.0,1.0);',
        'int level=int(floor(brightness*(rampLength-1.0)+0.5));',
        'if(length(color-background)<0.012) level=0;',
        'float glyph=ramp[level]; vec2 local=fract(vUv*grid);',
        'vec2 uv=vec2((mod(glyph,16.0)+local.x)/16.0,1.0-(floor(glyph/16.0)+1.0-local.y)/atlasRows);',
        'float mask=texture2D(atlas,uv).a; gl_FragColor=vec4(mix(background,color*1.8,mask),1.0);',
        '#include <tonemapping_fragment>',
        '#include <colorspace_fragment>',
        '}',
      ].join('\n'),
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    this.postScene.add(this.quad);
    this.setCamera(defaultSpatial().camera);
  }
  setCamera(pose: Spatial['camera']) {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  }
  resize(width: number, height: number, dpr = 1) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  private buildChunk(scene: Scene, layer: Layer, x: number, z: number): ChunkView {
    const chunk = generateChunk(scene.seed, layer, x, z), group = new THREE.Group();
    const kind = layer.type === 'procedural' ? layer.generator.name : layer.type === 'particles' ? layer.system.name : 'text';
    const material = new THREE.MeshStandardMaterial({ color: layer.tint, roughness: 0.85, flatShading: true,
      transparent: layer.opacity < 1, opacity: layer.opacity, side: THREE.DoubleSide,
      emissive: ['stars', 'fireflies', 'rays'].includes(kind) ? layer.tint : '#000000',
      emissiveIntensity: 0.5, fog: layer.fogInfluence > 0,
      blending: layer.blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending });
    const meshes: ChunkView['meshes'] = [];
    if (chunk.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1)); geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry, material));
    } else if (layer.type === 'textGrid') {
      material.dispose();
      const canvas = document.createElement('canvas'), lines = layer.text.split('\n');
      canvas.width = Math.max(32, Math.max(...lines.map(line => line.length)) * 24); canvas.height = Math.max(32, lines.length * 36);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff'; context.font = '30px Consolas, monospace'; context.textBaseline = 'top';
      lines.forEach((line, i) => context.fillText(line, 0, i * 36));
      group.add(new THREE.Mesh(new THREE.PlaneGeometry(canvas.width / 40, canvas.height / 40),
        new THREE.MeshBasicMaterial({ color: layer.tint, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: layer.opacity, side: THREE.DoubleSide })));
      group.children[0].position.set(0, 6, -12);
    } else {
      for (const part of shape(kind)) {
        const mesh = new THREE.InstancedMesh(part.geometry, material, chunk.entities.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Moving fish/plants may leave their initial bounding sphere.
        mesh.frustumCulled = false;
        meshes.push({ mesh, offset: part.offset, scale: part.scale }); group.add(mesh);
      }
      if (!meshes.length) material.dispose();
    }
    this.world.add(group);
    return { group, entities: chunk.entities, meshes };
  }
  render(scene: Scene, time: number, quality: 'low' | 'medium' | 'high' = 'high') {
    this.sceneData = scene;
    if (scene !== this.source) {
      const key = JSON.stringify([scene.seed, scene.layers]);
      if (key !== this.sourceKey) { this.chunks.forEach(chunk => disposeGroup(chunk.group)); this.chunks.clear(); this.sourceKey = key; }
      this.source = scene;
    }
    const evaluated = evaluateScene(scene, time), environment = evaluated.environment;
    const needed = new Set<string>(); this.objects = 0;
    for (const layer of evaluated.layers) {
      if (!layer.visible || layer.opacity === 0 || layer.type === 'procedural' && layer.generator.name === 'haze') continue;
      const gx = layer.position.x / 20, gy = -layer.position.y / 20, gz = -(1 - layer.depth) * 12;
      const coordinates = layer.type === 'textGrid' ? [[0, 0]] : neighboringChunks((this.camera.position.x - gx) / layer.scale, (this.camera.position.z - gz) / layer.scale);
      for (const [x, z] of coordinates) {
        const key = layer.id + ':' + x + ':' + z; needed.add(key);
        let chunk = this.chunks.get(key);
        if (!chunk) { chunk = this.buildChunk(scene, layer, x, z); this.chunks.set(key, chunk); }
        chunk.group.position.set(gx, gy, gz); chunk.group.scale.setScalar(layer.scale);
        chunk.group.traverse(object => {
          if (object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => { material.opacity = layer.opacity; material.transparent = layer.opacity < 1 || layer.type === 'textGrid'; });
          }
        });
        const kind = layer.type === 'procedural' ? layer.generator.name : layer.type === 'particles' ? layer.system.name : '';
        const speed = layer.type === 'procedural' ? layer.generator.speed : layer.type === 'particles' ? layer.system.speed : 0;
        const count = layer.type === 'particles' ? Math.floor(chunk.entities.length * (quality === 'low' ? 0.3 : quality === 'medium' ? 0.6 : 1)) : chunk.entities.length;
        for (const part of chunk.meshes) {
          part.mesh.count = count;
          for (let i = 0; i < count; i++) {
            const entity = chunk.entities[i], swim = kind === 'fish' || kind === 'boats';
            const px = swim ? x * CHUNK_SIZE + modulo(entity.x - x * CHUNK_SIZE + time * speed * 2, CHUNK_SIZE) : entity.x;
            const py = layer.type === 'particles' ? -2 + modulo(entity.y + 2 + time * speed * (kind === 'rain' ? -9 : 1.5), 20) : entity.y;
            this.dummy.position.set(px, kind === 'water' ? -1 : py, entity.z);
            this.dummy.rotation.set(0, swim ? 0 : entity.angle, ['kelp', 'trees'].includes(kind) ? Math.sin(time * speed + entity.phase) * environment.wind * 0.06 : 0);
            const size = layer.type === 'particles' ? layer.system.size * 0.18 : kind === 'stars' ? 0.15 : kind === 'rays' ? 0.4 : kind === 'water' ? 1 : entity.scale;
            this.dummy.scale.copy(part.scale).multiplyScalar(size);
            this.dummy.position.addScaledVector(part.offset, size);
            if (layer.type === 'procedural' && ['trees', 'kelp', 'city', 'crane'].includes(kind)) {
              const height = 0.25 + layer.generator.amplitude;
              this.dummy.scale.y *= height;
              this.dummy.position.y = py + part.offset.y * size * height;
            }
            this.dummy.updateMatrix(); part.mesh.setMatrixAt(i, this.dummy.matrix);
          }
          part.mesh.instanceMatrix.needsUpdate = true;
        }
        this.objects += chunk.entities.length || (layer.type === 'textGrid' ? 1 : chunk.group.children.length);
      }
    }
    for (const [key, chunk] of this.chunks) if (!needed.has(key)) { disposeGroup(chunk.group); this.chunks.delete(key); }
    return this.drawWorld(evaluated, time);
  }
  drawWorld(scene: Scene, time: number, ascii = true) {
    this.sceneData = scene;
    const environment = scene.environment;
    this.background.set(environment.background); this.world.background = this.background;
    this.world.fog = new THREE.FogExp2(environment.fogColor, environment.fogDensity * 0.015);
    this.ambient.intensity = environment.ambient * 2.5;
    this.sun.intensity = 1.2 + environment.timeOfDay * 3;
    this.lamps.forEach((lamp, i) => {
      const light = scene.lights[i]; lamp.visible = Boolean(light);
      if (light) { lamp.color.set(light.color); lamp.intensity = light.intensity * 160;
        lamp.distance = light.radius / 10; lamp.position.set(light.x / 20 + Math.sin(time * 0.3) * light.motion * 5, 8 - light.y / 20, 0); }
    });
    this.columns = Math.floor(scene.resolution.width / scene.cell.width);
    this.rows = Math.floor(scene.resolution.height / scene.cell.height);
    if (this.target.width !== this.columns || this.target.height !== this.rows) this.target.setSize(this.columns, this.rows);
    this.post.uniforms.grid.value.set(this.columns, this.rows);
    this.ramp = spatialRamp(scene.cell.glyphMode);
    this.post.uniforms.rampLength.value = this.ramp.length;
    this.post.uniforms.ramp.value = Array.from({ length: 16 }, (_, i) => atlasIndex.get(this.ramp[Math.min(i, this.ramp.length - 1)])!);
    this.renderer.info.reset();
    if (ascii) {
      this.renderer.setRenderTarget(this.target); this.renderer.render(this.world, this.camera);
      this.renderer.setRenderTarget(null); this.renderer.render(this.postScene, this.postCamera);
    } else { this.renderer.setRenderTarget(null); this.renderer.render(this.world, this.camera); }
    return this.renderer.info.render.calls;
  }
  async text(ansi: boolean) {
    if (!this.sceneData) throw new Error('3D-кадр ещё не отрисован');
    const pixels = new Uint8Array(this.columns * this.rows * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, this.columns, this.rows, pixels);
    const lines: string[] = [], bg = this.background.toArray();
    for (let y = this.rows - 1; y >= 0; y--) {
      let line = '', previous = '';
      for (let x = 0; x < this.columns; x++) {
        const p = (y * this.columns + x) * 4, color = [pixels[p] / 255, pixels[p + 1] / 255, pixels[p + 2] / 255];
        const code = spatialGlyph(color, bg, this.ramp);
        if (ansi && code !== 32) {
          const value = color.map(c => Math.round(Math.min(1, toSrgb(c * 1.8)) * 255)).join(';');
          if (previous !== value) { line += '\x1b[38;2;' + value + 'm'; previous = value; }
        }
        line += String.fromCodePoint(code);
      }
      lines.push(line + (ansi ? '\x1b[0m' : ''));
    }
    return lines.join('\n') + (ansi ? '\x1b[0m' : '');
  }
  dispose() {
    this.chunks.forEach(chunk => disposeGroup(chunk.group)); this.chunks.clear();
    this.target.dispose(); this.atlas.dispose(); this.quad.geometry.dispose(); this.post.dispose(); this.renderer.dispose();
  }
}
