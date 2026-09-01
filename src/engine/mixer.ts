/**
 * 合成・優先モデル（§6）のコア。
 *
 * 毎フレーム ch=0..511 について優先スタックで出力を決定する:
 *   1. busking 層       … busking[ch]（SHOW モードのライブ上書き）なら out = faderLive[ch]
 *                         （HTP 無視・下げれば下がる）
 *   2. show 層          … アクティブ Show が GO 済みで制御する ch（footprint 内）は tracked[ch]
 *   3. フェーダー基準層  … どの CUE も制御しない ch / show 未読込時は faderLive[ch]
 *
 * Action は look を programmer（faderLive / busking）へ取り込む方式（§5.6）のため、
 * 専用のオーバーライド層は持たない。単一プレイヘッドで並列再生も無いので、
 * 複数ソース間の HTP（最大値）計算は不要（show 層は単一ソース）。
 */

import { UNIVERSE_SIZE, type EngineRuntime } from '../shared/types';

/** 合成に必要な入力を抽象化したビュー。 */
export interface MixContext {
  faderLive: number[];
  busking: boolean[];
  /** show 層がこの ch を制御しているか（未指定は「制御なし」＝show 未読込/未 GO）。 */
  showControls?: (ch: number) => boolean;
  /** show 層の現在表示値（tracked）。showControls が true の ch で使う。 */
  showValue?: (ch: number) => number;
}

/** 単一 ch の出力値を優先スタックに従って決定する（§6 擬似コードに対応）。 */
export function resolveChannel(ctx: MixContext, ch: number): number {
  // 1. busking 層（SHOW モードのライブ上書き・HTP 無視・下げれば下がる）
  if (ctx.busking[ch]) {
    return ctx.faderLive[ch];
  }
  // 2. show 層
  if (ctx.showControls?.(ch)) {
    return ctx.showValue ? ctx.showValue(ch) : 0;
  }
  // 3. 未制御 ch / show 未読込
  return ctx.faderLive[ch];
}

/**
 * 512ch 全体を合成して `out` バッファへ書き込む。
 * 割り当てを避けるため呼び出し側のバッファを再利用する。
 */
export function resolveFrame(ctx: MixContext, out: number[]): void {
  for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
    out[ch] = resolveChannel(ctx, ch);
  }
}

/**
 * EngineRuntime から MixContext を組み立てる。層2（show）を `rt.show` から構築。
 * 「show 制御中」= Show が GO 済み（mainIndex >= 0）かつ `controlled[ch]`。
 */
export function contextFromRuntime(rt: EngineRuntime): MixContext {
  const show = rt.show;
  const active = show !== null && show.mainIndex >= 0;

  const showControls = active
    ? (ch: number): boolean => show!.controlled[ch]
    : undefined;

  const showValue = active
    ? (ch: number): number => show!.tracked[ch]
    : undefined;

  return {
    faderLive: rt.faderLive,
    busking: rt.busking,
    showControls,
    showValue,
  };
}
