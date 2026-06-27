/**
 * 追加オーディオトラック1本のレーン（メイン音声とは別）。
 * 左端に固定（sticky）のヘッダ（名前 / ＋音声 / 音量 / ミュート(M) / ソロ(S)）を重ね、
 * 残りにクリップ（AudioClipBlock）を時間位置で並べる。複数クリップを任意位置へ配置できる。
 * 実体（再生・ミックス・永続化）は engine/store が所有し、操作は window.dmx 経由で行う。
 */

import { Plus } from 'lucide-react';
import type { AudioTrack } from '../../../shared/types';
import { AudioClipBlock } from './AudioClipBlock';
import { snapMs, type TimeScale } from './utils';

interface AudioTrackLaneProps {
  showId: string;
  trackIndex: number;
  /** 対応トラック（未生成なら undefined＝既定値で表示）。 */
  track: AudioTrack | undefined;
  scale: TimeScale;
  editable: boolean;
  /** ＋音声で挿入する位置（現在のプレイヘッド）。 */
  playheadMs: number;
  /** 音源の読込状態（filePath 単位）。 */
  audioFileStatus: Record<string, 'loading' | 'ready' | 'missing'>;
  onSeek: (ms: number) => void;
}

export function AudioTrackLane({
  showId,
  trackIndex,
  track,
  scale,
  editable,
  playheadMs,
  audioFileStatus,
  onSeek,
}: AudioTrackLaneProps) {
  const clips = track?.clips ?? [];
  const volume = track?.volume ?? 1;
  const muted = track?.muted ?? false;
  const solo = track?.solo ?? false;
  const name = track?.name ?? `Track ${trackIndex + 1}`;

  const addClip = async () => {
    if (!showId) return;
    const res = await window.dmx.pickAudioClip();
    if (!res.ok || !res.path) return;
    const file = await window.dmx.readAudioFile(res.path);
    if (!file.ok || !file.data) return;
    let durationMs: number;
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(file.data);
      durationMs = Math.round(buf.duration * 1000);
      void ctx.close();
    } catch {
      return;
    }
    window.dmx.addAudioClip(showId, trackIndex, res.path, snapMs(playheadMs), durationMs);
  };

  const setProps = (props: { volume?: number; muted?: boolean; solo?: boolean }) => {
    if (showId) window.dmx.setAudioTrackProps(showId, trackIndex, props);
  };

  return (
    <div className="relative h-16 border-b border-neutral-800 bg-neutral-900/40">
      {/* クリップ */}
      {clips.map((clip) => (
        <AudioClipBlock
          key={clip.id}
          showId={showId}
          trackIndex={trackIndex}
          clip={clip}
          clips={clips}
          scale={scale}
          editable={editable}
          status={audioFileStatus[clip.filePath]}
          onSeek={onSeek}
        />
      ))}

      {/* 固定ヘッダ（横スクロールでも左端に残す） */}
      <div className="sticky left-0 top-0 z-30 flex h-full w-36 flex-col justify-center gap-1 border-r border-neutral-800 bg-neutral-900/95 px-2 py-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] font-medium text-neutral-300">{name}</span>
          <button
            onClick={addClip}
            disabled={!editable}
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-emerald-300 hover:bg-neutral-700 disabled:opacity-40"
            title="現在位置に音声クリップを追加"
          >
            <Plus size={11} /> 音声
          </button>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setProps({ volume: Number(e.target.value) })}
            className="h-1 flex-1 accent-emerald-500"
            title={`音量 ${Math.round(volume * 100)}%`}
          />
          <button
            onClick={() => setProps({ muted: !muted })}
            className={`rounded px-1 py-0.5 text-[10px] font-bold ${
              muted ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
            }`}
            title="ミュート"
          >
            M
          </button>
          <button
            onClick={() => setProps({ solo: !solo })}
            className={`rounded px-1 py-0.5 text-[10px] font-bold ${
              solo ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
            }`}
            title="ソロ"
          >
            S
          </button>
        </div>
      </div>
    </div>
  );
}
