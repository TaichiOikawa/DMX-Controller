/**
 * 追加オーディオトラック1本のレーン（クリップ表示部のみ・右の時間軸エリアに置く）。
 * ヘッダ（名前/＋音声/音量/M/S）は左ヘッダ列の MixerHeader が担う。
 * クリップ（AudioClipBlock）を時間位置で並べ、複数クリップを任意位置へ配置できる。
 */

import type { AudioTrack } from '../../../shared/types';
import { AudioClipBlock } from './AudioClipBlock';
import { type TimeScale } from './utils';

interface AudioTrackLaneProps {
  showId: string;
  trackIndex: number;
  /** 対応トラック（未生成なら undefined＝空レーン）。 */
  track: AudioTrack | undefined;
  scale: TimeScale;
  editable: boolean;
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
  audioFileStatus,
  onSeek,
}: AudioTrackLaneProps) {
  const clips = track?.clips ?? [];
  return (
    <div className="relative h-20 border-b border-neutral-800 bg-neutral-900/40">
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
    </div>
  );
}
