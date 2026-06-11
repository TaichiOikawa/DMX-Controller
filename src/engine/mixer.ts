/**
 * 合成・優先モデル（§6）のコア。
 *
 * 毎フレーム ch=0..511 について優先スタックで出力を決定する:
 *   1. Action オーバーライド層 … アクティブ中は最優先で上書き
 *   2. 手動キャプチャ層        … captured[ch] なら out = faderLive[ch]（HTP 無視）
 *   3. show 層（グループ間HTP）… いずれかのグループが制御中なら max(各 tracked[ch])
 *   4. フェーダー基準層        … どの CUE も制御しない ch / show 未読込時
 *
 * 今回のマイルストーン（1〜2）では Show / グループ / Action が未実装のため、
 * 層1〜3 は常に「非アクティブ」を返し、出力は層4（faderLive）に落ちる。
 * ただし優先スタックの分岐構造はここに敷いておき、後続マイルストーンでは
 * 各層の述語（actionControls / captured / anyGroupControls）と値取得関数
 * （actionValue / htpOverGroups）を埋めるだけで済むようにする。
 */

import { UNIVERSE_SIZE, type EngineRuntime } from '../shared/types';

/**
 * 合成に必要な入力を抽象化したビュー。
 * 後続で Action / Show 層を足すときは、ここに述語・値取得を追加する。
 */
export interface MixContext {
  faderLive: number[];
  captured: boolean[];
  /** 後続実装用フック。未制御なら false / null を返す。 */
  actionControls?: (ch: number) => boolean;
  actionValue?: (ch: number) => number;
  anyGroupControls?: (ch: number) => boolean;
  htpOverGroups?: (ch: number) => number;
}

/** 単一 ch の出力値を優先スタックに従って決定する（§6 擬似コードに対応）。 */
export function resolveChannel(ctx: MixContext, ch: number): number {
  // 1. Action オーバーライド層（最優先）
  if (ctx.actionControls?.(ch)) {
    return ctx.actionValue ? ctx.actionValue(ch) : 0;
  }
  // 2. 手動キャプチャ層（HTP 無視・下げれば下がる）
  if (ctx.captured[ch]) {
    return ctx.faderLive[ch];
  }
  // 3. show 層・グループ間 HTP
  if (ctx.anyGroupControls?.(ch)) {
    return ctx.htpOverGroups ? ctx.htpOverGroups(ch) : 0;
  }
  // 4. 未制御 ch / show 未読込
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
 * EngineRuntime から MixContext を組み立てる。
 * 層3（show）を単一プレイヘッド `rt.show` から構築する。
 * 層1（Action）は後続マイルストーン6で `rt.activeActions` から組む。
 *
 * 「制御中」= Show が GO 済み（mainIndex >= 0）かつ `controlled[ch]`。
 * 並列再生が無いので HTP の最大値計算は不要（単一ソース）。
 */
export function contextFromRuntime(rt: EngineRuntime): MixContext {
  const show = rt.show;
  const active = show !== null && show.mainIndex >= 0;

  const anyGroupControls = active
    ? (ch: number): boolean => show!.controlled[ch]
    : undefined;

  const htpOverGroups = active
    ? (ch: number): number => show!.tracked[ch]
    : undefined;

  return {
    faderLive: rt.faderLive,
    captured: rt.captured,
    anyGroupControls,
    htpOverGroups,
  };
}
