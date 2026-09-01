# DMX照明コンソール 仕様書（実装ハンドオフ用）

> このドキュメントは Claude Code に渡して実装を開始するための仕様書です。
> 設計上の確定事項・合成モデル・データ構造・ロードマップを含みます。
> 末尾「デフォルト前提」の3点は仮決定なので、必要に応じて変更してください。

---

## 1. 概要

DMX512 を出力するステージ照明コンソールのデスクトップアプリ。

- フェーダーによる手動制御
- CUE（シーン）の保存と GO による進行、クロスフェード
- 並列グループ（複数の独立キューリスト）とループ
- Show 単位での CUE 管理、Project に複数 Show
- Timeline によるタイムコード自動進行（音声同期）
- Action ボタンによる最優先オーバーライド

最終成果物: Windows 向け `.exe` アプリ。

---

## 2. 技術スタック / 制約

- **Electron + React + TypeScript**
- ビルド: `electron-vite` 推奨（Vite ベースで main/preload/renderer を扱う）
- 状態管理: Zustand 等（UI 側）。エンジン状態はエンジンが単独管理する
- DMX 出力: **Art-Net**（UDP / Node `dgram`）と **OpenDMX**（USB シリアル / `serialport`）。当面 **1 ユニバース = 512ch**
- パッケージング: `electron-builder` → NSIS インストーラ or ポータブル `.exe`
- 推奨ライブラリ（実装時に最新版・メンテ状況を確認すること）: Art-Net 送信は自前実装でも可（ArtDMX は単純なため）

---

## 3. アーキテクチャ（最重要）

DMX は一定レートで出し続ける必要があり、レンダラ（React）はバックグラウンドでスロットリングされるため、**出力ループを UI 側で回してはいけない**。

```
┌────────────────────────────┐        IPC         ┌──────────────────────────┐
│  Renderer (React UI)       │  ───コマンド───▶   │  Engine (main / utility) │
│  - フェーダー/CUE/Show UI  │                    │  - 全状態の単一ソース    │
│  - 音声再生(HTMLAudio)     │  ◀──状態(間引き)── │  - ~40Hz 出力ループ      │
│  - 出力レベルの可視化      │                    │  - Art-Net 送信          │
└────────────────────────────┘                    └──────────────────────────┘
```

- **エンジン**は `main` プロセス、または `utilityProcess` で隔離して動かす。フェーダー・CUE・フェード進行・キャプチャ・Action の全状態を保持し、毎ティック 512ch のバッファを計算して Art-Net 送信する「単一の真実」。
- **UI** は「フェーダー5を200に」「GO」「Action3押下」等の**意図のみ**を IPC で送る。可視化用の出力レベルはエンジンから **15〜30Hz に間引いて**受け取る（IPC 氾濫防止）。
- **エンジンロジックは Electron 非依存**に実装する（純粋な TS モジュールにし、Node 単体でテスト可能にする）。Electron 依存は I/O 層（IPC・UDP・ファイル）に閉じる。
- 出力ループは `setInterval` + ドリフト補正で **約 40Hz（25ms）**。

---

## 4. DMX 出力（Art-Net / OpenDMX）

- 当面 **1 ユニバース = 512ch**（将来の多ユニバース拡張を型で考慮しておく）
- 値域: 各 ch `0–255`
- 出力ループは ~40Hz。変化が無くてもキープアライブとして送り続けてよい
- **2 系統は独立に ON/OFF でき、同時出力もできる**（Art-Net でビジュアライザ、OpenDMX で実機、など）

### 4.1 Art-Net

- ArtDMX パケットを UDP 6454 へ送出
- **ハード無しでのテスト**: Art-Net ビジュアライザ / ソフトノードで受信確認できるようにする

### 4.2 USB-DMX（OpenDMX / Pico W）

USB シリアル経由の出力は 2 種類あり、設定の `openDmx.kind` で切り替える。
接続管理・自動再接続・レート計測・UI は共通で、**差分は「ポートの開き方」と
「1 フレームの書き方」だけ**。

#### 4.2.1 `kind: 'opendmx'` — Enttec Open DMX USB 等（FTDI ベース）

FTDI ベースの I/F はマイコンを持たないため、DMX の物理フレームをホストが全部組み立てる。

- シリアル設定: **250kbps / 8bit / パリティなし / ストップ 2bit**
- 1 フレーム: `BREAK(>=92µs)` → `MAB(>=12µs)` → `スタートコード(0x00)` → `512ch`
- BREAK は `serialport` の `set({ brk })` トグルで生成する。µs 単位の待ちは作れないが、
  BREAK/MAB は「最小長」の規定なので長い分には問題ない
