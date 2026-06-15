/**
 * Timeline トランスポート（§5.5・内部タイムコード）。
 * 再生/一時停止/停止・シーク・現在時刻表示と、GO ポイントの追加/削除。
 * 再生中は内部クロックが playhead を進め、エンジンがポイントを跨ぐと自動 GO。
 *
 * 音声同期は将来差し込み（再生位置を reportAudioPlayhead で送る経路は共通）。
 */

import { useDmxStore } from '../store';

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const t = Math.floor((ms % 1000) / 100);
  return `${mm}:${ss.toString().padStart(2, '0')}.${t}`;
}

export function TimelineBar() {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const transport = useDmxStore((s) => s.transport);
  const play = useDmxStore((s) => s.transportPlay);
  const pause = useDmxStore((s) => s.transportPause);
  const stop = useDmxStore((s) => s.transportStop);
  const seek = useDmxStore((s) => s.transportSeek);
  const editable = useDmxStore((s) => s.mode === 'edit');

  const show = project?.shows.find((s) => s.id === activeShowId) ?? null;
  const points = show?.timeline?.points ?? [];
  const loaded = show !== null;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
      <span className="text-[11px] font-semibold text-sky-400">Timeline</span>

      <div className="flex items-center gap-1">
        {transport.playing ? (
          <button
            onClick={pause}
            disabled={!loaded}
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
            title="一時停止"
          >
            ⏸
          </button>
        ) : (
          <button
            onClick={play}
            disabled={!loaded}
            className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
            title="再生"
          >
            ▶
          </button>
        )}
        <button
          onClick={stop}
          disabled={!loaded}
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          title="停止（先頭へ）"
        >
          ⏹
        </button>
      </div>

      <span className="w-16 font-mono text-xs text-neutral-200">{fmt(transport.playheadMs)}</span>

      <input
        type="range"
        min={0}
        max={transport.durationMs}
        value={transport.playheadMs}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!loaded}
        className="flex-1 accent-sky-500"
      />
      <span className="w-16 font-mono text-[10px] text-neutral-500">{fmt(transport.durationMs)}</span>

      <button
        onClick={() => activeShowId && window.dmx.addTimelinePoint(activeShowId, transport.playheadMs)}
        disabled={!loaded || !editable}
        className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
        title="現在位置に GO ポイントを追加"
      >
        ＋GO点
      </button>

      {/* ポイント一覧 */}
      <div className="flex max-w-[40%] items-center gap-1 overflow-x-auto">
        {points.map((p, i) => (
          <button
            key={i}
            onClick={() => seek(p.timecodeMs)}
            className="group flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-300 hover:bg-neutral-700"
            title="クリックでシーク"
          >
            {fmt(p.timecodeMs)}
            {editable && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeShowId) window.dmx.deleteTimelinePoint(activeShowId, i);
                }}
                className="text-neutral-600 group-hover:text-red-300"
              >
                ✕
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
