/**
 * 単一フェーダー = 1 DMX チャンネル（§5.1, 1:1）。
 * 縦スライダー + ch 番号 + 数値表示/直接入力 + クリア(X)。
 *
 * 触ると「キャプチャ中（CUE 記録対象・show上書き §6.1）」になりハイライト。
 * 下部の X でキャプチャ解除（値も 0 に戻し show/0 へ復帰 §6.2）。
 */

import { useState } from 'react';

interface FaderProps {
  /** 0-511 のチャンネル番号 */
  ch: number;
  /** フェーダー位置 0-255 */
  value: number;
  /** エンジンの実出力 0-255（キャプチャ/HTP で位置と異なりうる） */
  output: number;
  /** キャプチャ中か（ハイライト） */
  captured: boolean;
  onChange: (value: number) => void;
  /** X 押下: キャプチャ解除＋値クリア */
  onClear: () => void;
}

export function Fader({ ch, value, output, captured, onChange, onClear }: FaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const pct = (value / 255) * 100;
  const outPct = (output / 255) * 100;
  const diverged = output !== value;

  const commitDraft = () => {
    const n = Math.max(0, Math.min(255, Math.round(Number(draft))));
    if (Number.isFinite(n)) onChange(n);
    setEditing(false);
  };

  return (
    <div
      className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-md py-1 ring-1 transition-colors ${
        captured ? 'bg-amber-500/10 ring-amber-500/70' : 'ring-transparent'
      }`}
    >
      <div
        className={`w-8 rounded text-center text-[10px] font-mono ${
          captured ? 'bg-amber-500 font-bold text-neutral-900' : 'text-neutral-500'
        }`}
      >
        {ch + 1}
      </div>

      <div className="relative h-44 w-8">
        <div className="absolute inset-y-0 right-0 w-1 rounded bg-neutral-800">
          <div
            className={`absolute bottom-0 w-full rounded ${diverged ? 'bg-amber-400' : 'bg-emerald-500'}`}
            style={{ height: `${outPct}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={255}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="fader-vertical absolute left-1/2 top-1/2 h-6 w-44 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer accent-sky-500"
          style={{ ['--pct' as string]: `${pct}%` }}
        />
      </div>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-10 rounded bg-neutral-800 text-center text-[11px] font-mono text-neutral-100 outline-none ring-1 ring-sky-500"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          className="w-10 rounded text-center text-[11px] font-mono text-neutral-200 hover:bg-neutral-800"
          title="クリックで直接入力"
        >
          {value}
        </button>
      )}

      <button
        onClick={onClear}
        disabled={!captured}
        className={`flex h-5 w-5 items-center justify-center rounded text-xs ${
          captured
            ? 'bg-neutral-800 text-amber-300 hover:bg-red-900/60 hover:text-red-200'
            : 'text-neutral-700'
        }`}
        title={captured ? 'キャプチャ解除（値を 0 に）' : '未キャプチャ'}
      >
        ✕
      </button>
    </div>
  );
}
