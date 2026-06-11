/**
 * CUE 再生のコア（§5.2 / §6.3）。トラッキング・クロスフェード・
 * マスター列の順送り計算の純関数。
 *
 * 単一プレイヘッドモデル: 1本のマスター列を GO で順送りし、GROUP に入ると
 * 子 CUE を1つずつ進める。並列なし。
 *
 * Electron / Node 非依存。Engine から呼ばれ、Vitest で単体検証する。
 */

import {
  UNIVERSE_SIZE,
  type Cue,
  type SequenceEntry,
  type ShowRuntime,
} from '../shared/types';

/** マスター列内の再生位置。 */
export interface Position {
  main: number;
  sub: number;
}

/** 0..1 にクランプ。 */
export function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

/** 線形補間。 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * トラッキングのターゲットを計算する。
 * 直前ターゲットをコピーし、cue が指定する ch のみ上書きする。
 * cue が指定しない ch は直前値を維持（＝トラッキング）。
 */
export function computeTarget(prevTarget: readonly number[], cue: Cue): number[] {
  const to = prevTarget.slice();
  for (const [k, v] of Object.entries(cue.values)) {
    const ch = Number(k);
    if (ch >= 0 && ch < UNIVERSE_SIZE) to[ch] = clampValue(v);
  }
  return to;
}

/** マスター列の全 cue（GROUP の子を含む）を平坦化して返す。 */
export function flattenCues(seq: readonly SequenceEntry[]): Cue[] {
  const out: Cue[] = [];
  for (const entry of seq) {
    if (entry.kind === 'cue') out.push(entry.cue);
    else out.push(...entry.group.cues);
  }
  return out;
}

/**
 * フットプリント（cue 群の values キーの和集合）を boolean[512] で返す。
 * §6 層3 の「制御中」判定に使う。
 */
export function footprintOf(cues: readonly Cue[]): boolean[] {
  const controlled = new Array(UNIVERSE_SIZE).fill(false);
  for (const cue of cues) {
    for (const k of Object.keys(cue.values)) {
      const ch = Number(k);
      if (ch >= 0 && ch < UNIVERSE_SIZE) controlled[ch] = true;
    }
  }
  return controlled;
}

/** 指定位置の cue を取り出す（無ければ null）。 */
export function cueAt(seq: readonly SequenceEntry[], pos: Position): Cue | null {
  const entry = seq[pos.main];
  if (!entry) return null;
  if (entry.kind === 'cue') return entry.cue;
  return entry.group.cues[pos.sub] ?? null;
}

/** `from` 以降で最初に再生可能なエントリ位置（空 GROUP はスキップ）。 */
function firstPlayable(seq: readonly SequenceEntry[], from: number): Position | null {
  for (let m = from; m < seq.length; m++) {
    const e = seq[m];
    if (e.kind === 'cue') return { main: m, sub: 0 };
    if (e.kind === 'group' && e.group.cues.length > 0) return { main: m, sub: 0 };
    // 空 GROUP はスキップ
  }
  return null;
}

/**
 * GO の次位置を計算する。末尾に達したら null（no-op）。
 *   - 未開始(main<0): 最初の再生可能エントリ
 *   - GROUP 内で子が残る: sub+1
 *   - GROUP 末尾: loop なら子先頭(sub=0)、非 loop なら次のマスターエントリ
 *   - CUE: 次のマスターエントリ
 */
export function nextPosition(
  seq: readonly SequenceEntry[],
  main: number,
  sub: number,
): Position | null {
  if (main < 0) return firstPlayable(seq, 0);

  const entry = seq[main];
  if (entry?.kind === 'group') {
    const g = entry.group;
    if (sub < g.cues.length - 1) return { main, sub: sub + 1 };
    if (g.loop && g.cues.length > 0) return { main, sub: 0 }; // ループは子先頭へ
    return firstPlayable(seq, main + 1);
  }
  // CUE / 範囲外
  return firstPlayable(seq, main + 1);
}

/**
 * 進行中フェードを `now` 時点まで進め、`rt.tracked` を更新する。
 * delay 中は from 保持、durMs<=0 は delay 後に即スナップ、完了で fade=null。
 */
export function applyFade(rt: ShowRuntime, now: number): void {
  const fade = rt.fade;
  if (!fade) return;

  const elapsed = now - fade.startMs - fade.delayMs;
  let t: number;
  if (elapsed < 0) {
    t = 0; // delay 中（厳密に開始前）
  } else if (fade.durMs <= 0) {
    t = 1; // 即スナップ（delay 経過後）
  } else {
    t = clamp01(elapsed / fade.durMs);
  }

  const { from, to } = fade;
  const tracked = rt.tracked;
  for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
    tracked[ch] = t >= 1 ? to[ch] : lerp(from[ch], to[ch], t);
  }

  if (t >= 1) rt.fade = null; // 確定（tracked は to に一致済み）
}

/**
 * フェードを開始する。tracked（現在表示値）から target へ。
 * tracked は変更せず fade を設定するのみ（次 tick の applyFade で進む）。
 */
export function startFade(
  rt: ShowRuntime,
  target: number[],
  now: number,
  durMs: number,
  delayMs: number,
): void {
  rt.fade = {
    from: rt.tracked.slice(),
    to: target,
    startMs: now,
    durMs: Math.max(0, durMs),
    delayMs: Math.max(0, delayMs),
  };
}

/** GO 計算時の「直前ターゲット」。フェード中なら to、無ければ現在 tracked。 */
export function currentTarget(rt: ShowRuntime): number[] {
  return rt.fade ? rt.fade.to : rt.tracked;
}

function clampValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
