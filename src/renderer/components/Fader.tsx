/**
 * 単一フェーダー = 1 DMX チャンネル（§5.1, 1:1）。
 * 縦スライダー + ch 番号 + 数値表示/直接入力 + クリア(X)。
 *
 * 触ると「キャプチャ中（CUE 記録対象・show上書き §6.1）」になりハイライト。
 * 下部の X でキャプチャ解除（値も 0 に戻し show/0 へ復帰 §6.2）。
 */

import { X } from 'lucide-react';
import { useState } from 'react';
import { InlineText } from './InlineText';

interface FaderProps {
  /** 0-511 のチャンネル番号 */
  ch: number;
  /** フェーダー位置 0-255 */
  value: number;
  /** エンジンの実出力 0-255（キャプチャ/HTP で位置と異なりうる） */
  output: number;
  /** キャプチャ中か（プログラマー・amber ハイライト） */
  captured: boolean;
  /** 選択中（current）CUE が握る ch か（sky ハイライト） */
  inSelectedCue: boolean;
  /** Show 未読込（解放中）か。capture 概念を持たず、X は「値を 0 に」リセット。 */
  released?: boolean;
  /** ch ラベル（任意）。 */
  label?: string;
  /** ラベル編集可（EDIT モード）。 */
  editable: boolean;
  onChange: (value: number) => void;
  /** X 押下: キャプチャ解除＋値クリア（CUE ch なら CUE から ch を削除） */
  onClear: () => void;
  /** ラベル変更（空文字で削除）。 */
  onLabelChange: (label: string) => void;
}

export function Fader({
  ch,
  value,
  output,
  captured,
  inSelectedCue,
  released,
  label,
  editable,
  onChange,
  onClear,
  onLabelChange,
}: FaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const pct = (value / 255) * 100;
  const outPct = (output / 255) * 100;
  const diverged = output !== value;
  // ハイライト優先度: captured(amber) > 選択中 CUE(sky) > なし。
  const cueHi = inSelectedCue && !captured;
  // 解放中は capture/CUE が無いので、X は「値を 0 に」リセット（値>0 のとき活性）。
  const clearable = captured || inSelectedCue || (!!released && value > 0);

  const commitDraft = () => {
    const n = Math.max(0, Math.min(255, Math.round(Number(draft))));
    if (Number.isFinite(n)) onChange(n);
    setEditing(false);
  };

  return (
    <div
      className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-md py-1 ring-1 transition-colors ${
        captured
          ? 'bg-amber-500/10 ring-amber-500/70'
          : cueHi
            ? 'bg-sky-500/10 ring-sky-500/70'
            : 'ring-transparent'
      }`}
    >
      <div
        className={`w-8 rounded text-center text-[10px] font-mono ${
          captured
            ? 'bg-amber-500 font-bold text-neutral-900'
            : cueHi
              ? 'bg-sky-500 font-bold text-neutral-900'
              : 'text-neutral-500'
        }`}
      >
        {ch + 1}
      </div>

      {/* ch ラベル（高さ固定でフェーダーの縦位置を揃える） */}
      <div className="flex h-3 w-11 items-center justify-center">
        <InlineText
          value={label ?? ''}
          placeholder="＋名前"
          editable={editable}
          onCommit={onLabelChange}
          className="block w-11 truncate px-0.5 text-center text-[9px] text-neutral-400"
          title={label ? `CH${ch + 1}: ${label}` : `CH${ch + 1} のラベルを編集`}
        />
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
        disabled={!clearable}
        className={`flex h-5 w-5 items-center justify-center rounded text-xs ${
          captured
            ? 'bg-neutral-800 text-amber-300 hover:bg-red-900/60 hover:text-red-200'
            : cueHi
              ? 'bg-neutral-800 text-sky-300 hover:bg-red-900/60 hover:text-red-200'
              : clearable
                ? 'bg-neutral-800 text-neutral-300 hover:bg-red-900/60 hover:text-red-200'
                : 'text-neutral-700'
        }`}
        title={
          cueHi
            ? 'この CUE からこの ch を削除'
            : captured
              ? 'キャプチャ解除（値を 0 に）'
              : released
                ? '値を 0 に'
                : '未キャプチャ'
        }
      >
        <X size={13} />
      </button>
    </div>
  );
}
