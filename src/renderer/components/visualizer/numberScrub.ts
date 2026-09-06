/** 数値入力のドラッグ操作を開始するまでの長押し時間（ミリ秒）。 */
export const NUMBER_SCRUB_HOLD_MS = 100;

export function createNumberScrub({ x, value, step, min = -Infinity, max = Infinity, integer = false, onActivate }: {
  x: number; value: number; step: number; min?: number; max?: number; integer?: boolean; onActivate(): void;
}) {
  let active = false;
  let stopped = false;
  
  const timer = setTimeout(() => { if (!stopped) { active = true; onActivate(); } }, NUMBER_SCRUB_HOLD_MS);
  return {
    get active() { return active; },
    move(clientX: number, fine = false): number | null {
      if (stopped) return null;
      const delta = clientX - x;
      if (!active) {
        if (Math.abs(delta) > 5) this.stop();
        return null;
      }
      const next = Number((value + Math.round(delta / 8) * step * (fine ? 0.1 : 1)).toFixed(6));
      return Math.max(min, Math.min(max, integer ? Math.round(next) : next));
    },
    stop() { clearTimeout(timer); stopped = true; active = false; },
  };
}
