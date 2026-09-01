# プロジェクト概要 — DMX Console

DMX512 を出力するステージ照明コンソールのデスクトップアプリ（Electron / Windows 向け `.exe`）。
フェーダーによる手動制御、CUE の保存と GO による進行、音声同期の Timeline 自動進行、
セットリストによる本番進行、スマホからの遠隔操作までを 1 アプリで扱う。

- リポジトリ: `C:\Users\hebim\Desktop\DMX-Controller`
- バージョン: `0.4.6` / 作者: TaichiOikawa
- 現在のブランチ: `feature/opendmx`（OpenDMX 出力の追加が完了した状態）
- 関連ドキュメント: [`dmx-console-spec.md`](./dmx-console-spec.md)（仕様書）、[`BUILD.md`](./BUILD.md)（ビルド手順）
  ※ `README.md` は Vite テンプレートの初期内容のまま

---

## 1. 技術スタック

| 領域 | 採用技術 |
| --- | --- |
| デスクトップ基盤 | Electron 42（contextIsolation 有効・nodeIntegration 無効） |
| ビルド | Vite 8 + `vite-plugin-electron`（main は ESM、preload は CJS `.cjs` 出力） |
| UI | React 19（React Compiler 有効）+ TypeScript 6 + Tailwind CSS 4 + lucide-react |
| 状態管理（UI） | Zustand |
| 音声 | Web Audio API（デバイス別 AudioContext + `setSinkId`）+ wavesurfer.js（波形描画） |
| DMX 出力 | Art-Net（Node `dgram` / 自前 ArtDMX エンコード）、USB-DMX（`serialport`: OpenDMX / Pico W CDC） |
| テスト | Vitest（Node 環境・17 ファイル / 212 テスト・全 pass） |
| 配布 | electron-builder（Windows: NSIS + portable / mac: dmg / linux: AppImage） |

依存の置き場所には方針がある。Vite がバンドルするもの（React 等）は `devDependencies` に置き、
electron-builder に自動除外させる。`dependencies` はネイティブモジュールで実体同梱が必要な
`serialport` のみ。

---

## 2. アーキテクチャ

DMX は一定レートで出し続ける必要があり、レンダラはバックグラウンドでスロットリングされるため、
**出力ループは UI 側では回さない**。エンジンが全状態の単一ソースになる。

```
┌────────────────────────────┐        IPC        ┌────────────────────────────┐
│ Renderer (React)           │ ──コマンド──▶     │ main プロセス               │
│  - フェーダー / CUE / Show  │                   │  Engine（純粋 TS・単一の真実）│
│  - Timeline UI / 音声再生   │ ◀─状態(~30Hz)──   │   ~40Hz 出力ループ           │
│  - 出力レベル可視化         │                   │  EngineHost（I/O 層）         │
└────────────────────────────┘                   │   UDP / serialport / fs      │
                                                 └────────────────────────────┘
```

- **Engine（`src/engine/`）** … Electron 非依存の純粋 TS。UDP 送信は `send`、生 512ch 出力は
  `sendDmx` として注入され、タイマーも `Clock` 経由で差し替え可能なので Node 単体でテストできる。
- **EngineHost（`src/main/engineHost.ts`）** … Electron / Node 依存を閉じ込める I/O 層。
  `dgram` での ArtDMX 送出、`ipcMain` でのコマンド受け、Project の保存/読込、
  出力フレームの **~30Hz（33ms）間引き転送**を担当。
- **Renderer** … 「フェーダー 5 を 200 に」「GO」等の**意図のみ**を IPC で送り、状態は購読して描画する。
  例外は音声で、再生はレンダラ（Web Audio）が持ち、playhead をエンジンへ報告する。
- **出力ループ** … `setInterval` ではなく「次に起きるべき絶対時刻」基準の `setTimeout` 再計算による
  ドリフト補正クロック（`src/engine/clock.ts`）。既定 40Hz。

---

## 3. ディレクトリ構成

