/**
 * 再生ヘッド（赤い縦線＋三角）。ドラッグでシークする。
 * リファレンスの PlayheadGeneric を移植（delta ベースのドラッグ）。
 */

import { useRef, useState } from 'react';
import { pxToTime, timeToPx, type TimeScale } from './utils';

interface PlayheadProps {
  playheadMs: number;
  durationMs: number;
  scale: TimeScale;
  onSeek: (ms: number) => void;
}

export function Playhead({ playheadMs, durationMs, scale, onSeek }: PlayheadProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startMs = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    startX.current = e.clientX;
    startMs.current = playheadMs;

    const move = (ev: MouseEvent) => {
      const deltaMs = pxToTime(ev.clientX - startX.current, scale);
      onSeek(Math.max(0, Math.min(durationMs, startMs.current + deltaMs)));
    };
    const up = () => {
      setDragging(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div
      className="pointer-events-auto absolute top-0 bottom-0 z-50 w-0.5 bg-red-600"
      style={{ left: timeToPx(playheadMs, scale), cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute top-0 -left-[5px]"
        style={{
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '10px solid #dc2626',
        }}
      />
    </div>
  );
}
