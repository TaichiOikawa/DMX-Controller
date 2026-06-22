/**
 * グランドマスター（全体調光）とブラックアウト(DBO)。
 * 出力の最終段に作用する安全装置。Edit / Show どちらのモードでも有効。
 * ※ フィクスチャ未対応のため、全 ch に一律で乗算/0 する点に注意。
 */

import { useDmxStore } from '../store';

export function MasterBar() {
  const masterLevel = useDmxStore((s) => s.masterLevel);
  const blackout = useDmxStore((s) => s.blackout);
  const setMasterLevel = useDmxStore((s) => s.setMasterLevel);
  const setBlackout = useDmxStore((s) => s.setBlackout);

  const pct = Math.round((masterLevel / 255) * 100);

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
      <button
        onClick={() => setBlackout(!blackout)}
        className={`rounded px-3 py-1.5 text-xs font-bold ring-1 transition-colors ${
          blackout
            ? 'bg-red-600 text-white ring-red-400'
            : 'bg-neutral-800 text-red-300 ring-neutral-700 hover:bg-neutral-700'
        }`}
        title="ブラックアウト（全 ch 即 0／編集データは保持）"
      >
        {blackout ? '⏻ BLACKOUT 中' : 'BLACKOUT'}
      </button>

      <div className="flex flex-1 items-center gap-2">
        <span className="text-xs font-semibold text-sky-400">GM</span>
        <input
          type="range"
          min={0}
          max={255}
          value={masterLevel}
          onChange={(e) => setMasterLevel(Number(e.target.value))}
          disabled={blackout}
          className="h-1.5 flex-1 cursor-pointer accent-sky-500 disabled:opacity-40"
          title="グランドマスター（全体調光）"
        />
        <span className="w-12 text-right font-mono text-xs text-neutral-300">{pct}%</span>
        <button
          onClick={() => setMasterLevel(255)}
          className="rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700"
          title="フル(100%)に戻す"
        >
          FULL
        </button>
      </div>
    </div>
  );
}
