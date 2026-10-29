import { isTauri } from '@tauri-apps/api/core';
import { MAX_PROJECT_BYTES, parseProject, type Project } from '../model';

export async function saveFile(name: string, contents: Blob | string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const extension = name.split('.').pop()!;
    const path = await save({ defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!path) return false;
    const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : new Uint8Array(await contents.arrayBuffer());
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(typeof contents === 'string' ? new Blob([contents], { type: 'text/plain;charset=utf-8' }) : contents);
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function openNativeText(title = 'ASCII Depth Engine'): Promise<string | undefined> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile, stat } = await import('@tauri-apps/plugin-fs');
  const path = await open({ title, multiple: false, filters: [{ name: title, extensions: ['json'] }] });
  if (!path) return undefined;
  if ((await stat(path)).size > MAX_PROJECT_BYTES) throw new Error('Файл больше 2 МБ');
  return readTextFile(path);
}
export async function openNativeProject(): Promise<Project | undefined> {
  const text = await openNativeText();
  return text === undefined ? undefined : parseProject(text);
}
export async function readProjectFile(file: File): Promise<Project> {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('Проект больше 2 МБ');
  return parseProject(await file.text());
}
export const safeFilename = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'scene';
