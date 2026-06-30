/**
 * トラックヘッダ（左ヘッダ列の1行）。名前 + 任意の「＋音声」 + 音量 + ミュート(M) + ソロ(S)。
 * メイン音声トラックと追加トラックで共通利用する。実体は engine/store が所有し、操作は親から渡す。
 */

import { Plus, Trash2 } from 'lucide-react';
import type { AudioOutputDevice } from './useAudioOutputDevices';

interface MixerHeaderProps {
  name: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  /** 指定するとクリップ追加ボタン（＋音声）を表示する。 */
  onAdd?: () => void;
  /** ＋音声を無効化（編集モード外など）。 */
  addDisabled?: boolean;
  /** 指定すると音声削除ボタンを表示する（追加ボタンの隣）。 */
  onDelete?: () => void;
  /** 音声削除を有効化する条件（音声/クリップがある等）。false で非表示。 */
  canDelete?: boolean;
  /** 出力デバイス一覧（先頭は既定デバイス）。 */
  devices: AudioOutputDevice[];
  /** 現在の出力デバイス（'' = 既定）。 */
  deviceId: string;
  /** 出力デバイス変更（'' = 既定へ戻す）。 */
  onDevice: (deviceId: string) => void;
  /** 全コントロールを無効化（メイン音声未設定など）。 */
  disabled?: boolean;
}

export function MixerHeader({
  name,
  volume,
  muted,
  solo,
  onVolume,
  onToggleMute,
  onToggleSolo,
  onAdd,
  addDisabled,
  onDelete,
  canDelete,
  devices,
  deviceId,
  onDevice,
  disabled,
}: MixerHeaderProps) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1 px-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-300">
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onAdd && (
            <button
              onClick={onAdd}
              disabled={addDisabled}
              className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-emerald-300 hover:bg-neutral-700 disabled:opacity-40"
              title="音声を追加"
            >
              <Plus size={11} /> 音声
            </button>
          )}
          {onDelete && canDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center rounded bg-neutral-800 px-1 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-red-400"
              title="音声を削除"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          disabled={disabled}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 accent-emerald-500 disabled:opacity-40"
          title={`音量 ${Math.round(volume * 100)}%`}
        />
        <button
          onClick={onToggleMute}
          disabled={disabled}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none disabled:opacity-40 ${
            muted ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
          title="ミュート"
        >
          M
        </button>
        <button
          onClick={onToggleSolo}
          disabled={disabled}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none disabled:opacity-40 ${
            solo ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
          title="ソロ"
        >
          S
        </button>
      </div>
      {/* 出力デバイス選択 */}
      <select
        value={deviceId}
        disabled={disabled}
        onChange={(e) => onDevice(e.target.value)}
        className="h-5 w-full min-w-0 truncate rounded bg-neutral-800 px-1 text-[10px] text-neutral-300 outline-none ring-1 ring-neutral-700 focus:ring-sky-500 disabled:opacity-40"
        title="出力デバイス"
      >
        {devices.map((d) => (
          <option key={d.deviceId || 'default'} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}
