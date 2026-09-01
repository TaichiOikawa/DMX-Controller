/**
 * アプリケーションメニューバーの構築（§UI）。
 *
 * 方針:
 *  - エンジン/UI を伴う項目は renderer に MenuAction を送り、renderer 側の既存ロジック
 *    （window.dmx / store / 未保存確認ダイアログ）を再利用する（main で直接叩かない）。
 *  - OS 標準で完結する項目（再読込・DevTools・ズーム・全画面・最小化・閉じる・終了）は role を使う。
 *  - 状態（モード/BLACKOUT/タブ/パネル開閉/Undo・Redo 可否）は引数で受け取り、
 *    checkbox/radio・enabled・checked に反映する。状態変化時は呼び出し側が再構築する。
 *
 * 注意: App.tsx が Space / 矢印 / Backspace を入力ガード付きでグローバル処理しているため、
 * ショー > GO / 1つ戻る にはアクセラレータを付けない（入力中の暴発防止）。
 */

import {
  app,
  dialog,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { Evt, type MenuAction } from '../shared/ipc';
import type { EngineMode } from '../shared/types';

/** メニューの動的状態（main 側が把握しているもの＋ renderer から同期した UI 状態）。 */
export interface MenuState {
  mode: EngineMode;
  blackout: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tab: 'cue' | 'timeline';
  sidebarCollapsed: boolean;
  fadersCollapsed: boolean;
}

/** 既定（ウィンドウ未生成・状態未取得時）の状態。 */
export const defaultMenuState: MenuState = {
  mode: 'edit',
  blackout: false,
  canUndo: false,
  canRedo: false,
  tab: 'cue',
  sidebarCollapsed: false,
  fadersCollapsed: false,
};

/** メニューを構築して setApplicationMenu する。状態が変わるたびに呼び直す。 */
export function buildAppMenu(win: BrowserWindow | null, state: MenuState): void {
  const dispatch = (action: MenuAction) => () => {
    win?.webContents.send(Evt.menuAction, action);
  };
  const editable = state.mode === 'edit';

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'ファイル',
      submenu: [
        { label: '新規プロジェクト', accelerator: 'CmdOrCtrl+N', click: dispatch('file:new') },
        { label: '開く…', accelerator: 'CmdOrCtrl+O', click: dispatch('file:open') },
        { type: 'separator' },
        { label: '上書き保存', accelerator: 'CmdOrCtrl+S', click: dispatch('file:save') },
        {
          label: '名前を付けて保存…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: dispatch('file:saveAs'),
        },
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        {
          label: '元に戻す',
          accelerator: 'CmdOrCtrl+Z',
          enabled: editable && state.canUndo,
          click: dispatch('edit:undo'),
        },
        {
          label: 'やり直し',
          accelerator: 'CmdOrCtrl+Shift+Z',
          enabled: editable && state.canRedo,
          click: dispatch('edit:redo'),
        },
        { type: 'separator' },
        { label: '設定…', accelerator: 'CmdOrCtrl+,', click: dispatch('edit:prefs') },
      ],
    },
    {
      label: '表示',
      submenu: [
        {
          label: 'CUE タブ',
          type: 'radio',
          checked: state.tab === 'cue',
          click: dispatch('view:tabCue'),
        },
        {
          label: 'Timeline タブ',
          type: 'radio',
          checked: state.tab === 'timeline',
          click: dispatch('view:tabTimeline'),
        },
        { type: 'separator' },
        {
          label: 'サイドバーを表示',
          type: 'checkbox',
          checked: !state.sidebarCollapsed,
          click: dispatch('view:toggleSidebar'),
        },
        {
          label: 'フェーダーバンクを表示',
          type: 'checkbox',
          checked: !state.fadersCollapsed,
          click: dispatch('view:toggleFaders'),
        },
        {
          label: 'パネルの大きさを既定に戻す',
          click: dispatch('view:resetLayout'),
        },
        { type: 'separator' },
        { role: 'reload', label: '再読み込み' },
        { role: 'toggleDevTools', label: '開発者ツール' },
        { type: 'separator' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示' },
      ],
    },
    {
      label: 'ショー',
      submenu: [
        // Space / ← は App.tsx のグローバルハンドラに任せ、アクセラレータは付けない。
        { label: 'GO', click: dispatch('show:go') },
        { label: '1つ戻る', click: dispatch('show:goBack') },
        { type: 'separator' },
        {
          label: 'EDIT モード',
          type: 'radio',
          checked: state.mode === 'edit',
          click: dispatch('show:modeEdit'),
        },
        {
          label: 'SHOW モード',
          type: 'radio',
          checked: state.mode === 'show',
          click: dispatch('show:modeShow'),
        },
        { type: 'separator' },
        {
          label: 'BLACKOUT',
          type: 'checkbox',
          checked: state.blackout,
          click: dispatch('show:blackoutToggle'),
        },
        { label: 'グランドマスター FULL', click: dispatch('show:gmFull') },
      ],
    },
    {
      label: 'ウインドウ',
      submenu: [
        { label: 'ファイルを再リンク…', click: dispatch('file:relink') },
        { type: 'separator' },
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: 'ズーム' },
        { role: 'close', label: '閉じる' },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: 'バージョン情報',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'バージョン情報',
              message: app.getName(),
              detail: `バージョン ${app.getVersion()}\nElectron ${process.versions.electron}`,
            });
          },
        },
        {
          label: 'キーボードショートカット',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'キーボードショートカット',
              message: '主なショートカット',
              detail: [
                'Space / →   GO（Timeline タブでは再生/一時停止）',
                '← / Backspace   1つ戻る',
                'Ctrl+S   上書き保存',
                'Ctrl+Z / Ctrl+Shift+Z   元に戻す / やり直し',
                'Ctrl+,   設定',
              ].join('\n'),
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
