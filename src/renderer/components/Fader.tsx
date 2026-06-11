/**
 * 単一フェーダー = 1 DMX チャンネル（§5.1, 1:1）。
 * 縦スライダー + ch 番号 + 数値表示/直接入力。
 * フェーダー位置（手動）と実出力（エンジン由来）を区別して表示する。
 */

import { useState } from 'react';

interface FaderProps {
  /** 0-511 のチャンネル番号 */
  ch: number;
  /** フェーダー位置 0-255 */
  value: number;
  /** エンジンの実出力 0-255（キャプチャ/HTP で位置と異なりうる） */
  output: number;
  onChange: (value: number) => void;
}

export function Fader({ ch, value, output, onChange }: FaderProps) {
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
    <div className="flex w-12 shrink-0 flex-col items-center gap-1">
      <div className="text-[10px] font-mono text-neutral-500">{ch + 1}</div>

      <div className="relative h-44 w-8">
        {/* 実出力インジケータ（背面の細バー） */}
        <div className="absolute inset-y-0 right-0 w-1 rounded bg-neutral-800">
          <div
            className={`absolute bottom-0 w-full rounded ${diverged ? 'bg-amber-400' : 'bg-emerald-500'}`}
            style={{ height: `${outPct}%` }}
          />
        </div>

        {/* 縦スライダー（回転で縦化） */}
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
    </div>
  );
}
