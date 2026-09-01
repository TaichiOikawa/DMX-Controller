/**
 * GO ポイントをルーラー上のマーカー（▼）で表示する。
 * クリック=シーク、編集モードでドラッグ=移動（mouseup で確定）、✕=削除。
 * 各ポイントには CUE を紐づけられ（▼下のラベル/セレクト）、跨ぐとその CUE へ頭出しする。
 * 未紐づけは従来どおり順送り（GO）。
 * エンジン側 add/delete/update/setCue が真実で、変更は onProject 経由で戻る。
 */

import { MapPin, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TimelinePoint } from '../../../shared/types';
import { formatTimecode, pxToTime, timeToPx, type CueOption, type TimeScale } from './utils';

interface GoMarkersProps {
  showId: string;
  points: readonly TimelinePoint[];
  cues: readonly CueOption[];
  durationMs: number;
  scale: TimeScale;
  editable: boolean;
  onSeek: (ms: number) => void;
}

export function GoMarkers({ showId, points, cues, durationMs, scale, editable, onSeek }: GoMarkersProps) {
  return (
    <>
      {points.map((p) => (
        <GoMarker
          key={p.id}
          showId={showId}
          point={p}
          cues={cues}
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
  point: TimelinePoint;
  cues: readonly CueOption[];
  durationMs: number;
  scale: TimeScale;
  editable: boolean;
  onSeek: (ms: number) => void;
}

function GoMarker({ showId, point, cues, durationMs, scale, editable, onSeek }: GoMarkerProps) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const moved = useRef(false);
  const ms = dragMs ?? point.timecodeMs;

  const linked = point.cueId ? cues.find((c) => c.id === point.cueId) : undefined;
  // ラベル: 紐づけ CUE があれば "番号 歌詞/CUE名"、削除済みなら "?"、未紐づけは "GO"。
  const label = point.cueId ? (linked ? `${linked.no} ${linked.label}` : '?') : 'GO';
  const tinted = !!point.cueId; // CUE 紐づけは色を変えて区別

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
        window.dmx.updateTimelinePoint(showId, point.id, newMs);
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
      className="group absolute top-0 z-20 flex -translate-x-1/2 flex-col items-center"
      style={{ left: timeToPx(ms, scale) }}
      title={`${formatTimecode(ms)} → ${point.cueId ? (linked ? `CUE ${label}` : 'CUE（削除済）') : '順送り GO'}`}
    >
      <button
        onMouseDown={handleMouseDown}
        className={`block leading-none ${
          tinted ? 'text-sky-400 hover:text-sky-300' : 'text-amber-400 hover:text-amber-300'
        }`}
        style={{ cursor: editable ? 'grab' : 'pointer' }}
      >
        <MapPin size={14} fill="currentColor" />
      </button>

      {editable ? (
        <select
          value={point.cueId ?? ''}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            window.dmx.setTimelinePointCue(showId, point.id, e.target.value || undefined)
          }
          className="mt-0.5 max-w-[6rem] rounded bg-neutral-800 px-0.5 text-[9px] text-neutral-200 outline-none ring-1 ring-neutral-700 focus:ring-sky-500"
          title="このポイントが頭出しする CUE"
        >
          <option value="">順送り(GO)</option>
          {cues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.no} {c.label}
            </option>
          ))}
        </select>
      ) : (
        <span
          className={`mt-0.5 max-w-[6rem] truncate text-[9px] ${
            tinted ? 'text-sky-300' : 'text-neutral-500'
          }`}
        >
          {label}
        </span>
      )}

      {editable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.dmx.deleteTimelinePoint(showId, point.id);
          }}
          className="absolute -top-3 left-1/2 hidden -translate-x-1/2 text-neutral-500 hover:text-red-400 group-hover:block"
          title="GO点を削除"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