- **送出レートの物理上限は約 40Hz**（513 バイト × 11bit / 250kbps ≒ 22.6ms/フレーム）。
  エンジンのクロックと送出は分離し、送出側は常に「最新の 1 枚」を出す（積み残しを作らない）
#### 4.2.2 `kind: 'pico'` — Raspberry Pi Pico W のネイティブ USB CDC

自作機（LightingControllSystem）向け。DMX の物理層は Pico 側が作るので、ホストは
CDC の上に独自電文（LCS Serial Protocol v1）で値を渡すだけ。追加ハード不要。

- シリアル設定: **115200 / 8N1**（CDC なのでボーレートは名目値）。VID:PID = `2E8A:000A`
- 1 電文: `A5 5A | type | len_lo | len_hi | payload | cksum`。`len` は LE16、
  `cksum` は type 以降の XOR（初期値 0）。長さで区切るのでバイトスタッフィング不要
- DMX 値の書き込みは `type=0x01`、payload[0] が ch1（スタートコードは載せない）
- 送出は **40Hz（25ms 間隔）**。ファームは 2 秒無通信で `link=0` にするが**出力値は保持する**
- **Art-Net と同時に流さないこと**（後から来た方が勝つ）
- 仕様の全文: `LightingControllSystem/USB_SERIAL_PROTOCOL.md`

#### 4.2.3 共通

- 抜線・オープン失敗はエラー状態として UI に出し、一定間隔で自動再接続する
- ポート名はマシン固有のため、Project に保存はするが可搬ではない
- ポート列挙では VID から種別を推定し（FTDI `0403` → opendmx / Raspberry Pi `2e8a` → pico）、
  UI でポートを選んだ瞬間に `kind` を自動で合わせる

---

## 5. 機能仕様

### 5.1 フェーダー（ベースレイヤー）
- フェーダー 1 本 = 1 DMX チャンネル（**1:1**）。512 本を UI 上でページ/バンク表示
- Show 未読込時は、フェーダー値がそのまま出力される

### 5.2 CUE / GO / フェード
- CUE = チャンネル値のスナップショット。**そのCUEが操作対象とする ch のみ**を保持する
- CUE が指定しない ch は、同グループ内の**直前の値を維持（トラッキング）**
- `GO` で次の CUE へ進む。各 CUE に**フェード時間**（および任意のディレイ）を設定可能
- フェードは tracked 値を old→new で線形補間（毎フレーム再計算）

### 5.3 グループ（並列プレイバック）
- グループ = 独立したキューリスト（順序付き CUE 列）
- グループは**並列に複数**存在できる
- グループ内で**ループ再生**可能
- `GO` は**全グループ一斉**に次 CUE へ進む（手動操作時）
- 同一 ch を複数グループが制御する場合は**グループ間 HTP（最大値）**

### 5.4 Show
- Show は CUE（グループ群）をまとめた単位。Project に複数保存可能
- Show は読込/解放できる。読込中は合成モデル（§6）に従う。未読込時はフェーダー値を出力
- Show は任意で音声データ・Timeline を持てる

### 5.5 Timeline（内部タイムコード・音声同期）
- CUE の GO ポイントをタイムコードで保存したデータ。再生で自動進行
- **時計は Show の音声の再生位置**（内部タイムコード、音声と同期）
- 実装: 音声はレンダラで再生し、playhead を ~30Hz でエンジンへ送る。エンジンは playhead が各ポイントの timecode を跨いだら GO を発火（数 ms の遅延は照明では許容範囲）
- seek / pause / stop に追従すること

### 5.6 Action ボタン（最優先オーバーライド）
- アクティブ中は対象 ch を**最優先で上書き**（HTP もキャプチャも無視）
- 3 モード:
  - `hold-once`: 押している間、1 回再生
  - `hold-loop`: 押している間、ループ再生
  - `press-once`: 押したら 1 回再生
- 解放後は下位レイヤー（キャプチャ / show / フェーダー）に戻る

---

## 6. 合成・優先モデル（コア仕様）

毎フレーム、`ch = 0..511` について以下の優先スタックで出力を決定する。

```
優先度 高 → 低
1. Action オーバーライド層 … アクティブ中はその ch を最優先で上書き
2. 手動キャプチャ層        … captured[ch] なら out = fader[ch]（HTP 無視・上下とも上書き）
3. show 層（グループ間HTP）… どれかのグループが制御中なら max(各グループの tracked[ch])
4. フェーダー基準層        … どの CUE も制御しない ch / show 未読込時
```

