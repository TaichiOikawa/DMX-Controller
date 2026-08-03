/**
 * Timeline の座標変換・時刻整形（内部タイムコードは ms 専用）。
 * リファレンス（DMX-TimelineController）の timeline/utils.ts を ms 専用に簡素化して移植。
 */

import type { SequenceEntry } from '../../../shared/types';

/** CUE ラベルの表示モード。'lyrics'=歌詞優先 / 'name'=CUE 名優先。 */
export type CueLabelMode = 'lyrics' | 'name';

/** GO ポイントに紐づける CUE 候補。番号(main.sub)と表示ラベル付き。 */
export interface CueOption {
  id: string;
  /** "1" / "2.1" 形式の番号ラベル。 */
  no: string;
  /** 表示ラベル（モードに応じて歌詞 or CUE 名を優先）。 */
  label: string;
}

/**
 * CUE の表示ラベル。モードに応じて優先順を入れ替え、優先側が空なら他方へフォールバック。
 * どちらも無ければ 'Cue'。
 */
function cueLabel(cue: { name?: string; lyrics?: string }, mode: CueLabelMode): string {
  const name = cue.name?.trim();
  const lyrics = cue.lyrics?.trim();
  return (mode === 'lyrics' ? lyrics || name : name || lyrics) || 'Cue';
}

/** マスター列を走査し、選択肢用の CUE 一覧（番号＋ラベル）を返す。 */
export function cueOptions(seq: readonly SequenceEntry[], mode: CueLabelMode): CueOption[] {
  const out: CueOption[] = [];
  seq.forEach((entry, m) => {
    if (entry.kind === 'cue') {
      out.push({ id: entry.cue.id, no: `${m + 1}`, label: cueLabel(entry.cue, mode) });
    } else {
      entry.group.cues.forEach((c, j) => {
        out.push({ id: c.id, no: `${m + 1}.${j + 1}`, label: cueLabel(c, mode) });
      });
    }
  });
  return out;
}

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

/**
 * 要素に幅が付いたら一度だけ cb を呼ぶ。解除関数を返す。
 * Timeline タブ非表示（display:none）中は幅 0 のため、WaveSurfer をこの状態で
 * 生成すると canvas が 1 枚も作られず波形が出ない。幅が付くのを待ってから
 * 生成するために使う（生成後のリサイズ追従は WaveSurfer 自身が行う）。
 */
export function onceVisible(el: HTMLElement, cb: () => void): () => void {
  if (el.clientWidth > 0) {
    cb();
    return () => {};
  }
  const ro = new ResizeObserver(() => {
    if (el.clientWidth <= 0) return;
    ro.disconnect();
    cb();
  });
  ro.observe(el);
  return () => ro.disconnect();
}

/** クリップ配置のスナップ単位（ms）。リファレンス同様 10ms グリッドへ吸着する。 */
export const SNAP_MS = 10;

/** ms を SNAP_MS グリッドへ吸着する。 */
export function snapMs(ms: number): number {
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

/** ms → "MM:SS:CS"（CS=センチ秒）。 */
export function formatTimecode(ms: number): string {
  const m = Math.floor(ms / 1000 / 60);
  const s = Math.floor((ms / 1000) % 60);
  const cs = Math.floor((ms % 1000) / 10);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(m)}:${p2(s)}:${p2(cs)}`;
}
