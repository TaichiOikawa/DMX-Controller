import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { VisualizerFixture } from '../../../shared/types';
import { fixturesInRectangle } from './multiSelection';

export function BoxSelection({ fixtures, onSelect, onActive }: {
  fixtures: readonly VisualizerFixture[];
  onSelect(ids: string[]): void; onActive(active: boolean): void;
}) {
  const { camera, gl, events } = useThree();
  useEffect(() => {
    const element = events.connected instanceof HTMLElement ? events.connected : gl.domElement;
    let drag: { x: number; y: number; pointerId: number } | null = null;
    let suppressClick = false;
    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', border: '1px solid #38bdf8', background: '#38bdf822', zIndex: '1000', display: 'none' });
    document.body.appendChild(overlay);
    const stop = () => {
      const pointerId = drag?.pointerId;
      drag = null;
      overlay.style.display = 'none';
      if (pointerId !== undefined && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      onActive(false);
    };
    const down = (event: PointerEvent) => {
      suppressClick = false;
      if (event.button !== 0 || !event.shiftKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      onActive(true);
      element.setPointerCapture(event.pointerId);
    };
    const rectangle = (event: PointerEvent) => ({ left: Math.min(drag!.x, event.clientX), top: Math.min(drag!.y, event.clientY), right: Math.max(drag!.x, event.clientX), bottom: Math.max(drag!.y, event.clientY) });
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const box = rectangle(event);
      Object.assign(overlay.style, { display: 'block', left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const box = rectangle(event);
      const viewport = element.getBoundingClientRect();
      const ids = fixturesInRectangle(fixtures, camera, { left: box.left - viewport.left, right: box.right - viewport.left, top: box.top - viewport.top, bottom: box.bottom - viewport.top }, viewport.width, viewport.height);
      suppressClick = true;
      stop();
      onSelect(ids);
    };
    const click = (event: MouseEvent) => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; } };
    const cancel = () => { if (drag) { suppressClick = true; stop(); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    element.addEventListener('pointerdown', down, true);
    element.addEventListener('pointermove', move, true);
    element.addEventListener('pointerup', up, true);
    element.addEventListener('click', click, true);
    element.addEventListener('pointercancel', cancel, true);
    element.addEventListener('lostpointercapture', cancel, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      element.removeEventListener('pointerdown', down, true);
      element.removeEventListener('pointermove', move, true);
      element.removeEventListener('pointerup', up, true);
      element.removeEventListener('click', click, true);
      element.removeEventListener('pointercancel', cancel, true);
      element.removeEventListener('lostpointercapture', cancel, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      stop(); overlay.remove();
    };
  }, [camera, events.connected, fixtures, gl, onActive, onSelect]);
  return null;
}
