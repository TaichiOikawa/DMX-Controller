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
  if (r.error) {
    alert(`読込に失敗しました: ${r.error}`);
    return;
  }
  // 開いた直後に参照ファイル（音声）の欠損を検知したら、まとめて再リンクできる
  // モーダルを開く（フォルダ自動マッチ＋行ごとの個別選択）。
  if (r.ok && r.missingFiles && r.missingFiles.length > 0) {
    useDmxStore.getState().setMissingFiles(r.missingFiles);
  }
}

/**
 * 参照ファイル（音声）の存在確認を行い、欠損があれば一括再リンクモーダルを開く。
 * すべて揃っていれば、その旨を通知する。メニュー「ファイルを再リンク」から呼ぶ。
 */
export async function fileRelinkAudio(): Promise<void> {
  const missing = await window.dmx.checkMissingFiles();
  if (missing.length === 0) {
    alert('すべての音声ファイルが見つかりました。');
    return;
  }
  useDmxStore.getState().setMissingFiles(missing);
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

/** 指定 Show を .dmxshow として書き出す。 */
export async function fileExportShow(showId: string): Promise<void> {
  const r = await window.dmx.exportShow(showId);
  if (r.error) alert(`書き出しに失敗しました: ${r.error}`);
}

/**
 * .dmxshow を選んで解析し、成功すればパッチモーダルを開く。
 * 実際の取り込みはモーダル確定時に行う（ここでは Project を変更しない）。
 */
export async function fileImportShow(): Promise<void> {
  const r = await window.dmx.pickShowFile();
  if (r.error) {
    alert(`読み込みに失敗しました: ${r.error}`);
    return;
  }
  if (r.ok && r.payload) useDmxStore.getState().setShowImport(r.payload);
}
