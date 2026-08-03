/**
 * OpenDMX（Enttec Open DMX USB 等の FTDI ベース I/F）への送出ドライバ。
 *
 * この種の I/F はマイコンを持たず、DMX の物理フレームをホストが全部作る:
 *
 *   BREAK(>=92us) → MAB(>=12us) → スタートコード(0x00) → 512ch
 *
 * を 250kbps / 8bit / パリティなし / ストップ 2bit のシリアルで流す。
 * BREAK は `port.set({ brk: true })` のトグルで作る。Node のタイマー粒度では
 * µs 単位の待ちは作れないが、BREAK/MAB は「最小長」の規定なので長い分には問題ない。
 *
 * Engine のクロック（既定 40Hz）と実際の送出レートは切り離してある。
 * 250kbps では 1 フレームに約 23ms かかるため、Engine が速く回しても送出は
 * 追いつかない。そこで setFrame() は最新フレームを上書きするだけにし、
 * 送出ループは常に「最新の 1 枚」を出す（積み残しを作らない）。
 *
 * serialport はネイティブモジュールなのでバンドルせず、動的 import で読み込む。
 * 読み込みに失敗しても Art-Net 出力は動き続けるよう、例外は status に落とす。
 */

import { UNIVERSE_SIZE } from '../shared/types';
import type { OpenDmxStatus, SerialPortInfo } from '../shared/ipc';

/** DMX のボーレート（250kbps 固定）。 */
const BAUD_RATE = 250_000;
/** スタートコード(0x00) + 512ch。 */
const FRAME_SIZE = 1 + UNIVERSE_SIZE;
/** BREAK の保持時間（ms）。規格の最小 92µs に対し十分長い。 */
const BREAK_MS = 1;
/** MAB(Mark After Break) の保持時間（ms）。規格の最小 12µs。 */
const MAB_MS = 1;
/**
 * 送出間隔の下限（ms）。
 * 513 バイト × 11 bit / 250000 bps ≒ 22.6ms + BREAK/MAB。約 40Hz が物理的な上限。
 */
const MIN_FRAME_INTERVAL_MS = 25;
/** オープン失敗・切断後に再接続を試みる間隔（ms）。本番中の抜き差しを想定。 */
const RECONNECT_INTERVAL_MS = 2000;
/** FTDI のベンダー ID。OpenDMX I/F の判別に使う。 */
const FTDI_VENDOR_ID = '0403';

/** serialport の SerialPort（型のみ。実体は動的 import）。 */
type SerialPortClass = typeof import('serialport').SerialPort;

/**
 * ドライバが実際に使うポート操作だけを表す最小インターフェース。
 * 実体は serialport の SerialPort だが、この形に絞ることでテストから差し替えられる。
 */
export interface DmxSerialPort {
  readonly isOpen: boolean;
  /** BREAK 等の制御線を操作する。 */
  set(options: { brk: boolean }, callback: (err: Error | null) => void): void;
  write(data: Buffer, callback: (err?: Error | null) => void): void;
  /** OS の送信バッファが空になるまで待つ。 */
  drain(callback: (err?: Error | null) => void): void;
  close(callback?: (err?: Error | null) => void): void;
  on(event: 'error' | 'close', listener: (err?: Error) => void): void;
  removeAllListeners(): void;
}

/** ポートを開いて返す関数。既定は serialport を使う実装（テストで差し替え可）。 */
export type DmxSerialPortFactory = (portPath: string) => Promise<DmxSerialPort>;

let cachedSerialPort: SerialPortClass | null = null;

/**
 * serialport を遅延ロードする。
 * ネイティブモジュールのためバンドル対象外（vite.config.ts の external 指定）。
 */
