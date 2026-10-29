import type { Project } from '../model';

export class History {
  past: Project[] = [];
  future: Project[] = [];
  private lastGroup = '';
  private lastEdit = 0;
  constructor(public document: Project) {}
  edit(next: Project, group = '', now = Date.now()) {
    if (JSON.stringify(next) === JSON.stringify(this.document)) return;
    if (!group || group !== this.lastGroup || now - this.lastEdit > 750) this.past.push(this.document);
    this.document = next; this.future = []; this.lastGroup = group; this.lastEdit = now;
    while (this.past.length > 50 || this.past.length > 1 && this.past.reduce((bytes, doc) => bytes + JSON.stringify(doc).length * 2, 0) > 24 * 1024 * 1024) this.past.shift();
  }
  undo() {
    const previous = this.past.pop();
    if (previous) { this.future.push(this.document); this.document = previous; }
    this.lastGroup = '';
  }
  redo() {
    const next = this.future.pop();
    if (next) { this.past.push(this.document); this.document = next; }
    this.lastGroup = '';
  }
}
export function removeLayer(project: Project, id: string): Project {
  return { ...project, scene: { ...project.scene, layers: project.scene.layers.filter(layer => layer.id !== id),
    timeline: { ...project.scene.timeline, tracks: project.scene.timeline.tracks.filter(track => !(track.target === 'layer' && track.targetId === id)) } } };
}
export function duplicateLayer(project: Project, id: string, newId: string): Project {
  const index = project.scene.layers.findIndex(layer => layer.id === id);
  if (index < 0 || project.scene.layers.length >= 64) return project;
  const layers = [...project.scene.layers];
  layers.splice(index + 1, 0, { ...structuredClone(layers[index]), id: newId, name: layers[index].name + ' · копия', locked: false });
  return { ...project, scene: { ...project.scene, layers } };
}
export function reorderLayer(project: Project, id: string, direction: -1 | 1): Project {
  const layers = [...project.scene.layers].sort((a, b) => a.depth - b.depth);
  const index = layers.findIndex(layer => layer.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= layers.length || layers[index].locked || layers[target].locked) return project;
  // Depth controls occlusion; moving a layer exchanges depths, with array order breaking ties.
  const current = layers[index], neighbor = layers[target];
  layers[index] = { ...neighbor, depth: current.depth }; layers[target] = { ...current, depth: neighbor.depth };
  return { ...project, scene: { ...project.scene, layers } };
}
