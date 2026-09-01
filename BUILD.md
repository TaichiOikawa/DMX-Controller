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
> Vite/Rolldown でバンドルされます。**例外は `serialport`（OpenDMX 出力）** で、
> ネイティブモジュール（`.node`）はバンドルできないため実体の同梱が必要です。

### 依存の置き場所（dependencies / devDependencies）

この切り分けはパッケージングの都合で決めています。

| 置き場所          | 対象                                     | 理由                                                     |
| ----------------- | ---------------------------------------- | -------------------------------------------------------- |
| `dependencies`    | `serialport` のみ                        | 配布物へ実体を同梱する必要がある（ネイティブモジュール） |
| `devDependencies` | react, zustand, wavesurfer, lucide 等すべて | Vite がバンドル済みなので同梱不要                        |

electron-builder は `devDependencies` を自動で除外するため、この分け方だけで
「`serialport` とその依存だけが `node_modules` として入る」状態になります。
**新しくライブラリを追加するときは、バンドルされるものを `devDependencies` へ入れてください。**
`dependencies` に入れると配布物が肥大します。

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

`electron-builder.yml` の `files` で `dist/`, `dist-electron/`, `package.json` を asar に同梱します。
加えて `dependencies`（= `serialport` とその依存）が `node_modules/` として入ります。

ネイティブモジュールは asar 内から `dlopen` できないため、`asarUnpack` で
`resources/app.asar.unpacked/` へ展開されます。

```
release/win-unpacked/resources/
├─ app.asar                                     dist / dist-electron / serialport の JS
└─ app.asar.unpacked/node_modules/@serialport/bindings-cpp/prebuilds/…  ネイティブ .node
```

> `serialport` の prebuild は **N-API**（ABI 非依存）のため、Electron 向けの再ビルドは不要です
> （`npmRebuild: false` のままで動作します）。Electron 42 / ABI 146 で確認済み。

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

## 9. DMX 出力（Art-Net / OpenDMX）

出力は **設定 → 接続** から設定します。2 系統は独立に ON/OFF でき、同時出力もできます
（Art-Net でビジュアライザへ送りながら、OpenDMX で実機を鳴らす等）。
**どちらも既定は「無効」**なので、使う方をここで有効にしてください。

| 方式        | 送出経路                    | 備考                                          |
| ----------- | --------------------------- | --------------------------------------------- |
| Art-Net     | UDP 6454                    | 送信先 IP / Universe / Net / Subnet を指定    |
| OpenDMX     | USB シリアル（FTDI）        | ポートを選択。Enttec Open DMX USB 等          |

### OpenDMX を使うには

1. USB-DMX I/F を接続する（FTDI ドライバが必要。多くの環境では自動で入ります）。
2. 設定 → 接続 → **USB-DMX** を「有効」にする。
3. ポート一覧から選ぶ。**★ 印が FTDI 製**で、OpenDMX I/F の可能性が高いポートです。
4. 状態が「送出中 N Hz」になれば送出中です。

補足:

- OpenDMX はマイコンを持たないため、BREAK / MAB / スタートコードをアプリ側で生成します。
- 250kbps では 1 フレーム約 23ms かかるので、**送出レートの物理上限は約 40Hz** です。
  設定 → 接続 の `Rate Hz` をこれ以上に上げても OpenDMX 側は 40Hz 前後で頭打ちになります。
- 抜線・スリープ復帰などで切断された場合、**2 秒間隔で自動的に再接続**を試みます。
- 選択したポートは Project に保存されますが、**ポート名はマシン固有**です
  （別 PC では選び直しが必要）。

## 10. トラブルシューティング

- **初回パッケージ時に時間がかかる**: electron-builder が Electron バイナリをダウンロード・キャッシュします（2 回目以降は高速）。
- **OpenDMX のポート一覧が空**: I/F が接続されていないか、FTDI ドライバが未導入です。
  Windows なら デバイスマネージャー →「ポート (COM と LPT)」に COM ポートが出るか確認してください。
- **「ポートを開けませんでした」**: 他のソフト（別の照明ソフト・シリアルモニタ等）が
  同じ COM ポートを掴んでいると開けません。そちらを閉じてください。
  なお標準の内蔵シリアルポート（COM1 等）は 250kbps 非対応で
  `SetCommState: The parameter is incorrect` になります。FTDI のポートを選んでください。
- **パッケージ版で OpenDMX だけ動かない**: `resources/app.asar.unpacked/` 配下に
  `@serialport/bindings-cpp/prebuilds/` があるか確認してください。無い場合は
  `electron-builder.yml` の `asarUnpack`、または `serialport` が `dependencies` に
  あるかを確認します。
- **`Please specify author`**: `package.json` の `author` / `description` が必要です（設定済み）。
- **白画面で起動する**: `dist/index.html` の参照が相対パス（`./assets/...`）であることを確認。Vite 8 は既定で相対パス出力のため通常は問題ありません。
- **クリーンビルド**: `dist/`, `dist-electron/`, `release/` を削除してから `yarn build` をやり直してください。
