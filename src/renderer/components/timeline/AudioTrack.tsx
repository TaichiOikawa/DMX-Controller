/**
 * 音声トラック。WaveSurfer で波形を表示する（表示専用・実再生はストアの <audio>）。
 * 波形は音声長を時間軸に合わせて全幅表示する（width = timeToPx(audioMs)）。
 */

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { timeToPx, type TimeScale } from './utils';

interface AudioTrackProps {
  audioUrl: string | null;
  scale: TimeScale;
  /** 波形読込後に音声長（ms）を親へ通知。 */
  onDurationMs?: (ms: number) => void;
}

export function AudioTrack({ audioUrl, scale, onDurationMs }: AudioTrackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [audioMs, setAudioMs] = useState(0);
  const onDurationRef = useRef(onDurationMs);
  useEffect(() => {
    onDurationRef.current = onDurationMs;
  }, [onDurationMs]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) {
      setAudioMs(0);
      return;
    }
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#34d399',
      progressColor: '#34d399',
      cursorWidth: 0,
      height: 48,
      normalize: true,
      interact: false,
      hideScrollbar: true,
      fillParent: true,
    });
    wsRef.current = ws;
    ws.on('ready', () => {
      const ms = Math.round(ws.getDuration() * 1000);
      setAudioMs(ms);
      onDurationRef.current?.(ms);
    });
    void ws.load(audioUrl).catch(() => {});

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioUrl]);

  if (!audioUrl) {
    return (
      <div className="flex h-12 items-center px-2 text-[11px] text-neutral-600">
        音声未設定
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-12 rounded bg-emerald-950/30"
      style={{ width: timeToPx(audioMs, scale) || '100%' }}
    />
  );
}
