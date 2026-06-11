/**
 * Art-Net 送信設定バー（§7 ProjectSettings.artnet）。
 * 送信先 IP / universe / net / subnet / リフレッシュレート、実測 Hz を表示・編集。
 */

import { useDmxStore } from '../store';
import type { ArtnetSettings } from '../../shared/types';

export function SettingsBar() {
  const artnet = useDmxStore((s) => s.artnet);
  const setArtnet = useDmxStore((s) => s.setArtnet);
  const measuredHz = useDmxStore((s) => s.measuredHz);

  const patch = (p: Partial<ArtnetSettings>) => setArtnet({ ...artnet, ...p });

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg bg-neutral-900/60 px-4 py-2 ring-1 ring-neutral-800">
      <div className="text-sm font-semibold text-sky-400">DMX Console</div>

      <Field label="送信先 IP">
        <input
          value={artnet.targetIp}
          onChange={(e) => patch({ targetIp: e.target.value })}
          className="w-32 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
        />
      </Field>

      <NumField label="Universe" value={artnet.universe} min={0} max={15} onChange={(v) => patch({ universe: v })} />
      <NumField label="Net" value={artnet.net} min={0} max={127} onChange={(v) => patch({ net: v })} />
      <NumField label="Subnet" value={artnet.subnet} min={0} max={15} onChange={(v) => patch({ subnet: v })} />
      <NumField label="Rate Hz" value={artnet.refreshRateHz} min={1} max={60} onChange={(v) => patch({ refreshRateHz: v })} />

      <div className="ml-auto flex items-center gap-2 text-xs">
        <span className="text-neutral-500">実測</span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-emerald-400">
          {measuredHz} Hz
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.max(min, Math.min(max, Math.round(Number(e.target.value))));
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-14 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
      />
    </Field>
  );
}
