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
- DMX 出力: **Art-Net**（UDP / Node `dgram`）。当面 **1 ユニバース = 512ch**
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

## 4. DMX / Art-Net

- 当面 **1 ユニバース = 512ch**（将来の多ユニバース拡張を型で考慮しておく）
- ArtDMX パケットを ~40Hz で送出。変化が無くてもキープアライブとして送り続けてよい
- 値域: 各 ch `0–255`
- **ハード無しでのテスト**: Art-Net ビジュアライザ / ソフトノードで受信確認できるようにする

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
  artnet: {
    targetIp: string;        // 送信先ノード or ブロードキャスト
    universe: number;        // Art-Net universe
    net: number;
    subnet: number;
    refreshRateHz: number;   // ~40
  };
  releaseFadeMs: number;     // リリース時の戻りフェード（デフォルト 0 = 即時 / §11-①）
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

- 出力: Art-Net、1 ユニバース = 512ch
- 制御単位: チャンネル単位（フィクスチャ/パッチ概念なし）、フェーダー 1 本 = 1ch
- GO: 全グループ一斉、グループ間は HTP 合成
- CUE: 操作対象 ch のみ保持、非指定 ch はトラッキング
- 合成優先度: Action（最優先） > 手動キャプチャ > show(HTP) > フェーダー
- キャプチャ: HTP 無視の上書き（下げれば下がる）。次 GO で「新 CUE が含む ch」のみ解除、リリースボタンで手動解除
- Timeline: 内部タイムコード、音声の再生位置に同期
