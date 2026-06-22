/**
 * Electron main プロセスのエントリ。
 * BrowserWindow のライフサイクル管理と EngineHost の起動を担う。
 */

import { app, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EngineHost } from './engineHost';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** vite-plugin-electron が dev サーバ URL を注入する。 */
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let host: EngineHost | null = null;
/** 終了確認を通過した（または不要）ことを示すフラグ。再入防止。 */
let allowClose = false;

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
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  host = new EngineHost();
  host.registerIpc();
  host.start();

  createWindow();

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
