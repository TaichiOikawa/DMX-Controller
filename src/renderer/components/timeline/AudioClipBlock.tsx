/**
 * 追加オーディオトラック上の音声クリップ（ブロック表示）。
 * 編集モードでドラッグ移動（mouseup で確定）。10ms スナップ + 同一トラック内の衝突回避
 * （隣接クリップを跨がない範囲へクランプ）を行う。✕ で削除。
 * 実体（再生・ミックス・デコード状態）はストアが所有し、変更は engine 経由で onProject で戻る。
 */

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { AudioClip } from '../../../shared/types';
import { onceVisible, pxToTime, snapMs, timeToPx, type TimeScale } from './utils';

function mimeFor(p: string): string {
  switch (p.toLowerCase().split('.').pop()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/*';
  }
}

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

  const missing = status === 'missing';

  // クリップ内に波形を表示する（メイン音声と同様 WaveSurfer・表示専用）。
  // 実バイトを読み出し Blob URL 化してロードする。再生位置の同期は不要（実再生はストア）。
  // missing を依存に含め、再リンクで波形 div が再マウントされたら作り直す。
  const waveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    let ws: WaveSurfer | null = null;
    let cancelVisible = () => {};
    window.dmx.readAudioFile(clip.filePath).then((res) => {
      const el = waveRef.current;
      if (cancelled || !el || !res.ok || !res.data) return;
      createdUrl = URL.createObjectURL(new Blob([res.data], { type: mimeFor(clip.filePath) }));
      const url = createdUrl;
      // Timeline タブ非表示中（幅 0）に生成すると canvas が作られないため、幅が付くまで待つ。
      cancelVisible = onceVisible(el, () => {
        if (cancelled) return;
        ws = WaveSurfer.create({
          container: el,
          waveColor: 'rgba(167, 243, 208, 0.55)',
          progressColor: 'rgba(167, 243, 208, 0.55)',
          cursorWidth: 0,
          height: 36,
          normalize: true,
          interact: false,
          hideScrollbar: true,
          fillParent: true,
        });
        ws.on('error', (e) => console.error('[AudioClip] wavesurfer error', e));
        void ws.load(url).catch((e) => console.error('[AudioClip] load rejected', e));
      });
    });
    return () => {
      cancelled = true;
      cancelVisible();
      ws?.destroy();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [clip.filePath, missing]);

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
      {/* 波形（背面・操作はブロックへ素通り）。欠損時は表示しない。 */}
      {!missing && (
        <div
          ref={waveRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 top-3 opacity-90"
        />
      )}
      <div className="relative flex items-center gap-1 px-1 pt-0.5 text-[10px] leading-tight">
        <span
          className={`truncate rounded bg-neutral-900/50 px-0.5 ${
            missing ? 'text-red-300' : 'text-emerald-50'
          }`}
        >
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
