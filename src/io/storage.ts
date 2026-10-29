import { parseProject, serializeProject, type Project } from '../model';

type Draft = { id: string; name: string; updated: number; json: string };
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('ascii-depth-engine', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Автосохранение недоступно: ' + request.error?.message)); };
  });
}
export async function saveDraft(project: Project): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put({ id: project.id, name: project.name, updated: Date.now(), json: serializeProject(project) } satisfies Draft);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error('Не удалось сохранить черновик: ' + transaction.error?.message));
  });
}
export async function listDrafts(): Promise<Draft[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts').objectStore('drafts').getAll();
    request.onsuccess = () => resolve((request.result as Draft[]).sort((a, b) => b.updated - a.updated));
    request.onerror = () => reject(new Error('Не удалось прочитать черновики'));
  });
}
export async function latestDraft(): Promise<Project | undefined> {
  const latest = (await listDrafts())[0];
  return latest ? parseProject(latest.json) : undefined;
}
