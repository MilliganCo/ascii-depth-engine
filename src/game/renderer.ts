import * as THREE from 'three';
import { makeDemo } from '../scenes';
import { SpatialRenderer } from '../renderers/spatial';
import { GameRuntime } from './runtime';
import { type GameChunk, type GameObject } from './world';

const colors = {
  forest: { ground: '#667549', leaf: '#3f754f', rock: '#748179' },
  heath: { ground: '#8d7753', leaf: '#a89a5d', rock: '#8f8380' },
  frost: { ground: '#c4d2d0', leaf: '#86aab1', rock: '#8598a3' },
};
type ChunkView = { group: THREE.Group; terrain: THREE.BufferGeometry; instances: THREE.InstancedMesh[] };
export class GameRenderer {
  readonly view: SpatialRenderer;
  private readonly config = makeDemo('forest').scene;
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly cone = new THREE.ConeGeometry(1, 1, 4);
  private readonly rock = new THREE.IcosahedronGeometry(1, 0);
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly chunks = new Map<string, ChunkView>();
  private readonly actors = new Map<string, THREE.Group>();
  private readonly props = new Map<string, THREE.Group>();
  private readonly dummy = new THREE.Object3D();
  private readonly sword = new THREE.Group();
  constructor(canvas: HTMLCanvasElement) {
    this.view = new SpatialRenderer(canvas);
    this.config.layers = []; this.config.lights = [];
    this.config.resolution = { width: 1920, height: 1080 }; this.config.cell = { width: 8, height: 12, glyphMode: 'structural' };
    this.config.environment = { ...this.config.environment, background: '#26373c', fogColor: '#26373c', fogDensity: 2.1, ambient: 0.8, timeOfDay: 0.55 };
    this.box(this.sword, '#c6dbdc', 0, 0.55, 0, 0.12, 1.25, 0.07);
    this.box(this.sword, '#caa25b', 0, -0.12, 0, 0.46, 0.08, 0.12);
    this.box(this.sword, '#564333', 0, -0.28, 0, 0.1, 0.3, 0.1);
    this.sword.scale.setScalar(0.68);
    this.view.camera.add(this.sword); this.view.world.add(this.view.camera);
  }
  private material(color: string) {
    let material = this.materials.get(color);
    if (!material) { material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); this.materials.set(color, material); }
    return material;
  }
  private box(group: THREE.Group, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, geometry: THREE.BufferGeometry = this.cube) {
    const mesh = new THREE.Mesh(geometry, this.material(color)); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); group.add(mesh); return mesh;
  }
  private person(color: string, guardian = false) {
    const group = new THREE.Group();
    this.box(group, color, 0, 1, 0, 0.6, 0.75, 0.3);
    this.box(group, guardian ? '#b8c5c3' : '#d2b38b', 0, 1.58, 0, 0.42, 0.42, 0.42);
    this.box(group, '#332e30', -0.16, 0.33, 0, 0.22, 0.65, 0.25);
    this.box(group, '#332e30', 0.16, 0.33, 0, 0.22, 0.65, 0.25);
    this.box(group, color, -0.4, 1, 0, 0.18, 0.6, 0.22);
    this.box(group, color, 0.4, 1, 0, 0.18, 0.6, 0.22);
    this.box(group, '#273436', 0, 1.57, 0.22, 0.27, 0.06, 0.03);
    if (guardian) this.box(group, '#c7d4d5', 0.46, 0.65, 0.1, 0.09, 0.9, 0.09);
    return group;
  }
  private prop(object: GameObject) {
    const group = object.kind === 'npc' ? this.person('#bba878') : new THREE.Group();
    if (object.kind === 'house') {
      this.box(group, '#a48661', 0, 2.1, 0, object.rx * 2, 4.2, object.rz * 2);
      this.box(group, '#78474b', 0, 4.9, 0, object.rx * 1.7, 2.2, object.rz * 1.7, this.cone).rotation.y = Math.PI / 4;
      this.box(group, '#302e29', 0, 1.25, object.rz + 0.01, 1.3, 2.5, 0.05);
      for (const x of [-2, 2]) this.box(group, '#d9c881', x, 2.4, object.rz + 0.02, 0.8, 0.8, 0.07);
    } else if (object.kind === 'wall' || object.kind === 'tower') {
      this.box(group, '#838884', 0, object.height / 2, 0, object.rx * 2, object.height, object.rz * 2);
      for (const x of [-1, 1]) this.box(group, '#a5aaa2', x * object.rx * 0.6, object.height + 0.35, 0, 0.7, 0.7, object.rz * 2);
    } else if (object.kind === 'chest') {
      this.box(group, '#795433', 0, 0.4, 0, 1.4, 0.8, 1);
      this.box(group, '#deb768', 0, 0.48, 0.51, 0.22, 0.2, 0.06);
    } else if (object.kind === 'shrine') {
      this.box(group, '#989f8e', 0, 1.5, 0, 1, 3, 0.8);
      this.box(group, '#94d7d0', 0, 3.25, 0, 0.55, 0.8, 0.55, this.rock);
    } else if (object.kind === 'fire') {
      this.box(group, '#554737', 0, 0.1, 0, 1.3, 0.2, 1.3);
      this.box(group, '#ecb15d', 0, 0.6, 0, 0.8, 1.1, 0.8, this.cone);
    }
    group.position.set(object.x, object.y, object.z); this.view.world.add(group); return group;
  }
  private buildChunk(chunk: GameChunk) {
    const group = new THREE.Group(), palette = colors[chunk.biome], indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    // Explicit face normals keep faceted lighting without screen-space derivatives.
    const geometry = indexed.toNonIndexed(); indexed.dispose(); geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, this.material(palette.ground)));
    const instances: THREE.InstancedMesh[] = [];
    const objects = chunk.objects.filter(object => object.kind === 'tree' || object.kind === 'rock');
    const addInstances = (selected: GameObject[], shape: THREE.BufferGeometry, color: string, placement: (object: GameObject) => void) => {
      if (!selected.length) return;
      const mesh = new THREE.InstancedMesh(shape, this.material(color), selected.length);
      selected.forEach((object, i) => { this.dummy.rotation.set(0, 0, 0); placement(object); this.dummy.updateMatrix(); mesh.setMatrixAt(i, this.dummy.matrix); });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh); instances.push(mesh);
    };
    const trees = objects.filter(object => object.kind === 'tree');
    addInstances(trees, this.cube, '#655142', object => { this.dummy.position.set(object.x, object.y + object.height * 0.35, object.z); this.dummy.scale.set(0.42, object.height * 0.7, 0.42); });
    addInstances(trees, chunk.biome === 'frost' ? this.cone : this.cube, palette.leaf, object => {
      this.dummy.position.set(object.x, object.y + object.height * 0.7, object.z); this.dummy.scale.set(2.6, object.height * 0.55, 2.6);
    });
    addInstances(objects.filter(object => object.kind === 'rock'), this.rock, palette.rock, object => {
      this.dummy.position.set(object.x, object.y + 0.5, object.z); this.dummy.scale.set(1.2, 1.3, 1.1);
    });
    this.view.world.add(group); return { group, terrain: geometry, instances };
  }
  render(game: GameRuntime, ascii: boolean) {
    for (const [key, chunk] of game.chunks) if (!this.chunks.has(key)) this.chunks.set(key, this.buildChunk(chunk));
    for (const [key, chunk] of this.chunks) if (!game.chunks.has(key)) { chunk.terrain.dispose(); chunk.instances.forEach(mesh => mesh.dispose()); chunk.group.removeFromParent(); this.chunks.delete(key); }
    const propIDs = new Set<string>();
    for (const object of game.objects) {
      if (object.kind === 'tree' || object.kind === 'rock') continue;
      propIDs.add(object.id); let group = this.props.get(object.id);
      if (!group) { group = this.prop(object); this.props.set(object.id, group); }
      if (object.kind === 'chest') group.rotation.x = game.save.opened.includes(object.id) ? -0.12 : 0;
      if (object.kind === 'npc') group.rotation.y = Math.atan2(game.player.x - object.x, game.player.z - object.z);
    }
    for (const [id, group] of this.props) if (!propIDs.has(id)) { group.removeFromParent(); this.props.delete(id); }
    const enemyIDs = new Set<string>();
    for (const enemy of game.aliveEnemies) {
      enemyIDs.add(enemy.id); let group = this.actors.get(enemy.id);
      if (!group) {
        if (enemy.kind === 'wolf') {
          group = new THREE.Group();
          this.box(group, '#a8afb0', 0, 0.65, 0, 0.5, 0.55, 1.15);
          this.box(group, '#c3c9c6', 0, 0.9, 0.65, 0.45, 0.4, 0.5);
          for (const x of [-0.18, 0.18]) for (const z of [-0.35, 0.35]) this.box(group, '#7c8587', x, 0.3, z, 0.13, 0.6, 0.14);
        } else group = this.person(enemy.kind === 'guardian' ? '#739398' : '#925754', enemy.kind === 'guardian');
        this.actors.set(enemy.id, group); this.view.world.add(group);
      }
      group.position.set(enemy.x, enemy.y + Math.sin(game.elapsed * 6) * 0.025, enemy.z);
      group.rotation.y = Math.atan2(game.player.x - enemy.x, game.player.z - enemy.z);
    }
    for (const [id, group] of this.actors) if (!enemyIDs.has(id)) { group.removeFromParent(); this.actors.delete(id); }
    this.view.camera.position.set(game.player.x, game.player.y + 1.65, game.player.z);
    this.view.camera.rotation.set(game.player.pitch, game.player.yaw, 0, 'YXZ');
    this.sword.position.set(0.5, -0.6 - Math.sin(game.elapsed * 3) * 0.01, -0.8);
    this.sword.rotation.set(0.1, -0.1, -0.5 + Math.sin(game.swing / 0.28 * Math.PI) * 1.7);
    return this.view.drawWorld(this.config, game.elapsed, ascii);
  }
  resize(width: number, height: number, dpr = 1) { this.view.resize(width, height, dpr); }
  dispose() {
    for (const chunk of this.chunks.values()) { chunk.terrain.dispose(); chunk.instances.forEach(mesh => mesh.dispose()); chunk.group.removeFromParent(); }
    this.actors.forEach(group => group.removeFromParent()); this.props.forEach(group => group.removeFromParent()); this.sword.removeFromParent();
    this.cube.dispose(); this.cone.dispose(); this.rock.dispose(); this.materials.forEach(material => material.dispose()); this.view.dispose();
  }
}
