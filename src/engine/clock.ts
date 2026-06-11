/**
 * ドリフト補正付きの一定レート tick ループ（§3）。
 *
 * `setInterval` は実行遅延が累積してドリフトするため、毎回「次に起きるべき
 * 絶対時刻」を基準に `setTimeout` の待ち時間を再計算する方式を採る。
 * これにより長時間でも平均レートが目標値に保たれる。
 *
 * Electron / Node 双方で動く。タイマー API はコンストラクタ引数で差し替え可能に
 * しており、テストでフェイクタイマーを注入できる。
 */

export interface ClockOptions {
  /** 目標レート（Hz）。例: 40 → 25ms 間隔。 */
  hz: number;
  /** 毎ティック呼ばれるコールバック。引数は現在時刻（ms）。 */
  onTick: (nowMs: number) => void;
  /** テスト用に差し替え可能なタイマー（既定は global）。 */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  /** テスト用に差し替え可能な時刻取得（既定は Date.now）。 */
  nowFn?: () => number;
}

export class Clock {
  private readonly intervalMs: number;
  private readonly onTick: (nowMs: number) => void;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly nowFn: () => number;

  private handle: ReturnType<typeof setTimeout> | null = null;
  /** 次に発火すべき絶対時刻（ms）。 */
  private nextAt = 0;
  private running = false;

  constructor(opts: ClockOptions) {
    this.intervalMs = 1000 / opts.hz;
    this.onTick = opts.onTick;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));
    this.nowFn = opts.nowFn ?? (() => Date.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextAt = this.nowFn() + this.intervalMs;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      this.clearTimeoutFn(this.handle);
      this.handle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private schedule(): void {
    const delay = Math.max(0, this.nextAt - this.nowFn());
    this.handle = this.setTimeoutFn(() => this.fire(), delay);
  }

  private fire(): void {
    if (!this.running) return;
    const now = this.nowFn();
    this.onTick(now);

    // 次の目標時刻を進める。大きく遅延した場合（スリープ復帰等）は
    // 過去ティックを取り戻そうとして暴走しないよう、現在時刻基準に追従させる。
    this.nextAt += this.intervalMs;
    if (this.nextAt < now) {
      this.nextAt = now + this.intervalMs;
    }
    this.schedule();
  }
}
