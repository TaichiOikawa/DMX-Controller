/**
 * 環境設定モーダル。
 * Art-Net 送信設定（§7 ProjectSettings.artnet）: 送信先 IP / universe / net / subnet /
 * リフレッシュレート、実測 Hz を表示・編集する。`prefsOpen` で表示制御。
 */

import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useDmxStore } from '../store';
import { UNIVERSE_SIZE, type ArtnetSettings, type RgbFixture } from '../../shared/types';
import type { RemoteInfo } from '../../shared/ipc';
import { InlineText } from './InlineText';

export function PreferencesModal() {
  const open = useDmxStore((s) => s.prefsOpen);
  const setOpen = useDmxStore((s) => s.setPrefsOpen);
  const artnet = useDmxStore((s) => s.artnet);
  const setArtnet = useDmxStore((s) => s.setArtnet);
  const measuredHz = useDmxStore((s) => s.measuredHz);
  const fixtures = useDmxStore((s) => s.project?.fixtures) ?? [];
  const editable = useDmxStore((s) => s.mode === 'edit');

  const patch = (p: Partial<ArtnetSettings>) => setArtnet({ ...artnet, ...p });

  const addFixture = () => {
    // 既存数 ×3 を基準に連続 3ch を初期割り当て（末尾近くは 0 起点へクランプ）。
    const base = Math.min(fixtures.length * 3, UNIVERSE_SIZE - 3);
    window.dmx.addFixture({ r: base, g: base + 1, b: base + 2 });
  };

  // Esc で閉じる（モーダル表示中のみ）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="max-h-[88vh] w-[32rem] max-w-[90vw] overflow-y-auto rounded-xl bg-neutral-900 p-5 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-sky-400">環境設定</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
        </div>

        {/* Art-Net セクション */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Art-Net</h3>

          <Field label="送信先 IP">
            <input
              value={artnet.targetIp}
              onChange={(e) => patch({ targetIp: e.target.value })}
              className="w-40 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <NumField label="Universe" value={artnet.universe} min={0} max={15} onChange={(v) => patch({ universe: v })} />
            <NumField label="Net" value={artnet.net} min={0} max={127} onChange={(v) => patch({ net: v })} />
            <NumField label="Subnet" value={artnet.subnet} min={0} max={15} onChange={(v) => patch({ subnet: v })} />
            <NumField label="Rate Hz" value={artnet.refreshRateHz} min={1} max={60} onChange={(v) => patch({ refreshRateHz: v })} />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">実測</span>
            <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-emerald-400">{measuredHz} Hz</span>
          </div>
        </section>

        {/* RGB フィクスチャ セクション */}
        <section className="mt-5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              RGB フィクスチャ
            </h3>
            <button
              onClick={addFixture}
              disabled={!editable}
              className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
              title="任意の R/G/B 3ch を 1 フィクスチャとして追加"
            >
              <Plus size={12} /> 追加
            </button>
          </div>

          {!editable && (
            <p className="text-[10px] text-neutral-500">EDIT モードで編集できます。</p>
          )}

          {fixtures.length === 0 ? (
            <p className="text-[11px] text-neutral-600">フィクスチャ未登録（「追加」で作成）。</p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
              {fixtures.map((fx) => (
                <FixtureRow key={fx.id} fixture={fx} editable={editable} />
              ))}
            </div>
          )}
          <p className="text-[10px] text-neutral-600">
            ch は 1–{UNIVERSE_SIZE} で指定。色はフェーダー上部のバーから選べます。
          </p>
        </section>

        {/* リモート操作 セクション */}
        <RemoteSection open={open} />
      </div>
    </div>
  );
}

/**
 * リモート操作（スマホ等）セクション。
 * 有効/無効トグルと、有効時の接続 URL・PIN・QR コードを表示する。
 */
