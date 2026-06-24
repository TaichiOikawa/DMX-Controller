/**
 * RGB ⇔ HEX 変換ユーティリティ（カラーピッカー入力用・純粋関数）。
 * 値域は各成分 0-255、HEX は `#rrggbb`（小文字）。
 */

/** 0-255 にクランプして整数化。 */
function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** 1 成分を 2 桁の 16 進へ。 */
function toHex2(v: number): string {
  return clampByte(v).toString(16).padStart(2, '0');
}

/** r/g/b（0-255）を `#rrggbb` に変換する。 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/** `#rrggbb`（または `#rgb`）を r/g/b（0-255）に変換する。不正値は 0 とみなす。 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, '');
  // 短縮形 #rgb → #rrggbb。
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
