/**
 * 永続化データ読込時の共通バリデーションヘルパ。
 *
 * 外部ファイル（Project / アプリ設定）は手で編集されうる前提で、
 * 型が違う・欠けている値はここでデフォルトへ落として読込を落とさない。
 */

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
