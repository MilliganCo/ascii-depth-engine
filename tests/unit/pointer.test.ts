import { expect, it, vi } from 'vitest';
import { capturePointer, releasePointer } from '../../src/io/pointer';
it('handles rejected WebView2 pointer requests and releases only its own connected canvas', async () => {
  const failed = vi.fn(), request = vi.fn().mockRejectedValue(new Error('inactive document'));
  const exit = vi.fn().mockRejectedValue(new Error('navigation'));
  const document = { pointerLockElement: null as unknown, exitPointerLock: exit };
  const canvas = { isConnected: true, ownerDocument: document, requestPointerLock: request } as unknown as HTMLCanvasElement;
  await capturePointer(canvas, failed); expect(failed).toHaveBeenCalledOnce();
  await releasePointer(canvas, failed); expect(exit).not.toHaveBeenCalled();
  document.pointerLockElement = canvas;
  await releasePointer(canvas, failed); expect(exit).toHaveBeenCalledOnce(); expect(failed).toHaveBeenCalledTimes(2);
  Object.assign(canvas, { isConnected: false });
  await releasePointer(canvas, failed); await capturePointer(canvas, failed);
  expect(exit).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledOnce();
});
