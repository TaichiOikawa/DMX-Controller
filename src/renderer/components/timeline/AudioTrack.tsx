/**
 * 音声トラック。WaveSurfer で波形を表示する（表示専用・実再生はストアの Web Audio）。
 * 波形はストアが再生用バッファから作ったピークを描くだけで、音声の fetch も decode もしない。
 * 波形は音声長を時間軸に合わせて全幅表示する（width = timeToPx(durationMs)）。
 */

import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { WaveformPeaks } from '../../store';
import { onceVisible, timeToPx, type TimeScale } from './utils';

interface AudioTrackProps {
  /** 波形データ。音声が設定済みでも生成前は null になる（描画待ちが再生を妨げないため）。 */
  peaks: WaveformPeaks | null;
  /** Show にメイン音声が設定されているか（未設定と読込中を区別する）。 */
  hasAudio: boolean;
  scale: TimeScale;
}

export function AudioTrack({ peaks, hasAudio, scale }: AudioTrackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !peaks || peaks.durationMs <= 0) return;
    let ws: WaveSurfer | null = null;
    // Timeline タブ非表示中（幅 0）に生成すると canvas が作られないため、幅が付くまで待つ。
    const cancelVisible = onceVisible(el, () => {
      ws = WaveSurfer.create({
        container: el,
        waveColor: '#34d399',
        progressColor: '#34d399',
        cursorWidth: 0,
        height: 48,
        normalize: true,
        interact: false,
        hideScrollbar: true,
        fillParent: true,
        // peaks + duration を渡すと WaveSurfer は音声を読みに行かない（再デコードなし）。
        peaks: peaks.peaks,
        duration: peaks.durationMs / 1000,
      });
      ws.on('error', (e) => console.error('[AudioTrack] wavesurfer error', e));
    });

    return () => {
      cancelVisible();
      ws?.destroy();
    };
  }, [peaks]);

  if (!peaks) {
    return (
      <div className="flex h-12 items-center px-2 text-[11px] text-neutral-600">
        {hasAudio ? '波形を生成中…' : '音声未設定'}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-12 rounded bg-emerald-950/30"
      style={{ width: timeToPx(peaks.durationMs, scale) || '100%' }}
    />
  );
}