```
src/
├── engine/         Electron 非依存のコア（全てユニットテストあり）
│   ├── Engine.ts       エンジン本体（~1700行）。状態保持・tick・コマンド実装・Undo/Redo
│   ├── mixer.ts        合成・優先スタック（§6）
│   ├── playback.ts     トラッキング / クロスフェード / マスター列の順送り（純関数）
│   ├── clock.ts        ドリフト補正 tick ループ
│   ├── artnet.ts       ArtDMX パケットのエンコード
│   └── timeline.ts     playhead が跨いだポイントの判定
├── main/           Electron main（I/O 層）
│   ├── index.ts        BrowserWindow ライフサイクル / サブウィンドウ / 権限設定
│   ├── engineHost.ts   Engine 生成・IPC・UDP・ファイル I/O
│   ├── openDmx.ts      USB-DMX 送出ドライバ（OpenDMX の BREAK/MAB 生成 / Pico の LCS 電文・自動再接続）
│   ├── remoteServer.ts / remoteClient.ts  スマホ遠隔操作（HTTP + SSE / 単一 HTML）
│   ├── projectPaths.ts 音声パスの相対 ⇄ 絶対変換
│   └── menu.ts         アプリメニュー構築
├── preload/index.ts    contextBridge で型付き `window.dmx` を公開
├── renderer/       React UI
│   ├── App.tsx / store.ts（Zustand）/ MonitorApp.tsx（別窓）/ ColorPickerApp.tsx（別窓）
│   └── components/     FaderBank, PlaybackPanel, SetlistPanel, ActionPanel,
│                       ProjectSidebar, PreferencesModal, timeline/*  ほか
└── shared/         main / renderer / engine 共有
    ├── types.ts        永続化モデル + 実行時状態の型
    ├── ipc.ts          IPC チャンネル定数（Cmd / Evt）とペイロード型
    └── persistence.ts  Project ⇄ JSON とマイグレーション（fs には触れない）
```

---

## 4. コアモデル

### 4.1 合成・優先スタック（`mixer.ts`）

毎フレーム、ch = 0..511 について次の優先度で出力値を決める。

```
1. Action オーバーライド層  … フック残置（現在は未使用。下記参照）
2. busking 層               … SHOW モードのライブ上書き。HTP 無視で faderLive をそのまま出力
3. show 層                  … Show が GO 済みかつ controlled[ch] なら tracked[ch]
4. フェーダー基準層          … 未制御 ch / Show 未読込時は faderLive
```

最終出力にはグランドマスター（0-255 の乗算）とブラックアウトが掛かる。

### 4.2 再生モデル（仕様書からの重要な変更）

仕様書 §5.3 は「並列グループ（複数の独立キューリスト）」だったが、**実装は単一マスター列 +
単一プレイヘッド**に変更されている。

- `Show.sequence` は `SequenceEntry[]`（`{kind:'cue'}` か `{kind:'group'}` の判別共用体）
- GO は 1 本のプレイヘッド（`mainIndex` / `subIndex`）を順送りする。並列再生はない
- GROUP に入ると子 CUE を 1 つずつ進む。`loop` は自動送りでの折り返し、GO はループを抜けて次エントリへ
- 子 CUE の `followMs` を設定すると、SHOW モードで発火後その時間で次の子 CUE へ自動送り
- CUE は**操作対象 ch のみ**を保持し、指定しない ch は直前の値を維持（トラッキング）
- フェードは In / Out を別時間で持て（`fadeInMs` / `fadeOutMs`）、`delayMs` で開始を遅らせられる

### 4.3 キャプチャ → CUE 先行フローへの変更

仕様書のオレンジ色「キャプチャ」概念は廃止済み（コミット `452773d`）。現在は 2 モード制。

- `edit` … CUE オーサリング。CUE 選択中はフェーダー操作が**選択 CUE へリアルタイム書き込み**され、
  未選択ならライブ直接出力（保存なし）。Action も選択すれば同様に look へ書き込む
- `show` … 作成系の編集を全ブロック。フェーダー操作は busking（保存されない一時上書き）

