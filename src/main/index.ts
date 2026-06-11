/**
 * Electron main プロセスのエントリ。
 * BrowserWindow のライフサイクル管理と EngineHost の起動を担う。
 */

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EngineHost } from './engineHost';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** vite-plugin-electron が dev サーバ URL を注入する。 */
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let host: EngineHost | null = null;

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
