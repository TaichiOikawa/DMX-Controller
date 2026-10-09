/**
 * 設定モーダル。
 * 左のタブで分類を選び、右側で操作する。`prefsOpen` で表示制御。
 *   - 接続: Art-Net（送信先 IP / universe / net / subnet / レート・実測 Hz）と USB-DMX
 *           （有効/無効・出力先・シリアルポート・接続状態）。2 系統は独立に ON/OFF でき、
 *           同時出力もできる（どちらも既定は無効）。
 *   - フィクスチャ: RGB フィクスチャの追加・編集・削除
 *   - リモート操作: スマホ用サーバーの有効/無効と接続情報
 */

import { Cable, Lightbulb, Plus, RefreshCw, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useDmxStore } from '../store';
import {
  UNIVERSE_SIZE,
  type ArtnetSettings,
  type DmxDeviceKind,
  type RgbFixture,
} from '../../shared/types';
import type { OpenDmxStatus, RemoteInfo, SerialPortInfo } from '../../shared/ipc';
import { describeOpenDmxStatus } from '../openDmxStatus';
import { InlineText } from './InlineText';

/** 左タブの識別子。 */
type PrefsTab = 'connection' | 'fixtures' | 'remote';

const TABS: { id: PrefsTab; label: string; icon: typeof Cable }[] = [
  { id: 'connection', label: '接続', icon: Cable },
  { id: 'fixtures', label: 'フィクスチャ', icon: Lightbulb },
  { id: 'remote', label: 'リモート操作', icon: Smartphone },
];

export function PreferencesModal() {
  const open = useDmxStore((s) => s.prefsOpen);
  const setOpen = useDmxStore((s) => s.setPrefsOpen);
  // モーダルを閉じるとアンマウントされるので、開き直すと「接続」から始まる。
  const [tab, setTab] = useState<PrefsTab>('connection');

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
        className="flex h-[34rem] max-h-[88vh] w-[48rem] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-sky-400">設定</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左タブ */}
          <nav className="w-40 shrink-0 space-y-1 border-r border-neutral-800 bg-neutral-950/40 p-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs ${
                  tab === id
                    ? 'bg-neutral-800 font-semibold text-sky-300'
                    : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                }`}
              >
                <Icon size={13} className="shrink-0" />
                {label}
              </button>
            ))}
          </nav>

          {/* 右ペイン（選択中のタブの内容） */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {tab === 'connection' && <ConnectionTab open={open} />}
            {tab === 'fixtures' && <FixturesTab />}
            {tab === 'remote' && <RemoteSection open={open} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 接続タブ: Art-Net と USB-DMX（どちらも独立に ON/OFF・既定は無効）。 */
function ConnectionTab({ open }: { open: boolean }) {
  const artnet = useDmxStore((s) => s.artnet);
  const setArtnet = useDmxStore((s) => s.setArtnet);
  const measuredHz = useDmxStore((s) => s.measuredHz);

  const patch = (p: Partial<ArtnetSettings>) => setArtnet({ ...artnet, ...p });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Art-Net
          </h3>
          <EnableToggle
            enabled={artnet.enabled}
            onToggle={() => patch({ enabled: !artnet.enabled })}
            title="Art-Net(UDP) の送出を切り替える（USB-DMX とは独立）"
          />
        </div>

        <Field label="送信先 IP">
          <input
            value={artnet.targetIp}
            onChange={(e) => patch({ targetIp: e.target.value })}
            disabled={!artnet.enabled}
            className="w-40 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-40"
          />
        </Field>

        <div className="flex flex-wrap gap-4">
          <NumField label="Universe" value={artnet.universe} min={0} max={15} disabled={!artnet.enabled} onChange={(v) => patch({ universe: v })} />
          <NumField label="Net" value={artnet.net} min={0} max={127} disabled={!artnet.enabled} onChange={(v) => patch({ net: v })} />
          <NumField label="Subnet" value={artnet.subnet} min={0} max={15} disabled={!artnet.enabled} onChange={(v) => patch({ subnet: v })} />
          <NumField
            label="Rate Hz"
            value={artnet.refreshRateHz}
            min={1}
            max={60}
            onChange={(v) => patch({ refreshRateHz: v })}
            title="出力ループ全体のレート。USB-DMX の送出間隔にも効く（OpenDMX は物理上限 約 40Hz）"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">実測</span>
          <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-emerald-400">{measuredHz} Hz</span>
        </div>
      </section>

      <OpenDmxSection open={open} />
    </div>
  );
}

/**
 * USB-DMX セクション（Enttec Open DMX USB 等の FTDI I/F / Pico W の USB シリアル）。
 * 有効/無効トグル、出力先の種別、シリアルポート選択、接続状態を表示する。
 * 実際の接続・再接続は main の OpenDmxDriver が行い、ここは状態を映すだけ。
 */
function OpenDmxSection({ open }: { open: boolean }) {
  const openDmx = useDmxStore((s) => s.openDmx);
  const setOpenDmx = useDmxStore((s) => s.setOpenDmx);
  const status = useDmxStore((s) => s.openDmxStatus);

  const [ports, setPorts] = useState<SerialPortInfo[] | null>(null);
  const [listing, setListing] = useState(false);

  // 「更新」ボタン用。スピナーを出したいのでこちらは待ち状態を持つ。
  const refreshPorts = useCallback(async () => {
    setListing(true);
    try {
      setPorts(await window.dmx.listSerialPorts());
    } finally {
      setListing(false);
    }
  }, []);

  // タブを開くたびに列挙し直す（開いたまま抜き差しした場合は「更新」で拾う）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.dmx
      .listSerialPorts()
      .then((list) => {
        if (!cancelled) setPorts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 保存済みポートが今は存在しない場合でも選択は保持する（挿し直せば自動で復帰する）。
  const missing =
    !!openDmx.portPath && !!ports && !ports.some((p) => p.path === openDmx.portPath);

  return (
    <section className="space-y-3 border-t border-neutral-800 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          USB-DMX
        </h3>
        <EnableToggle
          enabled={openDmx.enabled}
          onToggle={() => setOpenDmx({ ...openDmx, enabled: !openDmx.enabled })}
          title="USB-DMX の送出を切り替える（Art-Net とは独立）"
        />
      </div>

      <Field label="出力先" title="Pico W は Art-Net と併用しないこと（後から来た方が勝つ）">
        <select
          value={openDmx.kind}
          onChange={(e) => setOpenDmx({ ...openDmx, kind: e.target.value as DmxDeviceKind })}
          className="w-56 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
        >
          <option value="opendmx">Open DMX USB（FTDI）</option>
          <option value="pico">Pico W（USB シリアル）</option>
        </select>
      </Field>

      <div className="flex items-center gap-2">
        <Field label="ポート">
          <select
            value={openDmx.portPath}
            onChange={(e) => {
              const portPath = e.target.value;
              // VID から種別が分かるポートを選んだら、出力先もそれに合わせる。
              const hint = ports?.find((p) => p.path === portPath)?.kindHint;
              setOpenDmx({ ...openDmx, portPath, kind: hint ?? openDmx.kind });
            }}
            className="w-56 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">（未選択）</option>
            {/* 保存済みのポートが現在見つからなくても、選択肢としては残す。 */}
            {missing && <option value={openDmx.portPath}>{openDmx.portPath}（未接続）</option>}
            {ports?.map((p) => (
              <option key={p.path} value={p.path}>
                {p.likelyDmx ? '★ ' : ''}
                {p.path}
                {p.friendlyName ? ` — ${p.friendlyName}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <button
          onClick={() => void refreshPorts()}
          disabled={listing}
          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
          title="接続されているシリアルポートを再検索"
        >
          <RefreshCw size={12} className={listing ? 'animate-spin' : undefined} /> 更新
        </button>
      </div>

      <OpenDmxStatusLine status={status} />

      {ports?.length === 0 && (
        <p className="text-[11px] text-amber-400">
          シリアルポートが見つかりません。機器を接続し、Open DMX USB なら FTDI ドライバが
          入っているか確認してください（Pico W はドライバ不要）。
        </p>
      )}

      <p className="text-[10px] text-neutral-600">
        ★ は FTDI 製 / Raspberry Pi 製（DMX I/F の可能性が高いポート）。選ぶと出力先も自動で合わせます。
        抜線しても自動で再接続を試みます。
      </p>
    </section>
  );
}

