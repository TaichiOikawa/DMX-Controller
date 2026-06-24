/**
 * 本番（SHOW）モード用の「現在 / 次の CUE」帯。
 * 現在 CUE の名前＋歌詞を大きく、次 CUE の名前を小さく表示する。
 * EDIT モードや Show 未読込のときは何も描画しない。
 */

import { Music, Play } from 'lucide-react';
import { cueAt, nextPosition } from '../../engine/playback';
import { useDmxStore } from '../store';

export function NowNextPanel() {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const playback = useDmxStore((s) => s.playback);
  const isShow = useDmxStore((s) => s.mode === 'show');

  if (!isShow) return null;

  const show = project?.shows.find((s) => s.id === activeShowId) ?? null;
  if (!show) return null;

  const seq = show.sequence;
  const main = playback?.mainIndex ?? -1;
  const sub = playback?.subIndex ?? 0;

  const current = main >= 0 ? cueAt(seq, { main, sub }) : null;
  const nextPos = nextPosition(seq, main, sub);
  const next = nextPos ? cueAt(seq, nextPos) : null;

  const curName = current ? (current.name?.trim() ? current.name : 'Cue') : '— 未開始 —';
  const curLyric = current?.lyrics?.trim() ?? '';
  const nextName = next ? (next.name?.trim() ? next.name : 'Cue') : '（最後）';
  const nextLyric = next?.lyrics?.trim() ?? '';

  return (
    <div className="flex items-stretch gap-4 rounded-lg bg-neutral-900/80 px-4 py-2 ring-1 ring-amber-700/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-amber-400">
            <Play size={11} fill="currentColor" /> NOW
          </span>
          <span className="truncate text-lg font-bold text-neutral-100">{curName}</span>
        </div>
        {curLyric && (
          <div className="flex items-center gap-1.5 truncate text-xl font-semibold text-amber-200">
            <Music size={16} className="shrink-0" /> {curLyric}
          </div>
        )}
      </div>

      <div className="w-px shrink-0 bg-neutral-700" />

      {/* NEXT は大きく強調（次の展開を見やすく） */}
      <div className="min-w-0 max-w-[45%] shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-sky-400">
            NEXT <Play size={11} fill="currentColor" />
          </span>
          <span
            className={`truncate text-lg font-bold ${next ? 'text-neutral-100' : 'text-neutral-600'}`}
          >
            {nextName}
          </span>
        </div>
        {nextLyric && (
          <div className="flex items-center gap-1.5 truncate text-base font-semibold text-sky-200/90">
            <Music size={14} className="shrink-0" /> {nextLyric}
          </div>
        )}
      </div>
    </div>
  );
}