function RemoteSection({ open }: { open: boolean }) {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string>('');

  // モーダルを開いたら現在の接続情報を取得する。
  useEffect(() => {
    if (!open) return;
    void window.dmx.getRemoteInfo().then(setInfo);
  }, [open]);

  // 有効かつ URL があれば先頭 URL の QR を生成する（QR は enabled ブロック内でのみ描画するため、
  // 無効化時に消去しなくても表示されない）。
  useEffect(() => {
    const url = info?.enabled ? info.urls[0] : undefined;
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 176 })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [info]);

  const toggle = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      setInfo(await window.dmx.setRemoteEnabled(!info.enabled));
    } catch {
      // 失敗時は現状の接続情報に戻す。
      setInfo(await window.dmx.getRemoteInfo());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          リモート操作（スマホ）
        </h3>
        <button
          onClick={toggle}
          disabled={!info || busy}
          className={`rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40 ${
            info?.enabled
              ? 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'
              : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
          }`}
        >
          {info?.enabled ? '有効' : '無効'}
        </button>
      </div>

      {info?.enabled ? (
        info.urls.length === 0 ? (
          <p className="text-[11px] text-amber-400">
            ネットワーク接続が見つかりません。Wi-Fi/LAN に接続してください。
          </p>
        ) : (
          <div className="flex gap-4">
            {qr && (
              <img
                src={qr}
                alt="接続 QR コード"
                className="h-[88px] w-[88px] shrink-0 rounded bg-white p-1"
              />
            )}
            <div className="min-w-0 flex-1 space-y-2 text-xs">
              <div>
                <span className="text-neutral-500">接続 URL</span>
                <div className="mt-1 space-y-1">
                  {info.urls.map((u) => (
                    <div
                      key={u}
                      className="truncate rounded bg-neutral-800 px-2 py-1 font-mono text-sky-300"
                    >
                      {u}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-neutral-500">PIN</span>
                <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-lg tracking-widest text-emerald-400">
                  {info.pin}
                </span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Action 専用ページ:{' '}
                <span className="font-mono text-sky-300">{info.urls[0]}/actions</span>
              </div>
            </div>
          </div>
        )
      ) : (
        <p className="text-[11px] text-neutral-600">
          有効にすると、同じ Wi-Fi のスマホから GO / ブラックアウト等を操作できます。
        </p>
      )}
      <p className="text-[10px] text-neutral-600">
        信頼できる LAN 内でのみ使用してください（平文通信・簡易 PIN 認証）。
      </p>
    </section>
  );
}

/** フィクスチャ 1 行: 名前 + R/G/B ch + 削除。 */
function FixtureRow({ fixture, editable }: { fixture: RgbFixture; editable: boolean }) {
  const update = (p: { name?: string; r?: number; g?: number; b?: number }) =>
    window.dmx.updateFixture(fixture.id, p);
  return (
    <div className="flex items-center gap-2 rounded bg-neutral-800/60 px-2 py-1.5 ring-1 ring-neutral-700">
      <InlineText
        value={fixture.name ?? ''}
        placeholder="＋名前"
        editable={editable}
        onCommit={(v) => update({ name: v })}
        className="min-w-[5rem] flex-1 truncate px-1 text-left text-xs text-neutral-200"
        title="フィクスチャ名を編集"
      />
      <ChField label="R" ch={fixture.r} editable={editable} onCommit={(r) => update({ r })} />
      <ChField label="G" ch={fixture.g} editable={editable} onCommit={(g) => update({ g })} />
      <ChField label="B" ch={fixture.b} editable={editable} onCommit={(b) => update({ b })} />
      <button
        onClick={() => window.dmx.deleteFixture(fixture.id)}
        disabled={!editable}
        className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-red-900/50 hover:text-red-300 disabled:opacity-40"
        title="フィクスチャを削除"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/**
 * ch 入力（表示 1-512 / 内部 0-511）。
 * ローカル下書きで編集し、Enter / blur で確定（IPC 往復との競合を避ける）。
 */
function ChField({
  label,
  ch,
  editable,
  onCommit,
}: {
  label: string;
  ch: number;
  editable: boolean;
  onCommit: (ch0: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(ch + 1);
  const commit = () => {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    if (Number.isFinite(n)) onCommit(Math.max(1, Math.min(UNIVERSE_SIZE, n)) - 1);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-0.5 text-[10px] text-neutral-500">
      <span className="font-semibold">{label}</span>
      <input
        type="number"
        min={1}
        max={UNIVERSE_SIZE}
        value={shown}
        disabled={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="w-12 rounded bg-neutral-900 px-1 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
      />
    </label>
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