/** OpenDMX の接続状態を 1 行で表示する。 */
function OpenDmxStatusLine({ status }: { status: OpenDmxStatus }) {
  const [label, tone] = describeOpenDmxStatus(status);
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="shrink-0 pt-0.5 text-neutral-500">状態</span>
      <span className={`rounded bg-neutral-800 px-2 py-0.5 font-mono ${tone}`}>{label}</span>
    </div>
  );
}

/** セクション見出し横の有効/無効トグル（リモート操作セクションと同じ見た目）。 */
function EnableToggle({
  enabled,
  onToggle,
  title,
}: {
  enabled: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title}
      className={`rounded px-3 py-1 text-[11px] font-semibold ${
        enabled
          ? 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'
          : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
      }`}
    >
      {enabled ? '有効' : '無効'}
    </button>
  );
}

/** フィクスチャタブ: RGB フィクスチャの一覧と追加。 */
function FixturesTab() {
  const fixtures = useDmxStore((s) => s.project?.fixtures) ?? [];
  const editable = useDmxStore((s) => s.mode === 'edit');

  const addFixture = () => {
    // 既存数 ×3 を基準に連続 3ch を初期割り当て（末尾近くは 0 起点へクランプ）。
    const base = Math.min(fixtures.length * 3, UNIVERSE_SIZE - 3);
    window.dmx.addFixture({ r: base, g: base + 1, b: base + 2 });
  };

  return (
    <section className="space-y-2">
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

      {!editable && <p className="text-[10px] text-neutral-500">EDIT モードで編集できます。</p>}

      {fixtures.length === 0 ? (
        <p className="text-[11px] text-neutral-600">フィクスチャ未登録（「追加」で作成）。</p>
      ) : (
        <div className="space-y-1">
          {fixtures.map((fx) => (
            <FixtureRow key={fx.id} fixture={fx} editable={editable} />
          ))}
        </div>
      )}
      <p className="text-[10px] text-neutral-600">
        ch は 1–{UNIVERSE_SIZE} で指定。色はフェーダー上部のバーから選べます。
      </p>
    </section>
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

  // タブを開いたら現在の接続情報を取得する。
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
    <section className="space-y-3">
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
              <div className="text-[10px] text-neutral-500">
                3D プレビュー専用ページ:{' '}
                <span className="font-mono text-sky-300">{info.urls[0]}/visualizer</span>
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

function Field({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-400" title={title}>
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
  disabled,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Field label={label} title={title}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.max(min, Math.min(max, Math.round(Number(e.target.value))));
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-14 rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-40"
      />
    </Field>
  );
}
