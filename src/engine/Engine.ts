/**
 * 照明エンジンの中核（§3 / §8）。「単一の真実」。
 *
 * - 全状態（フェーダー・キャプチャ・将来のグループ/Action）を保持
 * - ~40Hz の tick ごとに 512ch を合成し、ArtDMX に符号化して送出
 * - 出力フレーム・状態スナップショットをリスナーへ通知
 *
 * Electron には依存しない純粋 TS。UDP 送信は `send` コールバックとして注入され、
 * タイマーは Clock 経由で差し替え可能なので、Node 単体でテストできる。
 */

import {
  UNIVERSE_SIZE,
  type ArtnetSettings,
  type EngineRuntime,
  defaultArtnetSettings,
} from '../shared/types';
import { encodeArtDmx, nextSequence } from './artnet';
import { Clock } from './clock';
import { contextFromRuntime, resolveFrame } from './mixer';
import type { EngineStateSnapshot } from '../shared/ipc';

export interface EngineOptions {
  /** 符号化済み ArtDMX パケットの送出先（UDP 等）。注入する。 */
  send: (packet: Buffer) => void;
  artnet?: ArtnetSettings;
  /** Clock に渡すタイマー差し替え（テスト用）。 */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  nowFn?: () => number;
}

type FrameListener = (frame: number[]) => void;
type StateListener = (state: EngineStateSnapshot) => void;

export class Engine {
  private readonly send: (packet: Buffer) => void;
  private readonly nowFn: () => number;
  private artnet: ArtnetSettings;
  private clock: Clock;

  private runtime: EngineRuntime;
  private sequence = 1;

  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();

  // 送出レート計測（診断用）。
  private tickTimestamps: number[] = [];
  private measuredHz = 0;

  constructor(opts: EngineOptions) {
    this.send = opts.send;
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.artnet = opts.artnet ?? defaultArtnetSettings();

    this.runtime = {
      activeShowId: null,
      groups: {},
      captured: new Array(UNIVERSE_SIZE).fill(false),
      faderLive: new Array(UNIVERSE_SIZE).fill(0),
      activeActions: [],
      output: new Array(UNIVERSE_SIZE).fill(0),
    };

    this.clock = new Clock({
      hz: this.artnet.refreshRateHz,
      onTick: (now) => this.tick(now),
      setTimeoutFn: opts.setTimeoutFn,
      clearTimeoutFn: opts.clearTimeoutFn,
      nowFn: opts.nowFn,
    });
  }

  // ===== ライフサイクル =====

  start(): void {
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
  }

  // ===== コマンド（UI → Engine） =====

  /**
   * フェーダー値を設定する。
   * Show 制御下の ch なら captured=true にする（§9）。今回は Show 未実装のため
   * キャプチャ判定の対象 ch が無く、フェーダー値の更新のみ行う。
   */
  setFader(ch: number, value: number): void {
    if (ch < 0 || ch >= UNIVERSE_SIZE) return;
    this.runtime.faderLive[ch] = clamp255(value);
    // TODO(マイルストーン6): show 制御下の ch なら this.runtime.captured[ch] = true
  }

  updateArtnetSettings(settings: ArtnetSettings): void {
    const rateChanged = settings.refreshRateHz !== this.artnet.refreshRateHz;
    this.artnet = { ...settings };
    if (rateChanged) {
      // レート変更時は Clock を作り直す。
      const wasRunning = this.clock.isRunning();
      this.clock.stop();
      this.clock = new Clock({
        hz: this.artnet.refreshRateHz,
        onTick: (now) => this.tick(now),
        nowFn: this.nowFn,
      });
      if (wasRunning) this.clock.start();
    }
  }

  // ===== 状態取得・購読 =====

  getArtnetSettings(): ArtnetSettings {
    return { ...this.artnet };
  }

  getState(): EngineStateSnapshot {
    return {
      activeShowId: this.runtime.activeShowId,
      captured: this.runtime.captured.slice(),
      artnet: { ...this.artnet },
      measuredHz: this.measuredHz,
    };
  }

  /** 直近の出力フレーム（参照ではなくコピー）。 */
  getOutput(): number[] {
    return this.runtime.output.slice();
  }

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  emitState(): void {
    const snapshot = this.getState();
    for (const cb of this.stateListeners) cb(snapshot);
  }

  // ===== 出力ループ =====

  /** 1 フレームを合成し、送出し、リスナーへ通知する。 */
  tick(now: number): void {
    const ctx = contextFromRuntime(this.runtime);
    resolveFrame(ctx, this.runtime.output);

    const packet = encodeArtDmx(this.runtime.output, this.sequence, this.artnet);
    this.sequence = nextSequence(this.sequence);
    this.send(packet);

    this.updateMeasuredHz(now);

    if (this.frameListeners.size > 0) {
      const frame = this.runtime.output;
      for (const cb of this.frameListeners) cb(frame);
    }
  }

  private updateMeasuredHz(now: number): void {
    this.tickTimestamps.push(now);
    // 直近 1 秒のティック数 = 実測 Hz。
    const cutoff = now - 1000;
    while (this.tickTimestamps.length > 0 && this.tickTimestamps[0] < cutoff) {
      this.tickTimestamps.shift();
    }
    this.measuredHz = this.tickTimestamps.length;
  }
}

function clamp255(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}
