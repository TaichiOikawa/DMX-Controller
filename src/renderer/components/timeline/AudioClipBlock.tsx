/**
 * 追加オーディオトラック上の音声クリップ（ブロック表示）。
 * 編集モードでドラッグ移動（mouseup で確定）。10ms スナップ + 同一トラック内の衝突回避
 * （隣接クリップを跨がない範囲へクランプ）を行う。✕ で削除。
 * 実体（再生・ミックス・デコード状態）はストアが所有し、変更は engine 経由で onProject で戻る。
 */

import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { AudioClip } from '../../../shared/types';
import { pxToTime, snapMs, timeToPx, type TimeScale } from './utils';

interface AudioClipBlockProps {
  showId: string;
  trackIndex: number;
  clip: AudioClip;
  /** 同一トラックの全クリップ（開始位置昇順・衝突回避の近傍算出に使う）。 */
  clips: readonly AudioClip[];
  scale: TimeScale;
  editable: boolean;
  /** 音源の読込状態（欠損表示用）。 */
  status: 'loading' | 'ready' | 'missing' | undefined;
  onSeek: (ms: number) => void;
}

export function AudioClipBlock({
  showId,
  trackIndex,
  clip,
  clips,
  scale,
  editable,
  status,
  onSeek,
}: AudioClipBlockProps) {
  const [dragMs, setDragMs] = useState<number | null>(null);
  const moved = useRef(false);
  const startMs = dragMs ?? clip.startMs;

  // 衝突回避：自分の左右隣の固定位置から、跨がない開始位置の範囲を求める。
  const idx = clips.findIndex((c) => c.id === clip.id);
  const left = idx > 0 ? clips[idx - 1] : null;
  const right = idx >= 0 && idx < clips.length - 1 ? clips[idx + 1] : null;
  const minStart = left ? left.startMs + left.durationMs : 0;
  const maxStart = right ? Math.max(minStart, right.startMs - clip.durationMs) : Infinity;

  const clamp = (ms: number): number => Math.min(maxStart, Math.max(minStart, snapMs(ms)));

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) {
      onSeek(clip.startMs);
      return;
    }
    e.preventDefault();
    moved.current = false;
    const startX = e.clientX;
    const origin = clip.startMs;

    const move = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) moved.current = true;
      const delta = pxToTime(ev.clientX - startX, scale);
      setDragMs(clamp(origin + delta));
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved.current) {
        const delta = pxToTime(ev.clientX - startX, scale);
        window.dmx.moveAudioClip(showId, trackIndex, clip.id, clamp(origin + delta));
      } else {
        onSeek(clip.startMs);
      }
      setDragMs(null);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const fileName = clip.filePath.split(/[\\/]/).pop() ?? clip.filePath;
  const missing = status === 'missing';
  const width = Math.max(8, timeToPx(clip.durationMs, scale));

  return (
    <div
      className={`group absolute top-1 bottom-1 z-10 overflow-hidden rounded ring-1 ${
        missing
          ? 'bg-red-950/70 ring-red-500/50'
          : 'bg-emerald-800/50 ring-emerald-500/40 hover:bg-emerald-700/50'
      }`}
      style={{ left: timeToPx(startMs, scale), width, cursor: editable ? 'grab' : 'pointer' }}
      onMouseDown={handleMouseDown}
      title={`${fileName}${missing ? '（音源が見つかりません）' : ''}`}
    >
      <div className="flex items-center gap-1 px-1 pt-0.5 text-[10px] leading-tight">
        <span className={`truncate ${missing ? 'text-red-300' : 'text-emerald-100'}`}>
          {status === 'loading' ? '読込中… ' : ''}
          {fileName}
        </span>
      </div>
      {editable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            window.dmx.removeAudioClip(showId, trackIndex, clip.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-0.5 top-0.5 hidden rounded bg-neutral-900/70 text-neutral-300 hover:text-red-400 group-hover:block"
          title="クリップを削除"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
