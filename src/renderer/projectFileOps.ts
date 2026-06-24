/**
 * プロジェクトのファイル操作（新規/開く/保存）。
 *
 * ProjectBar のボタンとアプリメニューの双方から呼べるよう、未保存確認やエラー表示を
 * ここに一元化する。store の dirty 状態は呼び出し時に getState() で参照する。
 */

import { useDmxStore } from './store';

/** 新規プロジェクト（未保存なら確認）。 */
export function fileNewProject(): void {
  const { dirty } = useDmxStore.getState();
  if (dirty && !window.confirm('未保存の変更があります。新規プロジェクトを作成しますか？')) return;
  window.dmx.newProject();
}

/** プロジェクトを開く（未保存なら確認）。 */
export async function fileOpenProject(): Promise<void> {
  const { dirty } = useDmxStore.getState();
  if (dirty && !window.confirm('未保存の変更があります。プロジェクトを開きますか？')) return;
  const r = await window.dmx.loadProject();
  if (r.error) alert(`読込に失敗しました: ${r.error}`);
}

/** 名前を付けて保存（常に保存ダイアログ）。 */
export async function fileSaveProjectAs(): Promise<void> {
  const r = await window.dmx.saveProject();
  if (r.error) alert(`保存に失敗しました: ${r.error}`);
}

/** 上書き保存（パス未確定なら保存ダイアログにフォールバック）。 */
export async function fileSaveProjectOverwrite(): Promise<void> {
  const r = await window.dmx.saveProjectOverwrite();
  if (r.error) alert(`保存に失敗しました: ${r.error}`);
}
