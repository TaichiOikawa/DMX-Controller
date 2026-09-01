/**
 * 自動アップデート（electron-updater + GitHub Releases）。
 *
 * 方針:
 *  - 起動時に一度だけチェックし、新版があればバックグラウンドでダウンロードする。
 *  - インストール（＝アプリ再起動）は必ずユーザーの明示的な同意を取ってから行う。
 *    公演中に勝手に落ちることがないよう、SHOW モード中はダイアログを出さず保留する。
 *  - 未保存の変更がある場合は既存の終了確認フロー（prepareQuit）を必ず通す。
 *
 * 対象外（何もしない）:
 *  - 開発中（!app.isPackaged）
 *  - ポータブル版 exe（electron-builder の portable target は差分更新に非対応）
 */

import { app, dialog, shell, type BrowserWindow } from 'electron';
// electron-updater は CommonJS のため、ESM からは default import 経由でしか取り出せない。
import electronUpdater from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

/** リリースページ（ポータブル版など自動更新できない場合の手動導線）。 */
const RELEASES_URL = 'https://github.com/TaichiOikawa/DMX-Controller/releases/latest';

export interface UpdaterDeps {
  /** ダイアログの親ウィンドウ。null ならモーダルにせず表示する。 */
  getWindow: () => BrowserWindow | null;
  /** ダイアログを出してよいか（SHOW モード中は false にして公演中の割り込みを防ぐ）。 */
  canPrompt: () => boolean;
  /**
   * 終了してよい状態にする（未保存なら保存/破棄の確認を通す）。
   * false を返したら（＝ユーザーがキャンセル）インストールは中止する。
   */
  prepareQuit: () => Promise<boolean>;
}

let deps: UpdaterDeps | null = null;
/** ダウンロード済みで、まだユーザーに提示していない更新。SHOW モード中の保留にも使う。 */
let downloadedUpdate: UpdateInfo | null = null;
/** ダイアログの多重表示防止。 */
let promptInFlight = false;
/** 手動チェックの二重実行防止。 */
let checkInFlight = false;

/** ポータブル版 exe として起動しているか（electron-builder が環境変数を設定する）。 */
function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

/** 自動更新が動作する構成か。 */
function isSupported(): boolean {
  return app.isPackaged && !isPortable();
}

/** ダイアログの共通オプション（親ウィンドウがあればモーダルにする）。 */
function show(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = deps?.getWindow() ?? null;
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

/**
 * ダウンロード済みの更新をユーザーに提示する。
 * SHOW モード中や別ダイアログ表示中は何もしない（保留のまま。mode 復帰時に再度呼ばれる）。
 */
async function promptInstall(): Promise<void> {
  if (!downloadedUpdate || promptInFlight || !deps?.canPrompt()) return;
  const info = downloadedUpdate;
  promptInFlight = true;
  try {
    const { response } = await show({
      type: 'info',
      buttons: ['今すぐ再起動して更新', '後で'],
      defaultId: 0,
      cancelId: 1,
      message: `新しいバージョン ${info.version} を準備しました`,
      detail:
        `現在のバージョンは ${app.getVersion()} です。\n` +
        '再起動すると更新が適用されます。未保存の変更があれば先に確認します。',
    });
    if (response !== 0) return; // 「後で」: 保留のまま。次回チェック時にまた提示する。

    // 未保存の確認を通してからインストールする（キャンセルされたら中止）。
    const ok = await deps.prepareQuit();
    if (!ok) return;

    downloadedUpdate = null;
    // インストーラを起動してからアプリを終了する。
    autoUpdater.quitAndInstall();
  } finally {
    promptInFlight = false;
  }
}

/**
 * SHOW モードを抜けた等でダイアログを出せるようになったときに呼ぶ。
 * 保留中の更新があれば改めて提示する。
 */
export function flushPendingUpdatePrompt(): void {
  if (downloadedUpdate) void promptInstall();
}

/** 起動時に一度だけ呼ぶ。イベントを配線し、バックグラウンドでチェックを開始する。 */
export function initAutoUpdater(d: UpdaterDeps): void {
  deps = d;
  if (!isSupported()) return;

  autoUpdater.autoDownload = true;
  // 終了時の暗黙インストールはしない。will-quit で app.exit() する構成では
  // 'quit' 経由のインストールが確実に走らないため、明示的な quitAndInstall に一本化する。
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    downloadedUpdate = info;
    void promptInstall();
  });
  // 自動チェックの失敗は無視する（オフライン運用が普通にあるため通知しない）。
  autoUpdater.on('error', (err: Error) => {
    console.warn('[updater] 更新チェックに失敗:', err.message);
  });

  void autoUpdater.checkForUpdates().catch(() => {
    /* error イベントで処理済み */
  });
}

/** メニュー「アップデートを確認」から呼ぶ。結果を必ずダイアログで返す。 */
export async function checkForUpdatesManually(): Promise<void> {
  if (!isSupported()) {
    const { response } = await show({
      type: 'info',
      buttons: ['リリースページを開く', '閉じる'],
      defaultId: 0,
      cancelId: 1,
      message: isPortable()
        ? 'ポータブル版は自動更新に対応していません'
        : '開発ビルドでは自動更新を行いません',
      detail: `現在のバージョンは ${app.getVersion()} です。最新版は手動で取得してください。`,
    });
    if (response === 0) void shell.openExternal(RELEASES_URL);
    return;
  }

  // 既にダウンロード済みなら、チェックし直さずそのまま提示する。
  if (downloadedUpdate) {
    await promptInstall();
    return;
  }
  if (checkInFlight) return;

  checkInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      // ダウンロードは autoDownload で進行中。完了時に update-downloaded で提示される。
      await show({
        type: 'info',
        buttons: ['OK'],
        message: `新しいバージョン ${result.updateInfo.version} があります`,
        detail: 'バックグラウンドでダウンロードしています。完了したらお知らせします。',
      });
    } else {
      await show({
        type: 'info',
        buttons: ['OK'],
        message: '最新バージョンを使用しています',
        detail: `バージョン ${app.getVersion()}`,
      });
    }
  } catch (err) {
    await show({
      type: 'error',
      buttons: ['OK'],
      message: '更新の確認に失敗しました',
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    checkInFlight = false;
  }
}
