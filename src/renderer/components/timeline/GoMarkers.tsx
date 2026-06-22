/**
 * GO ポイントをルーラー上のマーカー（▼）で表示する。
 * クリック=シーク、編集モードでドラッグ=移動（mouseup で確定）、✕=削除。
 * エンジン側 add/delete/update が真実で、変更は onProject 経由で戻る。
 */

import { useRef, useState } from 'react';
import type { TimelinePoint } from '../../../shared/types';
import { formatTimecode, pxToTime, timeToPx, type TimeScale } from './utils';

interface GoMarkersProps {
  showId: string;
  points: readonly TimelinePoint[];
  durationMs: number;
  scale: TimeScale;
  editable: boolean;
  onSeek: (ms: number) => void;
}

export function GoMarkers({ showId, points, durationMs, scale, editable, onSeek }: GoMarkersProps) {
  return (
    <>
      {points.map((p, i) => (
        <GoMarker
          key={i}
          showId={showId}
          index={i}
          point={p}
          durationMs={durationMs}
          scale={scale}
          editable={editable}
          onSeek={onSeek}
        />
      ))}
    </>
  );
}

interface GoMarkerProps {
  showId: string;
  index: number;
  point: TimelinePoint;
  durationMs: number;
  scale: TimeScale;
  editable: boolean;
  onSeek: (ms: number) => void;
}

function GoMarker({ showId, index, point, durationMs, scale, editable, onSeek }: GoMarkerProps) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const moved = useRef(false);
  const ms = dragMs ?? point.timecodeMs;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) {
      onSeek(point.timecodeMs);
      return;
    }
    e.preventDefault();
    moved.current = false;
    const startX = e.clientX;
    const startMs = point.timecodeMs;

    const move = (ev: MouseEvent) => {
      const delta = pxToTime(ev.clientX - startX, scale);
      if (Math.abs(ev.clientX - startX) > 2) moved.current = true;
      setDragMs(Math.max(0, Math.min(durationMs, startMs + delta)));
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved.current) {
        const delta = pxToTime(ev.clientX - startX, scale);
        const newMs = Math.max(0, Math.min(durationMs, startMs + delta));
        window.dmx.updateTimelinePoint(showId, index, newMs);
      } else {
        onSeek(point.timecodeMs);
      }
      setDragMs(null);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div
      className="group absolute top-0 z-20 -translate-x-1/2"
      style={{ left: timeToPx(ms, scale) }}
      title={formatTimecode(ms)}
    >
      <button
        onMouseDown={handleMouseDown}
        className="block text-sm leading-none text-amber-400 hover:text-amber-300"
        style={{ cursor: editable ? 'grab' : 'pointer' }}
      >
        ▼
      </button>
      {editable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.dmx.deleteTimelinePoint(showId, index);
          }}
          className="absolute -top-3 left-1/2 hidden -translate-x-1/2 text-[10px] text-neutral-500 hover:text-red-400 group-hover:block"
          title="GO点を削除"
        >
          ✕
        </button>
      )}
    </div>
  );
}
