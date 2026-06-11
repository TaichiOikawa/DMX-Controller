/**
 * フェーダーバンク（§5.1）。512ch を 32 本ずつ 16 ページに分けて表示し、
 * ページ切替タブでバンクを移動する。
 */

import { Fader } from './Fader';
import { BANK_COUNT, FADERS_PER_BANK, useDmxStore } from '../store';

export function FaderBank() {
  const bank = useDmxStore((s) => s.bank);
  const setBank = useDmxStore((s) => s.setBank);
  const faders = useDmxStore((s) => s.faders);
  const output = useDmxStore((s) => s.output);
  const setFader = useDmxStore((s) => s.setFader);

  const start = bank * FADERS_PER_BANK;
  const channels = Array.from({ length: FADERS_PER_BANK }, (_, i) => start + i);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* バンク切替タブ */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: BANK_COUNT }, (_, b) => {
          const from = b * FADERS_PER_BANK + 1;
          const to = (b + 1) * FADERS_PER_BANK;
          const active = b === bank;
          return (
            <button
              key={b}
              onClick={() => setBank(b)}
              className={`rounded px-2 py-1 text-[11px] font-mono transition-colors ${
                active
                  ? 'bg-sky-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
              title={`CH ${from}–${to}`}
            >
              {from}-{to}
            </button>
          );
        })}
      </div>

      {/* フェーダー列 */}
      <div className="flex flex-1 gap-1 overflow-x-auto rounded-lg bg-neutral-900/60 p-3 ring-1 ring-neutral-800">
        {channels.map((ch) => (
          <Fader
            key={ch}
            ch={ch}
            value={faders[ch]}
            output={output[ch]}
            onChange={(v) => setFader(ch, v)}
          />
        ))}
      </div>
    </div>
  );
}
