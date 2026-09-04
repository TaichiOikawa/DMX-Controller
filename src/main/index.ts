/**
 * Electron main プロセスのエントリ。
 * BrowserWindow のライフサイクル管理と EngineHost の起動を担う。
 */

import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EngineHost } from './engineHost';
import { buildAppMenu, defaultMenuState, type MenuState } from './menu';
import { projectPathFromArgv } from './openFileArgs';
import { Cmd, Evt } from '../shared/ipc';
import { flushPendingUpdatePrompt, initAutoUpdater } from './updater';
import { VisualizerProfileStore } from './visualizerProfileStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** vite-plugin-electron が dev サーバ URL を注入する。 */
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
/** RGB カラーピッカーの別ウィンドウ（未表示は null）。 */
let pickerWindow: BrowserWindow | null = null;
/** 音量モニターの別ウィンドウ（未表示は null）。 */
let monitorWindow: BrowserWindow | null = null;
/** 3D Fixture Visualizerの別ウィンドウ（単一インスタンス）。 */
let visualizerWindow: BrowserWindow | null = null;
let host: EngineHost | null = null;
let visualizerProfileStore: VisualizerProfileStore | null = null;
/** 終了確認を通過した（または不要）ことを示すフラグ。再入防止。 */
let allowClose = false;

/**
 * OS から「開け」と指示されたファイル（.dmxproj のダブルクリック / D&D / `open` 引数）。
 * renderer が consumePendingOpenFile で取り出すまでここに置く。
 *
 * main から一方的に送りつけると renderer のマウント前に取りこぼすため、
 * 「合図（Evt.pendingOpenFile）を送る + renderer 側が起動時にも取りに来る」の二段構えにしている。
 */
let pendingOpenPath: string | null = null;

/** 開くべきファイルを控え、renderer が起動済みなら合図を送る。 */
function queueOpenFile(filePath: string | null): void {
  if (!filePath) return;
  pendingOpenPath = filePath;
  mainWindow?.webContents.send(Evt.pendingOpenFile);
}

/**
 * メインウィンドウを前面に出す（無ければ作る）。
 * 別インスタンスからのファイル起動や macOS の open-file から呼ぶ。
 */
function showMainWindow(): void {
  if (!mainWindow) {
    // ready 前は EngineHost 未生成なので、whenReady 内の createWindow に任せる。
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** メニューの動的状態。engine state と renderer の UI 状態から更新し、変化時に再構築する。 */
let menuState: MenuState = { ...defaultMenuState };

/** 現在の menuState でメニューを構築（再構築）する。 */
function refreshMenu(): void {
  buildAppMenu(mainWindow, menuState);
}

/** 確認ダイアログの多重表示防止（close と quit の両経路から呼ばれるため）。 */
let confirmInFlight = false;

/**
 * 終了してよい状態にする。未保存があれば確認ダイアログを出し、保存/破棄/キャンセルを処理する。
 * 終了してよければ allowClose を立てて true を返す（キャンセル/保存失敗なら false）。
 * 自動アップデートのインストール前にも同じ経路を通す（updater.ts の prepareQuit）。
 */
async function confirmSaveBeforeExit(): Promise<boolean> {
  if (!mainWindow || !host) return true;
  if (!host.isDirty()) {
    allowClose = true;
    return true;
  }
  if (confirmInFlight) return false;
  confirmInFlight = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['保存して終了', '保存せず終了', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
      message: '未保存の変更があります',
      detail: '変更を保存してから終了しますか？',
    });
    if (response === 2) return false; // キャンセル: そのまま開いておく
    if (response === 0) {
      const r = await host.saveActiveForClose();
      if (!r.ok) return false; // 保存をキャンセル/失敗 → 終了しない
    }
    allowClose = true;
    return true;
  } finally {
    confirmInFlight = false;
  }
}

/**
 * 未保存があれば終了前に確認ダイアログを出す。保存/破棄/キャンセルを処理する。
 * @param quitAfter true ならウィンドウを閉じる代わりにアプリを終了する（quit 経路用）。
 */
async function confirmCloseWhenDirty(quitAfter = false): Promise<void> {
  if (!(await confirmSaveBeforeExit())) return;
  if (quitAfter) app.quit();
  else mainWindow?.close();
}

function createWindow(): void {
  // 前ウィンドウで終了確認を通過した状態を持ち越さない（macOS の Dock 再表示等）。
  allowClose = false;
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
    visualizerWindow?.close();
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

/** 3D Fixture Visualizerを独立ウィンドウで開く（既存なら前面化）。 */
function openVisualizerWindow(): void {
  if (visualizerWindow) {
    if (visualizerWindow.isMinimized()) visualizerWindow.restore();
    visualizerWindow.focus();
    return;
  }

  visualizerWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#080b12',
    title: '3D Fixture Visualizer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  visualizerWindow.setMenu(null);

  if (VITE_DEV_SERVER_URL) {
    visualizerWindow.loadURL(`${VITE_DEV_SERVER_URL}#visualizer`);
  } else {
    visualizerWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'visualizer' });
  }

  const wc = visualizerWindow.webContents;
  wc.on('did-finish-load', () => host?.addClient(wc));
  visualizerWindow.on('closed', () => {
    host?.removeClient(wc);
    visualizerWindow = null;
  });
}

