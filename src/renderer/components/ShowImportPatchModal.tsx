/**
 * Show 読み込み時のパッチ（チャンネル再割当）モーダル。
 *
 * .dmxshow を解析した結果（store.showImport）が非 null のとき表示する。
 * Show が使う各「元 ch」を、読込先の任意の「先 ch」へ割り当ててから取り込む。
 * 一括オフセットで全 ch を一斉にずらし、その後個別に微調整できる。
 * 既定は同一 ch（恒等写像）。確定で remapShowChannels → importShow。
 */

import { useEffect, useMemo, useState } from 'react';
import { useDmxStore } from '../store';
import { collectShowChannels, remapShowChannels } from '../../shared/persistence';
import { UNIVERSE_SIZE, type Show } from '../../shared/types';
import type { ShowFilePayload } from '../../shared/ipc';

const clampCh = (n: number) => Math.max(0, Math.min(UNIVERSE_SIZE - 1, Math.round(n)));

/** 恒等写像（元 ch -> 同じ ch）を作る。 */
function identityMap(channels: number[]): Record<number, number> {
  const init: Record<number, number> = {};
  for (const ch of channels) init[ch] = ch;
  return init;
}

/**
 * store.showImport が非 null のときだけ中身（PatchForm）をマウントする。
 * payload ごとにマウント／アンマウントされるので、フォーム状態は自然にリセットされる。
 */
export function ShowImportPatchModal() {
  const payload = useDmxStore((s) => s.showImport);
  if (!payload) return null;
  return <PatchForm payload={payload} />;
}

function PatchForm({ payload }: { payload: ShowFilePayload }) {
  const setShowImport = useDmxStore((s) => s.setShowImport);
  const channelLabels = useDmxStore((s) => s.project?.channelLabels);

  const show: Show = payload.show;
  const sourceLabels = payload.sourceLabels;

  // Show が使う元 ch（昇順）。
  const usedChannels = useMemo(() => collectShowChannels(show), [show]);

  // 元 ch -> 先 ch（0-based）。既定は同一 ch（マウント時に初期化）。
  const [targets, setTargets] = useState<Record<number, number>>(() =>
    identityMap(collectShowChannels(show)),
  );
  const [offset, setOffset] = useState(0);

  // Esc で閉じる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowImport(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setShowImport]);

  // 先 ch の重複検出（後勝ちになる旨を警告）。
  const duplicateTargets = useMemo(() => {
    const seen = new Set<number>();
    const dup = new Set<number>();
    for (const ch of usedChannels) {
      const t = targets[ch];
      if (t === undefined) continue;
      if (seen.has(t)) dup.add(t);
      else seen.add(t);
    }
    return dup;
  }, [targets, usedChannels]);

  const applyOffset = () => {
    const next: Record<number, number> = {};
    for (const ch of usedChannels) next[ch] = clampCh(ch + offset);
    setTargets(next);
  };

  const resetIdentity = () => {
    setTargets(identityMap(usedChannels));
    setOffset(0);
  };

  const confirm = () => {
    const remapped = remapShowChannels(show, targets);
    window.dmx.importShow(remapped);
    setShowImport(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setShowImport(null)}
    >
      <div
        className="flex max-h-[88vh] w-[34rem] max-w-[92vw] flex-col rounded-xl bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-sky-400">
            Show を読み込み（パッチ）— {show.name}
          </h2>
          <button
            onClick={() => setShowImport(null)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
        </div>

        {/* 一括オフセット */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-5 py-2.5 text-xs text-neutral-300">
          <span>一括オフセット</span>
          <input
            type="number"
            value={offset}
            onChange={(e) => setOffset(Math.round(Number(e.target.value) || 0))}
            className="w-20 rounded bg-neutral-800 px-2 py-1 text-right text-neutral-100 ring-1 ring-neutral-700"
          />
          <span className="text-neutral-500">ch ずらす</span>
          <button
            onClick={applyOffset}
            className="rounded bg-sky-700 px-2 py-1 text-white hover:bg-sky-600"
          >
            適用
          </button>
          <button
            onClick={resetIdentity}
            className="rounded bg-neutral-800 px-2 py-1 text-neutral-300 hover:bg-neutral-700"
          >
            同一に戻す
          </button>
        </div>

        {/* ch 別リマップ表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {usedChannels.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-500">
              この Show は ch を使用していません。そのまま取り込めます。
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="py-1 text-left font-medium">元 ch</th>
                  <th className="py-1 text-left font-medium">→ 先 ch</th>
                  <th className="py-1 text-left font-medium">読込先ラベル</th>
                </tr>
              </thead>
              <tbody>
                {usedChannels.map((src) => {
                  const target = targets[src] ?? src;
                  const dst = clampCh(target);
                  const isDup = duplicateTargets.has(dst);
                  return (
                    <tr key={src} className="border-t border-neutral-800/70">
                      <td className="py-1 pr-2 text-neutral-200">
                        CH{src + 1}
                        {sourceLabels?.[src] && (
                          <span className="ml-1.5 text-neutral-500">{sourceLabels[src]}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          min={1}
                          max={UNIVERSE_SIZE}
                          value={dst + 1}
                          onChange={(e) =>
                            setTargets((prev) => ({
                              ...prev,
                              [src]: clampCh(Number(e.target.value) - 1),
                            }))
                          }
                          className={`w-20 rounded bg-neutral-800 px-2 py-1 text-right text-neutral-100 ring-1 ${
                            isDup ? 'ring-amber-500' : 'ring-neutral-700'
                          }`}
                        />
                      </td>
                      <td className="py-1 text-neutral-400">{channelLabels?.[dst] ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* フッタ */}
        <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-5 py-3">
          <span className="text-[11px] text-amber-400">
            {duplicateTargets.size > 0
              ? '先 ch が重複しています。重複先は後の ch の値で上書きされます。'
              : ' '}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowImport(null)}
              className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
            >
              キャンセル
            </button>
            <button
              onClick={confirm}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              取り込み
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
