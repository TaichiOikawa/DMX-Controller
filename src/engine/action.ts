/**
 * Action ボタン（§5.6）の実行ロジック。最優先オーバーライド層（mixer 層1）。
 *
 * 3 モード:
 *   - hold-once: 押している間、step を1巡して最後で保持。離すと解除。
 *   - hold-loop: 押している間、step をループ（チェイス）。離すと解除。
 *   - press-once: 押したら step を1巡して自動解除。
 *
 * 各 step は対象 ch に対する絶対値。step 間は fadeInMs でクロスフェードし、
 * holdMs 経過で次 step へ進む。Electron / Node 非依存・Vitest 対象。
 */

import {
  UNIVERSE_SIZE,
  type ActionButton,
  type ActionRuntime,
  type ActionStep,
} from '../shared/types';
import { clamp01, lerp } from './playback';

/** step 間切り替えの既定保持時間（holdMs 未指定時）。 */
const DEFAULT_HOLD_MS = 500;

export function createActionRuntime(action: ActionButton): ActionRuntime {
  return {
    actionId: action.id,
    stepIndex: -1,
    stepStartMs: 0,
    values: new Array(UNIVERSE_SIZE).fill(0),
    fade: null,
    controlled: footprintOfSteps(action.steps),
    held: true,
  };
}

/** 全 step の values キーの和集合（このアクションが制御する ch）。 */
export function footprintOfSteps(steps: readonly ActionStep[]): boolean[] {
  const controlled = new Array(UNIVERSE_SIZE).fill(false);
  for (const step of steps) {
    for (const k of Object.keys(step.values)) {
      const ch = Number(k);
      if (ch >= 0 && ch < UNIVERSE_SIZE) controlled[ch] = true;
    }
  }
  return controlled;
}

/** step の絶対ターゲット値（512、未指定 ch は 0）。 */
export function stepTarget(step: ActionStep): number[] {
  const to = new Array(UNIVERSE_SIZE).fill(0);
  for (const [k, v] of Object.entries(step.values)) {
    const ch = Number(k);
    if (ch >= 0 && ch < UNIVERSE_SIZE) to[ch] = clampValue(v);
  }
  return to;
}

/** 指定 step へフェード開始（values は維持し fade を設定）。 */
export function startActionStep(
  rt: ActionRuntime,
  step: ActionStep,
  index: number,
  now: number,
): void {
  rt.fade = {
    from: rt.values.slice(),
    to: stepTarget(step),
    startMs: now,
    durMs: Math.max(0, step.fadeInMs),
    delayMs: 0,
  };
  rt.stepIndex = index;
  rt.stepStartMs = now;
}

/** 進行中フェードを now まで適用（rt.values を更新、完了で fade=null）。 */
export function applyActionFade(rt: ActionRuntime, now: number): void {
  const fade = rt.fade;
  if (!fade) return;
  const elapsed = now - fade.startMs;
  const t = fade.durMs <= 0 ? 1 : clamp01(elapsed / fade.durMs);
  for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
    rt.values[ch] = t >= 1 ? fade.to[ch] : lerp(fade.from[ch], fade.to[ch], t);
  }
  if (t >= 1) rt.fade = null;
}

/**
 * Action を now まで進める。step 保持時間が過ぎたらモードに応じて次 step へ。
 * @returns このアクションを解除すべきなら true（press-once 完了 等）。
 */
export function advanceAction(action: ActionButton, rt: ActionRuntime, now: number): boolean {
  applyActionFade(rt, now);

  const steps = action.steps;
  if (steps.length === 0) return true; // step 無しは即解除

  // 未開始（actionDown 直後）→ step0 へ。
  if (rt.stepIndex < 0) {
    startActionStep(rt, steps[0], 0, now);
    applyActionFade(rt, now); // 即時反映（dur0 step を1tick遅延させない）
    return false;
  }

  const step = steps[rt.stepIndex];
  const holdMs = step.holdMs ?? DEFAULT_HOLD_MS;
  const stepDoneAt = rt.stepStartMs + Math.max(0, step.fadeInMs) + holdMs;
  if (now < stepDoneAt) return false; // まだ現 step 保持中

  const next = rt.stepIndex + 1;
  const atEnd = next >= steps.length;

  if (!atEnd) {
    startActionStep(rt, steps[next], next, now);
    return false;
  }

  // 末尾に到達。
  switch (action.mode) {
    case 'hold-loop':
      startActionStep(rt, steps[0], 0, now); // ループ
      return false;
    case 'press-once':
      return true; // 1巡して自動解除
    case 'hold-once':
    default:
      return false; // 最後で保持（離されるまで）
  }
}

function clampValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