擬似コード:

```ts
function resolveChannel(ch: number): number {
  if (actionControls(ch))        return actionValue(ch);      // 1. 最優先
  if (captured[ch])              return faderLive[ch];        // 2. 手動キャプチャ（下げれば下がる）
  if (anyGroupControls(ch))      return htpOverGroups(ch);    // 3. show 層・グループ間HTP
  return faderLive[ch];                                       // 4. 未制御 ch / show未読込
}
```

### 6.1 キャプチャ（手動上書き）
- Show 読込中に、show 制御下の ch のフェーダーを動かすと、その ch が `captured = true` になる
- キャプチャ中は **HTP を無視して fader 値をそのまま出力**（show 値より低くても下がる）

### 6.2 キャプチャ解除
- **次の GO 時**: 新しい CUE が操作対象に含む ch のみ `captured` を落とす。含まない ch は掴んだまま
  - 並列グループがある場合、**いずれか 1 グループでも**その ch を指定していれば解除（→ デフォルト前提 §11-②）
- **リリースボタン**: 手動で `captured` を落とし、CUE 値へ戻す（全 ch 一括 / 選択 ch）

### 6.3 トラッキング
- 各グループは 512ch 分の `tracked` 値を保持
- CUE が指定しない ch は、同グループ内の直前 CUE の値を維持
- 次 CUE へのフェードは `tracked` を old→new で補間し、HTP は毎フレームのライブ値で再計算

---

## 7. データ構造（永続化モデル / TypeScript）

```ts
// ===== Project（最上位・保存単位） =====
interface Project {
  version: number;
  name: string;
  settings: ProjectSettings;
  faders: number[];          // 512 / 0-255。ベースレイヤーの保存値
  actions: ActionButton[];
  shows: Show[];
}

interface ProjectSettings {
  universeCount: number;     // 当面 1
  releaseFadeMs: number;     // リリース時の戻りフェード（デフォルト 0 = 即時 / §11-①）
}

// ===== アプリ設定（Project ではなくアプリ自体に永続化）=====
// 出力先・リモート操作はマシン/現場に紐づくので Project へは保存せず、
// userData/settings.json に置く（実装: src/shared/appSettings.ts）。
interface AppSettings {
  artnet: {
    enabled: boolean;        // Art-Net(UDP) 送出の有効/無効
    targetIp: string;        // 送信先ノード or ブロードキャスト
    universe: number;        // Art-Net universe
    net: number;
    subnet: number;
    refreshRateHz: number;   // ~40（出力ループ全体のレート。OpenDMX にも効く）
  };
  openDmx: {                 // USB-DMX。Art-Net と同時に出せる
    enabled: boolean;
    portPath: string;        // 'COM3' / '/dev/tty.usbserial-XXXX'。空 = 未選択
    kind: 'opendmx' | 'pico';// 出力先の種別。未定義の旧設定は 'opendmx' 扱い
  };
  remote: {                  // リモート操作サーバー（スマホ等）
    enabled: boolean;        // 起動時に自動で listen するか
    port: number;            // 既定 3939
    pin: string;             // 4 桁。再起動しても変わらない
  };
}

// ===== Show =====
interface Show {
  id: string;
  name: string;
  groups: Group[];
  audio?: { filePath: string };  // Project からの相対パス
  timeline?: Timeline;
}

// ===== Group（並列プレイバック / キューリスト） =====
interface Group {
  id: string;
  name?: string;
  cues: Cue[];               // 順序付き
  loop: boolean;             // グループ内ループ
}

// ===== Cue =====
interface Cue {
  id: string;
  name?: string;
  values: Record<number, number>; // 操作対象 ch のみ: chIndex(0-511) -> 値(0-255)
  fadeInMs: number;          // フェード時間
  delayMs?: number;          // フェード前のディレイ
}

// ===== Action ボタン =====
type ActionMode = 'hold-once' | 'hold-loop' | 'press-once';

interface ActionStep {
  values: Record<number, number>;
  fadeInMs: number;
  holdMs?: number;           // チェイス時の各ステップ保持時間
}

interface ActionButton {
  id: string;
  name?: string;
  mode: ActionMode;
  steps: ActionStep[];       // once=単一でも可 / loop=チェイス列
}

// ===== Timeline =====
interface Timeline {
  points: TimelinePoint[];
}

interface TimelinePoint {
  timecodeMs: number;        // 音声内の位置
  groupId?: string;          // 指定すればそのグループのみ GO / 省略で全グループ一斉（§11-③）
  type: 'go';
}
```

