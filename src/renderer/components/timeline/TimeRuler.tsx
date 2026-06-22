/**
 * タイムルーラー（ms 専用）。0〜durationMs を目盛りで描画し、クリック/ドラッグでシークする。
 * リファレンスの TimeRulerGeneric を、絶対配置コンテンツ前提・非仮想化に簡素化して移植。
 */

import { useRef } from 'react';
import { timeToPx, formatTimecode, type TimeScale } from './utils';

interface StepConfig {
  majorStep: number;
  minorStep: number;
}

/** ズームに応じた目盛り間隔（ms）。 */
function getStepConfig(zoom: number): StepConfig {
  if (zoom < 0.1) return { majorStep: 20000, minorStep: 2000 };
  if (zoom < 0.2) return { majorStep: 10000, minorStep: 1000 };
  if (zoom < 0.4) return { majorStep: 5000, minorStep: 500 };
  if (zoom < 0.5) return { majorStep: 2500, minorStep: 250 };
  if (zoom < 1.0) return { majorStep: 2000, minorStep: 200 };
  if (zoom < 2.0) return { majorStep: 1000, minorStep: 100 };
  return { majorStep: 500, minorStep: 100 };
}

interface TimeRulerProps {
  durationMs: number;
  scale: TimeScale;
  /** クリック/ドラッグで呼ばれるシーク。 */
  onSeek: (ms: number) => void;
  playing: boolean;
}

export function TimeRuler({ durationMs, scale, onSeek, playing }: TimeRulerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { majorStep, minorStep } = getStepConfig(scale.zoom);

  const marks: { time: number; major: boolean }[] = [];
  for (let t = 0; t <= durationMs; t += minorStep) {
    marks.push({ time: t, major: t % majorStep === 0 });
  }

  const seekAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    onSeek(Math.max(0, Math.min(durationMs, Math.round(px / (0.1 * scale.zoom)))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (playing) return;
    e.preventDefault();
    seekAt(e.clientX);
    const move = (ev: MouseEvent) => seekAt(ev.clientX);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <div
      ref={ref}
      onMouseDown={handleMouseDown}
      className="relative h-7 select-none border-b border-neutral-700 bg-neutral-800"
      style={{ width: timeToPx(durationMs, scale), cursor: playing ? 'default' : 'pointer' }}
    >
      {marks.map((m) => (
        <div key={m.time} className="absolute top-0" style={{ left: timeToPx(m.time, scale) }}>
          <div
            className={m.major ? 'w-px bg-sky-500' : 'w-px bg-sky-500/40'}
            style={{ height: m.major ? '100%' : '50%', marginTop: m.major ? 0 : '50%' }}
          />
          {m.major && (
            <div className="absolute left-1 top-0.5 whitespace-nowrap font-mono text-[10px] text-neutral-300">
              {formatTimecode(m.time)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