### 4.4 データモデル（`src/shared/types.ts`）

```
Project
├── settings { universeCount, releaseFadeMs }   ※出力設定は Project に持たない（下記アプリ設定）
├── faders[512] / channelLabels / bankLabels
├── folders[]        Show 整理用フォルダ（単層）
├── fixtures[]       RGB フィクスチャ（R/G/B 3ch を 1 色として束ねる）
├── actions[]        単一 look（steps[0] のみ使用。モード/チェイスは廃止）
├── setlists[]       Show を順序付きで束ね、マスター GO で 1 Show ずつ進める
└── shows[]
     ├── sequence[]  CUE / GROUP の判別共用体
     ├── audio       メイン音声（volume/muted/solo/outputDeviceId）
     └── timeline    { points[]（timecodeMs → GO or 特定 CUE へ goTo）, audioTracks[3] }
```

- 永続化は JSON（`version` でマイグレーション）。音声パスはメモリ上は常に絶対、
  **保存時のみ Project ファイル配下なら相対（POSIX 区切り）**に落として可搬性を確保
- 追加オーディオトラックは固定 3 本。各トラックに複数クリップを任意位置へ配置でき、
  トラック単位で音量 / ミュート / ソロ / 出力デバイスを持つ

### 4.5 アプリ設定（`src/shared/appSettings.ts` / `src/main/appSettingsStore.ts`）

出力先やリモート操作は「その PC・その現場」に紐づくため、**Project ファイルには保存しない**。
`userData/settings.json`（Windows: `%APPDATA%/<app>/settings.json`）に別途永続化する。

```
AppSettings
├── artnet  { enabled, targetIp, universe, net, subnet, refreshRateHz }
├── openDmx { enabled, portPath, kind }   kind: 'opendmx'(FTDI) | 'pico'(Pico W CDC)
└── remote  { enabled, port, pin }    起動時に enabled なら自動で listen、PIN も固定
```

- 変更は 400ms デバウンスで書き出し、終了時に `flush()` で確定する
- Engine は Project の読込・Undo/Redo で出力設定を**書き換えない**（アプリ設定が唯一の真実）
- 旧フォーマット（Project 内に `settings.artnet` を持つ）は、設定ファイル未作成の初回起動で
  最初に開いた Project からのみ一度だけ引き継ぐ（`extractLegacyOutputSettings`）

---

## 5. DMX 出力

Art-Net と USB-DMX は独立に ON/OFF でき、同時出力もできる（Art-Net でビジュアライザ、
USB-DMX で実機、など）。ただし **Pico W は Art-Net も受けるので併用しないこと**。
当面 1 ユニバース = 512ch。

### Art-Net

- ArtDMX を UDP 6454 へ送出。エンコードは自前実装（`src/engine/artnet.ts`）
- 既定は `127.0.0.1` / universe 0 / 40Hz
- 検証は Art-Net ビジュアライザで行う（`scripts/artnet-listen.mjs` は補助ツール）

### USB-DMX（`openDmx.kind` で 2 種類を切り替え）

**`opendmx` — Enttec Open DMX USB 等 / FTDI ベース**

- ホストが物理フレームを全部作る: `BREAK(≧92µs)` → `MAB(≧12µs)` → スタートコード `0x00` → 512ch
- シリアルは 250kbps / 8bit / パリティなし / ストップ 2bit。BREAK は `port.set({ brk })` のトグルで生成
- 250kbps では 1 フレーム約 23ms かかるため**送出レートの物理上限は約 40Hz**

**`pico` — Raspberry Pi Pico W のネイティブ USB CDC（LCS Serial Protocol v1）**

- DMX の物理層は Pico 側が作るので、BREAK も 250kbaud も不要。115200 / 8N1 で開く
- CDC の上に独自電文を乗せる: `A5 5A | type | len(LE16) | payload | XOR cksum`
- DMX 値は `type=0x01` / payload[0] = ch1（スタートコードは載せない）。40Hz で送り続ける
- **Art-Net とは併用しない**（後から来た方が勝つ）。仕様は `LightingControllSystem/USB_SERIAL_PROTOCOL.md`

