/**
 * Timeline の座標変換・時刻整形（内部タイムコードは ms 専用）。
 * リファレンス（DMX-TimelineController）の timeline/utils.ts を ms 専用に簡素化して移植。
 */

/** ズーム前の基準スケール（1ms あたりの px）。zoom と掛け合わせて使う。 */
export const BASE_PX_PER_MS = 0.1;

export interface TimeScale {
  /** 0.25 〜 5.0 */
  zoom: number;
}

export function pxPerMs(scale: TimeScale): number {
  return BASE_PX_PER_MS * scale.zoom;
}

export function timeToPx(ms: number, scale: TimeScale): number {
  return ms * pxPerMs(scale);
}

export function pxToTime(px: number, scale: TimeScale): number {
  return Math.round(px / pxPerMs(scale));
}

/** ms → "MM:SS:CS"（CS=センチ秒）。 */
export function formatTimecode(ms: number): string {
  const m = Math.floor(ms / 1000 / 60);
  const s = Math.floor((ms / 1000) % 60);
  const cs = Math.floor((ms % 1000) / 10);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(m)}:${p2(s)}:${p2(cs)}`;
}
