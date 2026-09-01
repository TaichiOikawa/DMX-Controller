/**
 * フェーダーバンク（§5.1）。512ch を 32 本ずつ 16 ページに分けて表示し、
 * ページ切替タブでバンクを移動する。SHOW モードの busking 上書き中 ch を purple ハイライト。
 */

import { ChevronDown, ChevronRight, Palette } from 'lucide-react';
import { useEffect } from 'react';
import { Fader } from './Fader';
import { InlineText } from './InlineText';
import { BANK_COUNT, FADERS_PER_BANK, useDmxStore } from '../store';
import { cueAt } from '../../engine/playback';

export function FaderBank() {
  const bank = useDmxStore((s) => s.bank);
  const setBank = useDmxStore((s) => s.setBank);
  const faders = useDmxStore((s) => s.faders);
  const output = useDmxStore((s) => s.output);
  const busking = useDmxStore((s) => s.busking);
  const setFader = useDmxStore((s) => s.setFader);
  const releaseChannel = useDmxStore((s) => s.releaseChannel);
  const releaseAll = useDmxStore((s) => s.releaseAll);
  const syncFadersToCue = useDmxStore((s) => s.syncFadersToCue);
  const deleteCueChannel = useDmxStore((s) => s.deleteCueChannel);
  const collapsed = useDmxStore((s) => s.fadersCollapsed);
  const toggleCollapsed = useDmxStore((s) => s.toggleFadersCollapsed);
  const editable = useDmxStore((s) => s.mode === 'edit');
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const playback = useDmxStore((s) => s.playback);
  const channelLabels = useDmxStore((s) => s.project?.channelLabels);
  const bankLabels = useDmxStore((s) => s.project?.bankLabels);

  const editingActionId = useDmxStore((s) => s.editingActionId);

  // 選択中（プレイヘッド位置）の CUE。EDIT モードのみ。
  const activeShow = project?.shows.find((s) => s.id === activeShowId) ?? null;
  const mainIndex = playback?.mainIndex ?? -1;
  const subIndex = playback?.subIndex ?? 0;
  const selectedCue =
    editable && activeShow && mainIndex >= 0
      ? cueAt(activeShow.sequence, { main: mainIndex, sub: subIndex })
      : null;

  // EDIT × Action 編集中は、その look（step0）が編集対象。CUE 選択とは相互排他。
  const editingAction =
    editable && editingActionId
      ? (project?.actions.find((a) => a.id === editingActionId) ?? null)
      : null;
  // 編集対象の look 値（Action 優先、無ければ選択 CUE）。
  const editValues = editingAction?.steps[0]?.values ?? selectedCue?.values ?? null;
  const editChannels = new Set(Object.keys(editValues ?? {}).map(Number));

  // 編集対象が変わったとき（内容ではなく識別子）にフェーダー位置をその look へ同期する。
  useEffect(() => {
    syncFadersToCue(editValues);
    // editValues の中身は依存に入れない（編集中の再同期で値が飛ぶのを防ぐ）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCue?.id, editingActionId, mainIndex, subIndex, editable, activeShowId]);

  const start = bank * FADERS_PER_BANK;
  const channels = Array.from({ length: FADERS_PER_BANK }, (_, i) => start + i);
  const buskingCount = busking.reduce((n, b) => (b ? n + 1 : n), 0);
  // Show 未読込（解放中）は busking/release の概念を持たず、フェーダーが 1:1 で直接出力。
  const released = activeShowId === null;
  // busking は SHOW モードのみ（EDIT は CUE オーサリング）。
  const showBusking = !released && !editable;

  // 折りたたみ時はスリムバーのみ（高さは App 側で解放）。
  if (collapsed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-1.5 ring-1 ring-neutral-800">
        <button
          onClick={toggleCollapsed}
          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-neutral-200 hover:bg-neutral-700"
          title="フェーダーを展開"
        >
          <ChevronRight size={13} /> フェーダー
        </button>
        {released ? (
          <span className="text-[11px] text-neutral-500">直接出力（Show 未読込）</span>
        ) : showBusking ? (
          <span className="text-[11px] text-neutral-400">
            busking: <span className="font-mono text-purple-300">{buskingCount}</span> ch
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <PickerButton />
          {showBusking && (
            <button
              onClick={releaseAll}
              disabled={buskingCount === 0}
              className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
              title="busking を全解除（値を 0 に戻す）"
            >
              RELEASE 全
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* バンク切替タブ + プログラマー状態 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <button
          onClick={toggleCollapsed}
          className="inline-flex items-center rounded bg-neutral-800 px-2 py-1 text-neutral-200 hover:bg-neutral-700"
          title="フェーダーを折りたたむ"
        >
          <ChevronDown size={14} />
        </button>
        {Array.from({ length: BANK_COUNT }, (_, b) => {
          const from = b * FADERS_PER_BANK + 1;
          const to = (b + 1) * FADERS_PER_BANK;
          const active = b === bank;
          const name = bankLabels?.[b];
          const hasBusking =
            showBusking &&
            busking.slice(b * FADERS_PER_BANK, (b + 1) * FADERS_PER_BANK).some(Boolean);
          return (
            <button
              key={b}
              onClick={() => setBank(b)}
              className={`relative max-w-[8rem] truncate rounded px-2 py-1 text-[11px] font-mono transition-colors ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
              title={name ? `${name}（CH ${from}–${to}）` : `CH ${from}–${to}`}
            >
              {name ?? `${from}-${to}`}
              {hasBusking && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-purple-400" />
              )}
            </button>
          );
        })}

        {editable && (
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            <span>ページ名:</span>
            <InlineText
              value={bankLabels?.[bank] ?? ''}
              placeholder="（無名）"
              editable
              onCommit={(v) => window.dmx.setBankLabel(bank, v)}
              className="min-w-[6rem] px-1 text-left text-[11px] text-neutral-200"
              title="現在のバンク(ページ)名を編集"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <PickerButton />
          {released ? (
            <span className="text-[11px] text-neutral-500">直接出力（Show 未読込）</span>
          ) : showBusking ? (
            <>
              <span className="text-[11px] text-neutral-400">
                busking: <span className="font-mono text-purple-300">{buskingCount}</span> ch
              </span>
              <button
                onClick={releaseAll}
                disabled={buskingCount === 0}
                className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
                title="busking を全解除（値を 0 に戻す）"
              >
                RELEASE 全
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* フェーダー列 */}
      <div className="flex min-h-0 flex-1 gap-1 overflow-x-auto rounded-lg bg-neutral-900/60 p-3 ring-1 ring-neutral-800">
        {channels.map((ch) => {
          const inEditTarget = editChannels.has(ch);
          return (
            <Fader
              key={ch}
              ch={ch}
              value={faders[ch]}
              output={output[ch]}
              busking={showBusking && busking[ch]}
              inSelectedCue={inEditTarget}
              released={released}
              label={channelLabels?.[ch]}
              editable={editable}
              onChange={(v) => setFader(ch, v)}
              onClear={
                editingAction
                  ? () => setFader(ch, 0) // Action look から ch を外す（0 で除外）
                  : inEditTarget && selectedCue
                    ? () => deleteCueChannel(selectedCue.id, ch)
                    : () => releaseChannel(ch)
              }
              onLabelChange={(label) => window.dmx.setChannelLabel(ch, label)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** RGB カラーピッカーを別ウィンドウで開くボタン。 */
function PickerButton() {
  return (
    <button
      onClick={() => window.dmx.openColorPicker()}
      className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700"
      title="RGB カラーピッカーを別ウィンドウで開く"
    >
      <Palette size={13} /> RGB ピッカー
    </button>
  );
}