**共通**

- Engine のクロックとは分離し、`setFrame()` は最新フレームを上書きするだけ、
  送出ループは常に「最新の 1 枚」を出す（積み残しを作らない）
- `serialport` はネイティブモジュールなのでバンドルせず動的 import。読み込み失敗時も
  Art-Net は動き続けるよう例外は status に落とす。抜線時は状態を UI に出して自動再接続
- ポート列挙は VID から種別を推定（`0403`→opendmx / `2e8a`→pico）し、UI の選択時に自動で合わせる

---

## 6. 主な機能

**再生・操作**
- 512ch のフェーダー（1 本 = 1ch、バンク/ページ表示、ラベル付与可）
- GO / GO BACK / HOLD（フェード途中停止）/ 任意 CUE への goTo、キーボード操作対応
- グランドマスター、ブラックアウト（DBO）
- Action ボタン（単一 look をフェード付きで programmer へ取り込む）
- セットリスト（Show を並べ、マスター GO で「Show 読込 + Timeline 再生」を 1 つずつ進行）
- SHOW モード用の「現在 / 次の CUE」帯（歌詞・メモ表示）

**Timeline / 音声**
- 内部タイムコードで CUE を自動発火。メイン音声 + 追加 3 トラック（クリップ配置・波形表示）
- トラックごとの音量 / ミュート / ソロ / **出力デバイス選択**
- 音声レベルは別ウィンドウ「音量モニター」でピーク + RMS 表示

**編集・プロジェクト**
- Undo / Redo（Project スナップショット履歴・最大 100、連続フェーダー編集はバースト結合）
- 未保存保護（dirty 表示・終了確認・自動バックアップ）、Show の import / export、歌詞 export
- 音声ファイル欠損の検出と再リンク、フォルダによる Show 整理
- RGB フィクスチャ定義 + 別ウィンドウのカラーピッカー

**遠隔操作**
- 同一 LAN のスマホブラウザから操作（`src/main/remoteServer.ts`）。
  状態配信は SSE、コマンドは POST。ページは外部依存なしの単一 HTML
- 平文 HTTP + 4 桁 PIN の簡易認証。**既定は無効**で、設定で明示的に有効化したときだけ listen する
- コマンドは renderer 経由で処理される（セットリスト / Timeline の状態がレンダラ側にあるため）

---

## 7. 開発・ビルド

```bash
yarn install
yarn dev        # Vite + Electron ホットリロード
yarn typecheck  # tsc -b
yarn lint       # eslint
yarn test       # vitest run（16 files / 200 tests）
yarn run pack   # electron-builder --dir（展開ビルド）
yarn dist:win   # NSIS インストーラ + ポータブル exe → release/
```

> `yarn pack` は Yarn 4 組み込みコマンドが優先されるため、展開ビルドは必ず `yarn run pack` を使う。

electron-builder は `dist/`（renderer）、`dist-electron/`（main + preload）、`package.json` のみを同梱。
`asar: true` だが、ネイティブモジュールは asar 内から dlopen できないため
`**/*.node` と `@serialport/bindings-cpp` を `asarUnpack` している。`npmRebuild: false`
（serialport の prebuild は N-API なので Electron 向け再ビルド不要）。

---

## 8. 実装上の注意点

- エンジンロジックに Electron 依存を持ち込まない（I/O は `main/` 側へ）
- IPC 氾濫防止のため、renderer への転送は間引く（outputFrame 33ms、OpenDMX 実測 Hz は 250ms 周期）
- 音声パスとシリアルポート名、オーディオ出力デバイス ID は**マシン固有で非可搬**
- Art-Net の検証はノード側リスナーではなくビジュアライザで行う（ループバック束縛の都合）
- wavesurfer は幅 0（非表示タブ）で生成すると canvas を描かないため、
  `timeline/utils.ts` の `onceVisible()` を経由してマウントする