async function loadSerialPort(): Promise<SerialPortClass> {
  if (cachedSerialPort) return cachedSerialPort;
  const mod = await import('serialport');
  // CJS を ESM から読むため、名前付き / default の両方を見る。
  const ctor =
    mod.SerialPort ?? (mod as unknown as { default?: { SerialPort?: SerialPortClass } }).default?.SerialPort;
  if (!ctor) throw new Error('serialport モジュールに SerialPort が見つかりません。');
  cachedSerialPort = ctor;
  return ctor;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 512ch の値を DMX パケット（スタートコード + 512ch）へ書き込む。
 *
 * `out` は長さ FRAME_SIZE の Buffer。out[0] にはスタートコード 0x00 を入れる。
 * 値は 0-255 に丸め、小数は切り捨てる（Art-Net 側の clampDmx と同じ扱い）。
 */
export function writeDmxFrame(channels: readonly number[], out: Buffer): Buffer {
  out[0] = 0x00; // Null Start Code（通常の調光データ）
  for (let i = 0; i < UNIVERSE_SIZE; i++) {
    const v = channels[i];
    if (!Number.isFinite(v) || (v as number) <= 0) out[i + 1] = 0;
    else if ((v as number) >= 255) out[i + 1] = 255;
    else out[i + 1] = Math.floor(v as number);
  }
  return out;
}

/** 送出フレーム用の Buffer を確保する（スタートコード + 512ch）。 */
export function allocDmxFrame(): Buffer {
  return Buffer.alloc(FRAME_SIZE);
}

/** シリアルポートを列挙する（OpenDMX らしいポートを先頭に並べる）。 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const SerialPort = await loadSerialPort();
  const ports = await SerialPort.list();
  const infos: SerialPortInfo[] = ports.map((p) => {
    const vendorId = p.vendorId?.toLowerCase();
    const manufacturer = p.manufacturer ?? undefined;
    return {
      path: p.path,
      // friendlyName は Windows のみ返る。型に無いので存在確認して拾う。
      friendlyName: (p as { friendlyName?: string }).friendlyName,
      manufacturer,
      vendorId: p.vendorId,
      productId: p.productId,
      likelyDmx:
        vendorId === FTDI_VENDOR_ID || /ftdi/i.test(manufacturer ?? ''),
    };
  });
  // FTDI 製を先に、その中はパス順。選択ミスを減らすための並べ替えのみ。
  return infos.sort((a, b) => {
    if (a.likelyDmx !== b.likelyDmx) return a.likelyDmx ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

/**
 * DMX の物理設定でポートを開く既定の実装。
 * 250kbps / 8bit / パリティなし / ストップ 2bit、フロー制御なし。
 */
const defaultPortFactory: DmxSerialPortFactory = async (portPath) => {
  const SerialPort = await loadSerialPort();
  return new Promise<DmxSerialPort>((resolve, reject) => {
    const port = new SerialPort(
      {
        path: portPath,
        baudRate: BAUD_RATE,
        dataBits: 8,
        stopBits: 2,
        parity: 'none',
        // OpenDMX は送信専用。フロー制御は使わない。
        rtscts: false,
        xon: false,
        xoff: false,
      },
      (err) => (err ? reject(err) : resolve(port as unknown as DmxSerialPort)),
    );
  });
};

export interface OpenDmxDriverOptions {
  /** 接続状態が変化したときの通知先（UI へ中継される）。 */
  onStatus: (status: OpenDmxStatus) => void;
  /** ポートの開き方を差し替える（テスト用。既定は serialport）。 */
  openPort?: DmxSerialPortFactory;
}

export class OpenDmxDriver {
  private readonly onStatus: (status: OpenDmxStatus) => void;
  private readonly openPort: DmxSerialPortFactory;

  private port: DmxSerialPort | null = null;

  /** Engine から受け取る最新フレーム。送出ループが読む直前にコピーする。 */
  private readonly pending = allocDmxFrame();
  /** 実際に write するフレーム。write 中に pending が書き換わっても壊れないよう分ける。 */
  private readonly outgoing = allocDmxFrame();

  /** 望ましい状態（設定由来）。 */
  private enabled = false;
  private portPath = '';

  /** 送出ループが動作中か（多重起動防止）。 */
  private looping = false;
  /** 再接続待ちのタイマー。 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 破棄済みか（stop 後の再接続を止める）。 */
  private disposed = false;

  /** 直近 1 秒の送出時刻（実測レート算出用）。 */
  private sentTimestamps: number[] = [];

  private status: OpenDmxStatus = { state: 'disabled', portPath: null, measuredHz: 0 };

  constructor(opts: OpenDmxDriverOptions) {
    this.onStatus = opts.onStatus;
    this.openPort = opts.openPort ?? defaultPortFactory;
  }

  getStatus(): OpenDmxStatus {
    return { ...this.status };
  }

  /**
   * Engine の毎 tick から呼ばれる。最新フレームを控えるだけで I/O はしない。
   * 渡された配列は呼び出し元が使い回すため、ここでコピーする。
   */
  setFrame(channels: readonly number[]): void {
    writeDmxFrame(channels, this.pending);
  }

  /**
   * 設定を反映する。有効化／ポート変更なら開き直し、無効化なら閉じる。
   * 実際のオープンは非同期に進み、結果は status で通知する。
   */
  apply(settings: { enabled: boolean; portPath: string }): void {
    const enabled = !!settings.enabled;
    const portPath = settings.portPath ?? '';
    if (enabled === this.enabled && portPath === this.portPath) return;
    this.enabled = enabled;
    this.portPath = portPath;
    this.clearReconnect();

    if (!enabled) {
      void this.closePort();
      this.setStatus({ state: 'disabled', portPath: null, measuredHz: 0 });
      return;
    }
    if (!portPath) {
      void this.closePort();
      this.setStatus({ state: 'closed', portPath: null, measuredHz: 0 });
      return;
    }
    void this.reopen();
  }

  /** 終了時に呼ぶ。以降の再接続は行わない。 */
  async stop(): Promise<void> {
    this.disposed = true;
    this.enabled = false;
    this.clearReconnect();
    await this.closePort();
  }

  // ===== 接続管理 =====

  private async reopen(): Promise<void> {
    await this.closePort();
    if (this.disposed || !this.enabled || !this.portPath) return;

    const target = this.portPath;
    this.setStatus({ state: 'opening', portPath: target, measuredHz: 0 });

    let port: DmxSerialPort;
    try {
      port = await this.openPort(target);
    } catch (e) {
      this.failAndScheduleReconnect(target, `ポートを開けませんでした: ${errorMessage(e)}`);
      return;
    }

    // オープン完了までに設定が変わっていたら、開いたポートは捨てる。
    if (this.disposed || !this.enabled || this.portPath !== target) {
      port.close(() => {});
      return;
    }

    this.port = port;
    // 抜線・ドライバ側エラーはここに来る。閉じて再接続待ちへ。
    port.on('error', (err) => {
      if (this.port !== port) return;
      this.failAndScheduleReconnect(target, `送出エラー: ${errorMessage(err)}`);
    });
    port.on('close', () => {
      if (this.port !== port) return;
      this.failAndScheduleReconnect(target, 'ポートが切断されました。');
    });

    this.sentTimestamps = [];
    this.setStatus({ state: 'open', portPath: target, measuredHz: 0 });
    void this.runLoop(port);
  }

  private async closePort(): Promise<void> {
    const port = this.port;
    this.port = null;
    this.looping = false;
    this.sentTimestamps = [];
    if (!port) return;
    // close ハンドラの再接続を誘発させないよう、先に this.port を外してある。
    port.removeAllListeners();
    if (!port.isOpen) return;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }

  /** 失敗を status に反映し、有効なままなら一定間隔で再接続を試みる。 */
  private failAndScheduleReconnect(portPath: string, message: string): void {
    void this.closePort();
    this.setStatus({ state: 'error', portPath, error: message, measuredHz: 0 });
    if (this.disposed || !this.enabled) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reopen();
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // ===== 送出ループ =====

  /**
   * 開いているポートへ最新フレームを送り続ける。
   * 1 フレームの所要時間が送出間隔より長ければそのまま次へ進む（追いつこうとしない）。
   */
  private async runLoop(port: DmxSerialPort): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (!this.disposed && this.enabled && this.port === port && port.isOpen) {
        const startedAt = Date.now();
        try {
          await this.writeFrame(port);
        } catch (e) {
          if (this.port === port) {
            this.failAndScheduleReconnect(this.portPath, `送出エラー: ${errorMessage(e)}`);
          }
          return;
        }
        this.recordSent(startedAt);
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_FRAME_INTERVAL_MS) await delay(MIN_FRAME_INTERVAL_MS - elapsed);
      }
    } finally {
      if (this.port === port) this.looping = false;
    }
  }

  /** BREAK → MAB → スタートコード + 512ch を 1 回送る。 */
  private async writeFrame(port: DmxSerialPort): Promise<void> {
    // write 中に setFrame が来ても混ざらないよう、送る内容をここで固定する。
    this.pending.copy(this.outgoing);

    await setBreak(port, true);
    await delay(BREAK_MS);
    await setBreak(port, false);
    await delay(MAB_MS);
    await write(port, this.outgoing);
    await drain(port);
  }

  /**
   * 実測レート（直近 1 秒の送出回数）を更新する。
   *
   * 毎秒何度も変わる値なので onStatus では通知しない。getStatus() を
   * 定期的に読む側（engineHost の 250ms 周期）に拾わせる。
   */
  private recordSent(at: number): void {
    this.sentTimestamps.push(at);
    const cutoff = at - 1000;
    while (this.sentTimestamps.length > 0 && this.sentTimestamps[0] < cutoff) {
      this.sentTimestamps.shift();
    }
    this.status = { ...this.status, measuredHz: this.sentTimestamps.length };
  }

  /** 接続状態の遷移（接続/切断/エラー）を記録し、即時に通知する。 */
  private setStatus(next: OpenDmxStatus): void {
    this.status = next;
    this.onStatus({ ...next });
  }
}

// ===== serialport のコールバック API を Promise 化する薄いラッパ =====

function setBreak(port: DmxSerialPort, on: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    port.set({ brk: on }, (err) => (err ? reject(err) : resolve()));
  });
}

function write(port: DmxSerialPort, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

function drain(port: DmxSerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    port.drain((err) => (err ? reject(err) : resolve()));
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
