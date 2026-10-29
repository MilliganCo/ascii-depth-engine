export async function capturePointer(canvas: HTMLCanvasElement, failed: () => void) {
  if (!canvas.isConnected) return;
  try { await canvas.requestPointerLock(); } catch { failed(); }
}
export async function releasePointer(canvas: HTMLCanvasElement, failed: (message: string) => void) {
  const document = canvas.ownerDocument;
  if (!canvas.isConnected || document.pointerLockElement !== canvas) return;
  try { await document.exitPointerLock(); }
  catch {
    // WebView2 may deactivate the document while navigation is releasing the lock.
    if (canvas.isConnected && document.pointerLockElement === canvas) failed('Не удалось освободить мышь. Нажмите Esc.');
  }
}
