/**
 * Timeline（§5.5）の純ロジック。内部タイムコード（または音声再生位置）の
 * playhead が各ポイントの timecode を跨いだら GO を発火する。
 *
 * Electron / Node 非依存・Vitest 対象。
 */

import type { TimelinePoint } from '../shared/types';

/**
 * playhead が last→now に前進する間に跨いだポイントの index を昇順で返す。
 * 条件: last < timecodeMs <= now（前進時のみ。後退や同位置では空）。
 */
export function pointsCrossed(
  points: readonly TimelinePoint[],
  lastMs: number,
  nowMs: number,
): number[] {
  if (nowMs <= lastMs) return [];
  const crossed: { idx: number; tc: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const tc = points[i].timecodeMs;
    if (tc > lastMs && tc <= nowMs) crossed.push({ idx: i, tc });
  }
  // timecode 昇順（同時刻は元の順）で発火。
  crossed.sort((a, b) => a.tc - b.tc);
  return crossed.map((c) => c.idx);
}
