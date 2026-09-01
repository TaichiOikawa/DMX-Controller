/**
 * 512ch の実出力レベル可視化（エンジン由来 outputFrame）。
 * フェーダー位置ではなく合成後の出力を表示することで、
 * 後続のキャプチャ / HTP / Action 層が入っても「実際に出ている値」を確認できる。
 */

import { UNIVERSE_SIZE } from '../../shared/types';
import { useDmxStore } from '../store';

export function OutputMeter() {
  const output = useDmxStore((s) => s.output);
  // バーの高さは可変レイアウト（App のスプリッタで変更・localStorage 永続化）。
  const height = useDmxStore((s) => s.panelLayout.meterHeight);

  return (
    <div className="rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-neutral-400">出力モニター（全 512ch）</span>
      </div>
      <div className="flex gap-px" style={{ height }}>
        {Array.from({ length: UNIVERSE_SIZE }, (_, ch) => {
          const v = output[ch] ?? 0;
          const h = (v / 255) * 100;
          return (
            <div
              key={ch}
              className="relative h-full flex-1 rounded-sm bg-neutral-800"
              title={`CH ${ch + 1}: ${v}`}
            >
              <div
                className="absolute bottom-0 w-full rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-400"
                style={{ height: `${h}%`, minHeight: v > 0 ? 1 : 0 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
