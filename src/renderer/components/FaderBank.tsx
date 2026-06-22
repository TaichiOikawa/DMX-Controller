/**
 * フェーダーバンク（§5.1）。512ch を 32 本ずつ 16 ページに分けて表示し、
 * ページ切替タブでバンクを移動する。キャプチャ中 ch（プログラマー）をハイライト。
 */

import { Fader } from './Fader';
import { InlineText } from './InlineText';
import { BANK_COUNT, FADERS_PER_BANK, useDmxStore } from '../store';

export function FaderBank() {
  const bank = useDmxStore((s) => s.bank);
  const setBank = useDmxStore((s) => s.setBank);
  const faders = useDmxStore((s) => s.faders);
  const output = useDmxStore((s) => s.output);
  const captured = useDmxStore((s) => s.captured);
  const setFader = useDmxStore((s) => s.setFader);
  const releaseChannel = useDmxStore((s) => s.releaseChannel);
  const releaseAll = useDmxStore((s) => s.releaseAll);
  const editable = useDmxStore((s) => s.mode === 'edit');
  const channelLabels = useDmxStore((s) => s.project?.channelLabels);
  const bankLabels = useDmxStore((s) => s.project?.bankLabels);

  const start = bank * FADERS_PER_BANK;
  const channels = Array.from({ length: FADERS_PER_BANK }, (_, i) => start + i);
  const capturedCount = captured.reduce((n, b) => (b ? n + 1 : n), 0);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* バンク切替タブ + プログラマー状態 */}
      <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: BANK_COUNT }, (_, b) => {
          const from = b * FADERS_PER_BANK + 1;
          const to = (b + 1) * FADERS_PER_BANK;
          const active = b === bank;
          const name = bankLabels?.[b];
          const hasCaptured = captured
            .slice(b * FADERS_PER_BANK, (b + 1) * FADERS_PER_BANK)
            .some(Boolean);
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
              {hasCaptured && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
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
          <span className="text-[11px] text-neutral-400">
            キャプチャ中: <span className="font-mono text-amber-300">{capturedCount}</span> ch
          </span>
          <button
            onClick={releaseAll}
            disabled={capturedCount === 0}
            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
            title="全キャプチャを解除（値を 0 に戻す）"
          >
            RELEASE 全
          </button>
        </div>
      </div>

      {/* フェーダー列 */}
      <div className="flex flex-1 gap-1 overflow-x-auto rounded-lg bg-neutral-900/60 p-3 ring-1 ring-neutral-800">
        {channels.map((ch) => (
          <Fader
            key={ch}
            ch={ch}
            value={faders[ch]}
            output={output[ch]}
            captured={captured[ch]}
            label={channelLabels?.[ch]}
            editable={editable}
            onChange={(v) => setFader(ch, v)}
            onClear={() => releaseChannel(ch)}
            onLabelChange={(label) => window.dmx.setChannelLabel(ch, label)}
          />
        ))}
      </div>
    </div>
  );
}