---

## 8. エンジン実行時状態（非永続）

```ts
interface GroupRuntime {
  currentIndex: number;
  tracked: number[];         // 512: これまでの CUE で確定した値
  fade: {                    // 進行中フェード（無ければ null）
    from: number[];
    to: number[];
    startMs: number;
    durMs: number;
  } | null;
}

interface EngineRuntime {
  activeShowId: string | null;
  groups: Record<string, GroupRuntime>;
  captured: boolean[];       // 512
  faderLive: number[];       // 512: 現在のフェーダー位置
  activeActions: string[];   // 押下中の ActionButton id
  output: number[];          // 512: 直近の計算済みフレーム
}
```

---

## 9. エンジン API / IPC 契約

**UI → Engine（コマンド）**
- `loadShow(showId)` / `unloadShow()`
- `go()` … 全グループ一斉 GO
- `goGroup(groupId)` … 任意（Timeline 内部でも使用）
- `setFader(ch, value)` … show 制御下の ch なら captured=true にする
- `releaseCapture(channels?)` … 省略で全解除
- `actionDown(actionId)` / `actionUp(actionId)`
- `timelinePlay()` / `timelinePause()` / `timelineStop()` / `timelineSeek(ms)`
- `reportAudioPlayhead(ms)` … レンダラの音声再生位置（~30Hz）
- `captureCueFromFaders(groupId, opts)` … 現在のフェーダー状態から CUE を作成（オーサリング）
- `saveProject()` / `loadProject(path)`

**Engine → UI（イベント・~30Hz に間引き）**
- `outputFrame(number[512])` … 可視化用
- `state` … 各グループの現在 CUE、captured ch、timeline 再生位置 等

---

## 10. 永続化

- Project ファイル形式は当面 **JSON**（規模が増えたら SQLite へ移行検討）
- 音声ファイルは Project フォルダ内に同梱し、相対パス参照
- `version` フィールドで将来のマイグレーションに備える

---

## 11. デフォルト前提（仮決定・要確認）

実装を止めないため以下を仮決定。必要なら変更可。

1. **リリース時の戻り方**: `releaseFadeMs` で設定可能。**デフォルト 0（即スナップ）**。滑らかにしたい場合は短いフェードを設定
2. **GO 時のキャプチャ解除判定**: 並列グループのうち**いずれか 1 グループでも**その ch を指定していれば解除
3. **Timeline のターゲット**: `TimelinePoint.groupId` を**省略すると全グループ一斉 GO**、指定するとそのグループのみ GO

---

## 12. 開発ロードマップ

1. **基盤**: electron-vite で Electron+React+TS 雛形 / IPC 設計 / Art-Net 出力 PoC（ハード無し・ビジュアライザで検証）
2. **エンジン + フェーダー**: 512ch モデル / フェーダー→出力 / 40Hz 出力ループ（ドリフト補正）/ 合成基盤
3. **CUE**: CUE データ / フェーダーからのキャプチャ作成 / GO / クロスフェードエンジン / 保存・読込
4. **グループ / 並列再生**: 複数キューリスト / グループ間 HTP / ループ
5. **Show 管理**: Project/Show 構造 / 読込・解放 / フェーダーとの合成（§6）
6. **キャプチャ + リリース + Action**: 手動キャプチャ / リリースボタン / Action 3 モード（最優先層）
7. **Timeline + 音声**: 内部 TC / 音声再生 / playhead 同期 / CUE 自動発火
8. **パッケージング**: electron-builder で `.exe` 化

---

## 13. 確定事項サマリ

- 出力: Art-Net / OpenDMX（独立に ON/OFF・同時出力可）、1 ユニバース = 512ch
- 制御単位: チャンネル単位（フィクスチャ/パッチ概念なし）、フェーダー 1 本 = 1ch
- GO: 全グループ一斉、グループ間は HTP 合成
- CUE: 操作対象 ch のみ保持、非指定 ch はトラッキング
- 合成優先度: Action（最優先） > 手動キャプチャ > show(HTP) > フェーダー
- キャプチャ: HTP 無視の上書き（下げれば下がる）。次 GO で「新 CUE が含む ch」のみ解除、リリースボタンで手動解除
- Timeline: 内部タイムコード、音声の再生位置に同期
