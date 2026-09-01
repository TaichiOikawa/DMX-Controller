/**
 * 単一フェーダー = 1 DMX チャンネル（§5.1, 1:1）。
 * 縦スライダー + ch 番号 + 数値表示/直接入力 + クリア(X)。
 *
 * ハイライト: SHOW モードの busking ライブ上書き中 ch は purple、EDIT で選択中 CUE が
 * 握る ch は sky。ch 番号ボタンで現在値のまま反映（値を動かさず確定）。
 * 下部の X は CUE ch なら CUE から削除、busking なら解除（値を 0 に戻す）。
 */

import { X } from 'lucide-react';
import { useState } from 'react';
import { InlineText } from './InlineText';

interface FaderProps {
  /** 0-511 のチャンネル番号 */
  ch: number;
  /** フェーダー位置 0-255 */
  value: number;
  /** エンジンの実出力 0-255（busking/HTP で位置と異なりうる） */
  output: number;
  /** busking ライブ上書き中か（SHOW モード・purple ハイライト） */
  busking: boolean;
  /** 選択中（current）CUE が握る ch か（sky ハイライト） */
  inSelectedCue: boolean;
  /** Show 未読込（解放中）か。busking 概念を持たず、X は「値を 0 に」リセット。 */
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
  busking,
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
  // ハイライト優先度: busking(purple) > 選択中 CUE(sky) > なし。
  const cueHi = inSelectedCue && !busking;
  // 解放中は busking/CUE が無いので、X は「値を 0 に」リセット（値>0 のとき活性）。
  const clearable = busking || inSelectedCue || (!!released && value > 0);

  const commitDraft = () => {
    const n = Math.max(0, Math.min(255, Math.round(Number(draft))));
    if (Number.isFinite(n)) onChange(n);
    setEditing(false);
  };

  return (
    <div
      className={`flex h-full min-h-0 w-12 shrink-0 flex-col items-center gap-1 rounded-md py-1 ring-1 transition-colors ${
        busking
          ? 'bg-purple-500/10 ring-purple-500/70'
          : cueHi
            ? 'bg-sky-500/10 ring-sky-500/70'
            : 'ring-transparent'
      }`}
    >
      <button
        type="button"
        onClick={() => onChange(value)}
        disabled={released}
        className={`w-8 rounded text-center text-[10px] font-mono transition-colors ${
          busking
            ? 'bg-purple-500 font-bold text-neutral-900'
            : cueHi
              ? 'bg-sky-500 font-bold text-neutral-900'
              : 'text-neutral-500 enabled:hover:bg-neutral-800 enabled:hover:text-neutral-300'
        }`}
        title={
          released
            ? `CH${ch + 1}`
            : cueHi
              ? `CH${ch + 1} を現在値で CUE に追加`
              : `CH${ch + 1} を現在値で反映`
        }
      >
        {ch + 1}
      </button>

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

      {/* スライダー領域。高さはパネルに追従（min-h でつぶれ過ぎを防ぐ）。 */}
      <div className="relative min-h-12 w-8 flex-1">
        {/* 実出力バー（右端） */}
        <div className="absolute inset-y-0 right-0 w-1 rounded bg-neutral-800">
          <div
            className={`absolute bottom-0 w-full rounded ${diverged ? 'bg-amber-400' : 'bg-emerald-500'}`}
            style={{ height: `${outPct}%` }}
          />
        </div>

        {/* フェーダーのトラック（見た目のみ。操作は上に重ねた透明な range が受ける） */}
        <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-neutral-700">
          <div
            className="absolute bottom-0 w-full rounded-full bg-sky-600"
            style={{ height: `${pct}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={255}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="fader-vertical absolute inset-y-0 left-1/2 -translate-x-1/2 cursor-pointer"
        />
      </div>

      {editing ? (
        <input
          autoFocus
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
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
          busking
            ? 'bg-neutral-800 text-purple-300 hover:bg-red-900/60 hover:text-red-200'
            : cueHi
              ? 'bg-neutral-800 text-sky-300 hover:bg-red-900/60 hover:text-red-200'
              : clearable
                ? 'bg-neutral-800 text-neutral-300 hover:bg-red-900/60 hover:text-red-200'
                : 'text-neutral-700'
        }`}
        title={
          cueHi
            ? 'この CUE からこの ch を削除'
            : busking
              ? 'busking 解除（値を 0 に）'
              : released
                ? '値を 0 に'
                : '—'
        }
      >
        <X size={13} />
      </button>
    </div>
  );
}
