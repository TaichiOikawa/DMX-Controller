# ビルド手順 / Build Guide

DMX Console（Electron + React + Vite）のビルド・パッケージング手順。

## 1. 前提環境

| ツール   | バージョン      | 備考                                       |
| -------- | --------------- | ------------------------------------------ |
| Node.js  | 24.x（v24.15+） | `node -v` で確認                           |
| Yarn     | 4.x（Berry）    | リポジトリ同梱（`.yarn/`, `nodeLinker: node-modules`） |
| OS       | Windows 11      | Windows 配布物（.exe）をビルドする場合     |

> パッケージマネージャは **Yarn** を使用します（`yarn.lock` 管理）。npm は使わないでください。

## 2. セットアップ

```sh
yarn install
```

## 3. 開発（ホットリロード）

```sh
yarn dev
```

Vite 開発サーバ + Electron が起動します。renderer の変更は HMR で即時反映、main/preload の変更時は Electron が再起動します。

## 4. 品質チェック

| コマンド          | 内容                                  |
| ----------------- | ------------------------------------- |
| `yarn typecheck`  | 型チェック（`tsc -b`、3 構成を参照）  |
| `yarn lint`       | ESLint                                |
| `yarn test`       | 単体テスト（Vitest、`src/**/*.test.ts`） |

## 5. プロダクションビルド（成果物の生成）

```sh
yarn build
```

`tsc -b && vite build` を実行し、以下を生成します。

| 出力先                       | 内容                                            |
| ---------------------------- | ----------------------------------------------- |
| `dist/`                      | renderer（React UI。`index.html` + `assets/`）  |
| `dist-electron/main.js`      | Electron main プロセス（ESM）                   |
| `dist-electron/preload.cjs`  | preload（contextIsolation 下、CommonJS）        |

> renderer / main の依存ライブラリ（react, zustand, wavesurfer 等）はすべて
> Vite/Rolldown でバンドルされるため、配布時に `node_modules` は不要です。

ビルド後の動作確認は次でも可能です（dev サーバなしで成果物を表示）。

```sh
yarn preview
```

## 6. 配布パッケージの作成（electron-builder）

設定は **`electron-builder.yml`** にあります。各コマンドは先に `yarn build` を実行してから electron-builder を走らせます。

| コマンド          | 出力                                                            |
| ----------------- | -------------------------------------------------------------- |
| `yarn pack`       | `release/win-unpacked/` に展開のみ（インストーラ無し・動作確認用・高速） |
| `yarn dist:win`   | Windows: NSIS インストーラ + ポータブル exe                     |
| `yarn dist:mac`   | macOS: dmg（macOS 上でのみ実行可）                              |
| `yarn dist:linux` | Linux: AppImage（Linux 上でのみ実行可）                         |
| `yarn dist`       | 実行中のプラットフォーム向け既定ターゲット                      |

### 出力先

成果物は **`release/`** に生成されます（`.gitignore` 済み）。

- `release/DMX Console Setup <version>.exe` … NSIS インストーラ（インストール先変更可・ショートカット作成）
- `release/DMX Console <version>.exe` … ポータブル版（インストール不要でそのまま実行）
- `release/win-unpacked/DMX Console.exe` … 展開済み実行ファイル（`yarn pack` の出力）

### 同梱されるファイル

`electron-builder.yml` の `files` で `dist/`, `dist-electron/`, `package.json` のみを asar に同梱します（依存はバンドル済みのため `node_modules` は除外）。

## 7. アプリアイコン（任意）

未設定の場合は Electron 既定アイコンが使われます（ビルドは成功し、警告のみ）。
独自アイコンを使うには `build/` ディレクトリに以下を配置します。

| OS      | ファイル          | 推奨サイズ              |
| ------- | ----------------- | ----------------------- |
| Windows | `build/icon.ico`  | 256×256 を含むマルチ解像度 |
| macOS   | `build/icon.icns` | 512×512 以上            |
| Linux   | `build/icon.png`  | 512×512                 |

`public/favicon.svg` を元に変換して配置すると統一できます。

## 8. クロスプラットフォーム注意

- **Windows の .exe は Windows 上でのみ**確実にビルドできます。
- macOS / Linux 向けは原則それぞれの OS（または CI）でビルドしてください。
- コード署名は未設定です（社内/個人配布向け）。配布時に SmartScreen/Gatekeeper の警告が出ます。署名が必要な場合は証明書を用意し `electron-builder.yml` に追記してください。

## 9. トラブルシューティング

- **初回パッケージ時に時間がかかる**: electron-builder が Electron バイナリをダウンロード・キャッシュします（2 回目以降は高速）。
- **`Please specify author`**: `package.json` の `author` / `description` が必要です（設定済み）。
- **白画面で起動する**: `dist/index.html` の参照が相対パス（`./assets/...`）であることを確認。Vite 8 は既定で相対パス出力のため通常は問題ありません。
- **クリーンビルド**: `dist/`, `dist-electron/`, `release/` を削除してから `yarn build` をやり直してください。