/**
 * 多重起動の抑止。.dmxproj を関連付けから開くと OS は「新しいプロセス」を起動するため、
 * ロックを取れなかった側は引数（開くファイル）を先行インスタンスへ渡して終了する。
 * 出力（Art-Net の UDP ポート / OpenDMX のシリアル）を二重に掴まないためにも必要。
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

// 2 個目以降の起動から引数を受け取る（Windows / Linux のダブルクリック経路）。
app.on('second-instance', (_e, argv, workingDirectory) => {
  queueOpenFile(projectPathFromArgv(argv, workingDirectory, app.isPackaged));
  showMainWindow();
});

// macOS はコマンドライン引数ではなく open-file イベントでファイルが渡る（ready 前にも発火しうる）。
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  queueOpenFile(filePath);
  showMainWindow();
});

app.whenReady().then(() => {
  // ロックを取れなかったインスタンスは何も初期化せずに終了する（上の app.quit() が進行中）。
  if (!hasSingleInstanceLock) return;

  // オーディオ出力デバイスの列挙でデバイス「名」を露出するには media 権限が要る。
  // 信頼済みの自前アプリなので media 系はプロンプトなしで許可する（マイクは名前解放のため一瞬使うのみ）。
  // speaker-selection は出力デバイス選択（AudioContext.setSinkId）に必要。
  const allowMedia = (permission: string): boolean =>
    permission === 'media' ||
    permission === 'audioCapture' ||
    permission === 'mediaKeySystem' ||
    permission === 'speaker-selection';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(allowMedia(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));
  // このハンドラが扱うのは WebHID / Web Serial / WebUSB で、renderer からは一切使わないため拒否する
  // （シリアルは main プロセスの serialport が扱う。音声出力の選択は上の media / speaker-selection で足りる）。
  session.defaultSession.setDevicePermissionHandler(() => false);

  host = new EngineHost();
  host.registerIpc();
  visualizerProfileStore = new VisualizerProfileStore();

  // engine state（モード/BLACKOUT/Undo・Redo 可否）の変化でメニューを再構築。
  // emitState はフェーダー操作等でも高頻度に来るため、メニューに影響する
  // フィールドが実際に変わったときだけ再構築する（ネイティブメニュー構築は安くない）。
  host.setEngineStateListener((state) => {
    if (
      state.mode === menuState.mode &&
      state.blackout === menuState.blackout &&
      state.canUndo === menuState.canUndo &&
      state.canRedo === menuState.canRedo
    ) {
      return;
    }
    menuState = {
      ...menuState,
      mode: state.mode,
      blackout: state.blackout,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    };
    refreshMenu();
    // SHOW モード中は更新ダイアログを保留している。抜けたらここで提示する。
    if (menuState.mode !== 'show') flushPendingUpdatePrompt();
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
  ipcMain.on(Cmd.openVisualizer, () => openVisualizerWindow());
  ipcMain.handle(Cmd.getVisualizerProfileLibrary, () => visualizerProfileStore?.get());
  ipcMain.handle(Cmd.setVisualizerProfileLibrary, (_event, library) =>
    visualizerProfileStore?.set(library),
  );
  // OS から渡された「開くべきファイル」を renderer が取り出す（取り出したら消える）。
  ipcMain.handle(Cmd.consumePendingOpenFile, () => {
    const p = pendingOpenPath;
    pendingOpenPath = null;
    return p;
  });

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

  // 関連付け（.dmxproj のダブルクリック）で起動した場合の引数を拾う。
  // 実際の読み込みは renderer がマウント後に取りに来る。
  queueOpenFile(projectPathFromArgv(process.argv, process.cwd(), app.isPackaged));

  createWindow();
  refreshMenu();

  // 自動アップデート（GitHub Releases）。パッケージ版のみ動作する。
  initAutoUpdater({
    getWindow: () => mainWindow,
    // 公演中（SHOW モード）は割り込まない。EDIT に戻った時点で提示する。
    canPrompt: () => menuState.mode !== 'show',
    prepareQuit: confirmSaveBeforeExit,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 停止処理は will-quit（quit 確定後）に一元化する。
  if (process.platform !== 'darwin') app.quit();
});

// quit（メニュー「終了」/ Cmd+Q）でも未保存確認を通す。
// before-quit はウィンドウの close（キャンセル可能）より先に発火するため、
// ここで停止処理をすると quit キャンセル時にエンジンが止まったままになる。
app.on('before-quit', (e) => {
  if (allowClose || !host?.isDirty() || !mainWindow) return;
  e.preventDefault();
  void confirmCloseWhenDirty(true);
});

// quit が確定した（もうキャンセルされない）時点で停止する。
// シリアルポートの close 等の完了を待ってから終了する（ハング防止に上限 2 秒）。
let quitCleanupDone = false;
app.on('will-quit', (e) => {
  if (quitCleanupDone || !host) return;
  e.preventDefault();
  quitCleanupDone = true;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  void Promise.race([host.stop(), timeout]).finally(() => app.exit(0));
});
