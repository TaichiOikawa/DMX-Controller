/**
 * Electron main プロセスのエントリ。
 * BrowserWindow のライフサイクル管理と EngineHost の起動を担う。
 */

import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EngineHost } from './engineHost';
import { buildAppMenu, defaultMenuState, type MenuState } from './menu';
import { Cmd } from '../shared/ipc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** vite-plugin-electron が dev サーバ URL を注入する。 */
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
/** RGB カラーピッカーの別ウィンドウ（未表示は null）。 */
let pickerWindow: BrowserWindow | null = null;
/** 音量モニターの別ウィンドウ（未表示は null）。 */
let monitorWindow: BrowserWindow | null = null;
let host: EngineHost | null = null;
/** 終了確認を通過した（または不要）ことを示すフラグ。再入防止。 */
let allowClose = false;

/** メニューの動的状態。engine state と renderer の UI 状態から更新し、変化時に再構築する。 */
let menuState: MenuState = { ...defaultMenuState };

/** 現在の menuState でメニューを構築（再構築）する。 */
function refreshMenu(): void {
  buildAppMenu(mainWindow, menuState);
}

/** 未保存があれば終了前に確認ダイアログを出す。保存/破棄/キャンセルを処理する。 */
async function confirmCloseWhenDirty(): Promise<void> {
  if (!mainWindow || !host) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['保存して終了', '保存せず終了', 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    message: '未保存の変更があります',
    detail: '変更を保存してから終了しますか？',
  });
  if (response === 2) return; // キャンセル: そのまま開いておく
  if (response === 0) {
    const r = await host.saveActiveForClose();
    if (!r.ok) return; // 保存をキャンセル/失敗 → 終了しない
  }
  allowClose = true;
  mainWindow.close();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'DMX Console',
    webPreferences: {
      // preload は CJS(.cjs) で出力する（vite.config.ts 参照）。
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // build 時、renderer は dist/index.html に出力される。
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  host?.attach(mainWindow.webContents);

  mainWindow.on('close', (e) => {
    if (allowClose || !host?.isDirty()) return;
    e.preventDefault();
    void confirmCloseWhenDirty();
  });

  mainWindow.on('closed', () => {
    // メインを閉じたら付随するサブウィンドウも閉じる。
    pickerWindow?.close();
    monitorWindow?.close();
    mainWindow = null;
  });
}

/** RGB カラーピッカーを別ウィンドウで開く（既に開いていれば前面化・常にメインより前面）。 */
function openColorPickerWindow(): void {
  if (pickerWindow) {
    if (pickerWindow.isMinimized()) pickerWindow.restore();
    pickerWindow.focus();
    return;
  }

  pickerWindow = new BrowserWindow({
    width: 360,
    height: 460,
    minWidth: 260,
    minHeight: 200,
    backgroundColor: '#0a0a0a',
    title: 'RGB Picker',
    autoHideMenuBar: true,
    // メインの子ウィンドウにして常にメインより前面に出す（modal ではないのでメイン側も操作可）。
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // メインのアプリメニューはこのウィンドウには出さない（操作はメイン側）。
  pickerWindow.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    pickerWindow.loadURL(`${VITE_DEV_SERVER_URL}#picker`);
  } else {
    pickerWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'picker' });
  }

  const wc = pickerWindow.webContents;
  wc.on('did-finish-load', () => host?.addClient(wc));
  pickerWindow.on('closed', () => {
    host?.removeClient(wc);
    pickerWindow = null;
  });
}

/** 音量モニターを別ウィンドウで開く（既に開いていれば前面化・常にメインより前面）。 */
function openMonitorWindow(): void {
  if (monitorWindow) {
    if (monitorWindow.isMinimized()) monitorWindow.restore();
    monitorWindow.focus();
    return;
  }

  monitorWindow = new BrowserWindow({
    width: 180,
    height: 460,
    minWidth: 120,
    minHeight: 240,
    backgroundColor: '#0a0a0a',
    title: '音量モニター',
    autoHideMenuBar: true,
    // メインの子ウィンドウにして常にメインより前面に出す（modal ではないのでメイン側も操作可）。
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  monitorWindow.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    monitorWindow.loadURL(`${VITE_DEV_SERVER_URL}#monitor`);
  } else {
    monitorWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'monitor' });
  }

  const wc = monitorWindow.webContents;
  wc.on('did-finish-load', () => host?.addClient(wc));
  monitorWindow.on('closed', () => {
    host?.removeClient(wc);
    monitorWindow = null;
  });
}

app.whenReady().then(() => {
  // オーディオ出力デバイスの列挙でデバイス「名」を露出するには media 権限が要る。
  // 信頼済みの自前アプリなので media 系はプロンプトなしで許可する（マイクは名前解放のため一瞬使うのみ）。
  const allowMedia = (permission: string): boolean =>
    permission === 'media' || permission === 'audioCapture' || permission === 'mediaKeySystem';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(allowMedia(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));
  // 出力デバイス選択（setSinkId）を許可する。
  session.defaultSession.setDevicePermissionHandler(() => true);

  host = new EngineHost();
  host.registerIpc();

  // engine state（モード/BLACKOUT/Undo・Redo 可否）の変化でメニューを再構築。
  host.setEngineStateListener((state) => {
    menuState = {
      ...menuState,
      mode: state.mode,
      blackout: state.blackout,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    };
    refreshMenu();
  });
  // renderer の UI 状態（タブ/パネル開閉）の変化でメニューを再構築。
  host.setUiStateListener((ui) => {
    menuState = {
      ...menuState,
      tab: ui.tab,
      sidebarCollapsed: ui.sidebarCollapsed,
      fadersCollapsed: ui.fadersCollapsed,
    };
    refreshMenu();
  });

  // RGB カラーピッカーを別ウィンドウで開く要求（renderer → main）。
  ipcMain.on(Cmd.openColorPicker, () => openColorPickerWindow());
  // 音量モニターを別ウィンドウで開く要求（renderer → main）。
  ipcMain.on(Cmd.openMonitor, () => openMonitorWindow());

  host.start();

  // 起動時点の engine state を初期メニュー状態へ反映してから構築する。
  const initial = host.getEngineState();
  menuState = {
    ...menuState,
    mode: initial.mode,
    blackout: initial.blackout,
    canUndo: initial.canUndo,
    canRedo: initial.canRedo,
  };

  createWindow();
  refreshMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    host?.stop();
    app.quit();
  }
});

app.on('before-quit', () => {
  host?.stop();
});
