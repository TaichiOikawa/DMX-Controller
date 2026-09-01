# コードレビュー: バグ・改善点まとめ

- 実施日: 2026-09-01（対象コミット: `dc63815`）
- 対象: `src/` 全体（engine / main / preload / shared / renderer、約 18,000 行）
- 前提確認: `yarn typecheck` ✅ / `yarn test` 212 件全パス ✅ / `yarn lint` ✅
  （静的チェックはすべてクリーン。以下は目視レビューで見つけた動作上の問題と改善提案）

---

## 1. バグ

### 🔴 高: 修正推奨

#### B1. ✅対応済み（2026-09-01） プロジェクト再読込でメイン音声の音量・ミュート・ソロ・出力デバイスが消える

- 場所: `src/main/projectPaths.ts:78`
- 症状: 音声ファイルをプロジェクトファイルの配下に置いて保存（＝相対パス化）した場合、
  次に開いたときメイン音声の `volume` / `muted` / `solo` / `outputDeviceId` がすべて既定値に戻る。
- 原因: 読込時の絶対パス復元で audio オブジェクトを `filePath` だけで作り直している。

  ```ts
  // 現状: 他のフィールドを破棄してしまう
  show.audio = { filePath: path.resolve(projectDir, filePath) };
  // 修正案
  show.audio = { ...show.audio, filePath: path.resolve(projectDir, filePath) };
  ```

- 補足: 同ファイル内の追加トラックのクリップは `clip.filePath` のみ in-place 更新なので無事。
  `relinkAudioFromFolder` → `Engine.setShowAudio` は `{ ...show.audio, filePath }` と正しく
  スプレッドしており、この関数だけが漏れている。回帰テスト（`projectPaths.test.ts`）の追加も推奨。

#### B2. ✅対応済み（2026-09-01） 「終了」を未保存確認で「キャンセル」してもエンジンが止まったままになる

- 場所: `src/main/index.ts:245-247`（`before-quit`）と `:81-85`（`close` ハンドラ）
- 症状: 未保存変更がある状態でメニュー「ファイル > 終了」（または macOS の Cmd+Q）を押し、
  確認ダイアログで「キャンセル」を選ぶと、ウィンドウは残るが **DMX 出力・自動保存・
  リモートサーバー・OpenDMX がすべて停止したまま** になる。
- 原因: `app.quit()` はウィンドウの `close` イベント（キャンセル可能）より **先に**
  `before-quit` を発火する。そこで `host.stop()` を無条件に呼んでいるため、
  quit が中断されても復旧しない。
- 修正案: `before-quit` でも dirty なら `event.preventDefault()` して確認フローへ回す、
  もしくは `host.stop()` を `will-quit`（キャンセル不能になった後）へ移す。

### 🟡 中

#### B3. ✅対応済み（2026-09-01） 壊れた／手編集された Project ファイルの `actions` と `timeline.points` が未検証のまま通る

- 場所: `src/shared/persistence.ts:272-276`（`normalizeActions`）、`:422-431`（`normalizeTimeline`）
- 症状: 他のフィールド（cues / faders / labels …）は丁寧に正規化しているのに、
  - `actions` は `raw.filter(isObject)` を型キャストするだけ。`steps` が欠けた Action を
    発火・編集すると `Engine.applyActionLook` の `action.steps[0]`（`Engine.ts:1085`）や
    `editCurrentAction` の `action.steps.length`（`Engine.ts:356`）で main プロセスが例外を投げる。
  - `timeline.points` も `as TimelinePoint[]` キャストのみ。`timecodeMs` が文字列や欠落だと
    ソート・`pointsCrossed` が NaN 比較で静かに誤動作する。
- 修正案: 他と同様に `normalizeAction`（steps/values/fadeInMs を補修）と
  `normalizeTimelinePoint`（timecodeMs 数値化・type: 'go' 強制・cueId 文字列検証）を追加。
  「不正・欠落フィールドはデフォルト補完で読込を落とさない」というこのモジュール自身の方針
  （ファイル冒頭コメント）に対する例外になっている。

#### B4. ✅対応済み（2026-09-01） `transportPlay` が再生中の再呼び出しを防いでおらず、音が二重になる

- 場所: `src/renderer/store.ts:757-766`（`transportPlay`）、`src/renderer/App.tsx:382`（`timelinePlay`）
- 症状: 再生中にもう一度 play が呼ばれると `scheduleAll` が既存ソースを止めずに再スケジュール
  され、音声が二重再生になり、`startOffsetSec` / `startCtxTime` の再設定で再生位置も巻き戻る。
- 経路: 同梱リモートクライアントは `timelineToggle`（トグル・ガード付き）しか送らないため
  通常操作では踏まないが、HTTP API `/api/command` は `timelinePlay` を受け付けるので
  認証済みクライアントから任意に起こせる。将来の呼び出し追加でも踏みやすい。
- 修正案: `transportPlay` 冒頭で `if (s.transport.playing) return {};` の冪等ガードを入れる。

#### B5. ✅対応済み（2026-09-01） macOS: ウィンドウを閉じて Dock から再表示すると、以後の未保存確認がスキップされる

- 場所: `src/main/index.ts:25`（`allowClose`）、`:233-235`（`activate`）
- 症状: 未保存確認を一度通過すると `allowClose = true` のままになる。macOS では
  `window-all-closed` 後もアプリが生き、`activate` で `createWindow()` されるため、
  再作成後のウィンドウは dirty でも確認なしで閉じられる。
- 修正案: `createWindow()` 冒頭で `allowClose = false` にリセットする。
  （現状 Windows 運用なら実害はないが、1 行で塞げる）

### 🟢 低

#### B6. ✅対応済み（2026-09-01） Timeline GO ポイントの index ベース API が並び替えと相性が悪い

- 場所: `src/engine/Engine.ts:1298-1330`（`setTimelinePointCue` / `deleteTimelinePoint` /
  `updateTimelinePoint`）、`src/renderer/components/timeline/GoMarkers.tsx:27`（`key={i}`）
- 問題: `addTimelinePoint` / `updateTimelinePoint` は時刻でソートし直すため index が動くのに、
  renderer は配列 index でポイントを特定している。単一ウィンドウの単発操作では
  ソート前に index を掴んでいるので一致するが、複数ウィンドウ（ピッカー等）やリモートと
  並行編集すると **別のポイントを削除／更新** しうる。`key={i}` も並び替えで state が
  別ポイントに引き継がれる典型パターン。
- 修正案: `TimelinePoint` に `id` を持たせて id ベースの API・React key に変更。

#### B7. ✅対応済み（2026-09-01） `Engine.scheduleProjectNotify` が注入タイマーを使っていない

- 場所: `src/engine/Engine.ts:1630-1636`
- 問題: Engine は `setTimeoutFn` / `nowFn` を注入してテスト可能にする設計なのに、
  ここだけ生の `setTimeout` を使用。フェイクタイマーのテストで実時間に漏れるほか、
  `stop()` / `loadProject()` でクリアされないため、破棄直前の通知が遅れて飛ぶ余地がある。
- 修正案: 注入タイマーを使い、`stop()` でクリアする。

#### B8. ✅対応済み（2026-09-01） 空 look の Action を発火すると、進行中の別 Action フェードが破棄される

- 場所: `src/engine/Engine.ts:1091-1094`（`applyActionLook`）
- 問題: `entries.length === 0`（look が空）のとき `faderFade = null` にして return する。
  Action A のフェード取り込み中に空の Action B を押すと、A のフェードが中途半端な位置で
  凍結する。空 look は「何もしない」で返すのが自然。

---

## 2. 改善点

### メモリ・リソース ✅対応済み（2026-09-01）

対応内容: クリップバッファに上限（16 件・アクティブ Show 参照分は保持）と `audioFileStatus` の
参照切れ掃除を追加、未使用トラック gain / 出力バス（AudioContext）を解放、正常保存後に
`.bak` / `recovery.dmxproj` を削除、`will-quit` で `host.stop()` の完了（ポート close 含む）を
待ってから終了（上限 2 秒）。※ リカバリファイルの「復元導線」は未実装のまま（機能追加のため別途）。

- **音声キャッシュの無限成長**: `clipBuffers`（`store.ts:1003`）はデコード済み AudioBuffer
  （1 曲数十 MB になり得る）を無制限に保持。メインバッファは LRU（上限 3）があるのに
  クリップ側にはない。`audioFileStatus`（`store.ts:225`）もプロジェクトを跨いで増え続ける。
  プロジェクト読込時のクリア＋クリップにも上限を推奨。
- **OutputBus（AudioContext）が解放されない**: デバイスごとに `buses` へ追加されるだけで
  `close()` されない（`store.ts:966`）。デバイスを切り替えるたびに AudioContext が溜まり、
  `emitLevels` は使われなくなったバスも毎フレーム解析し続ける。
- **`.bak` / `recovery.dmxproj` の後始末**: 自動バックアップ（`engineHost.ts:684-696`）は
  書くだけで、正常保存後の `.bak` 削除や、次回起動時の「リカバリファイルがあります」導線が
  ない。**クラッシュ対策として書いている recovery.dmxproj を復元する手段が UI に存在しない**
  ので、機能として半分しか完成していない。
- **終了時の `openDmxDriver.stop()` が待たれない**: `engineHost.stop()`（`:263`）で
  `void` 捨てされるため、アプリ終了時にポートの close が完了しない可能性がある。

### パフォーマンス ✅対応済み（2026-09-01）

対応内容: dirty 判定を 300ms の trailing デバウンスへ（`isDirty()` は保留分を同期確定するので
終了確認は取りこぼさない）、engineState ブロードキャストを最短 50ms の leading+trailing
スロットルへ（設定追従・メニュー通知は即時のまま）、メニュー再構築を関連フィールドが
実際に変わったときのみに限定。※ Undo 履歴のフル JSON 保持は実害が薄いためメモのまま。

- **dirty 判定が毎回フル JSON 直列化**: `recomputeDirty`（`engineHost.ts:172-179`）は
  Project 変更通知のたびに全体を `JSON.stringify` して文字列比較する。フェーダードラッグ中は
  スロットル（120ms）越しに毎回走るので、Show が増えるほど main プロセスの負荷が上がる。
  Engine 側に「変更カウンタ（世代番号）」を持たせて比較する方が軽い。
- **`emitState` が即時ブロードキャスト**: コメント上は 250ms 周期に間引く設計
  （`engineHost.ts:53`）だが、それは Hz 更新の相乗りのみで、`engine.onState`（`:142-149`）は
  すべての `emitState`（EDIT でのフェーダー操作 1 回ごと等）を即座に全ウィンドウへ送る。
  512 要素の busking 配列を含むため、状態系もスロットルする余地がある。
- **Undo 履歴がフル JSON × 最大 100 本**: 大きな Project では数十 MB 級になる。
  当面は実害が薄いが、structuredClone + 差分などへの移行余地としてメモ。

### セキュリティ（リモートサーバー）

信頼済み LAN 前提・既定無効という設計は妥当だが、安価に足せる防御がいくつかある:

- **PIN 総当たり対策がない**: `/api/auth`（`remoteServer.ts:177-190`）は 4 桁 PIN
  （1 万通り）を無制限に試せる。失敗回数でクールダウンを入れるだけで実質防げる。
- **トークンが無期限・無上限**: `tokens` は Set に増える一方（認証のたびに追加、失効なし）。
  上限か TTL を推奨。
- **SSE にハートビートがない**: 中間機器に切られた接続の検出が遅れる。定期 `: ping` 送信を推奨。
- `session.setDevicePermissionHandler(() => true)`（`index.ts:186`）は全デバイス種別を許可
  している。setSinkId 用途なら対象を絞れる。

### 設計・一貫性

- **`setShowAudio` / `clearShowAudio` に editable ゲートも Undo もない**（`Engine.ts:1333-1366`）。
  SHOW モード中の再リンクを許すためなら意図的で良いが、`clearShowAudio`（音声解除）は
  破壊的操作なのに Ctrl+Z で戻せない。他のオーサリング系と扱いが揃っていないので、
  意図をコメント化するか `pushUndo` を足すか、どちらかに寄せたい。
- **`applyPanelLayoutForContext` と `resolveProjectAudioPaths` のような「片側だけスプレッド」**
  パターン（B1 参照）は再発しやすい。optional フィールドを持つオブジェクトの部分更新は
  ヘルパ関数に寄せると安全。

### コード衛生

- `console.debug` の残骸: `store.ts` の `loadAudio` / `unloadAudio`（`:824, 830, 858, 884` 付近）。
- `mixer.ts` の冒頭コメントが「マイルストーン 1〜2 では層 1〜3 未実装」のまま古い
  （実際は show 層まで実装済み）。`resolveChannel` の未使用フック
  （`actionControls` / `actionValue`）も、Action を programmer 取り込み方式に統一した今は
  整理してよい。
- `App.tsx` のリモート報告 `JSON.stringify` 比較（`:397-417`）は毎レンダー全 VM を直列化する。
  実害は小さいが、変化検知は依存配列で十分になっている。

---

## 3. 良かった点（維持したい設計）

- Engine を Electron 非依存の純 TS に保ち、UDP 送出・タイマーを注入可能にしてある構成。
  212 件のテストが engine / persistence / driver を広くカバーしている。
- 永続化の防御的正規化（`normalize.ts` + `persistence.ts`）と、出力設定を Project から
  アプリ設定へ分離した判断（レガシー引き継ぎ `adoptLegacyOutputSettings` 付き）。
- OpenDMX ドライバの「最新 1 フレームだけ送る」設計と再接続処理、`this.port === port`
  ガードによる古いループ・古いポートの締め出しは丁寧に書けている。
- 出力デバイスごとの AudioContext + `setSinkId` 方式（レート不整合による速度ズレの回避）。

---

## 推奨対応順

1. B1（音声設定消失）— 1 行修正 + テスト。データ損失系なので最優先。
2. B2（終了キャンセルでエンジン停止）— 本番中に踏むと照明が止まる。
3. B3（破損ファイル検証）・B4（transportPlay ガード）— 小さい修正で堅牢性が上がる。
4. リカバリファイルの復元導線（改善点だが、書いている以上は拾えるようにしたい）。
5. 残りの低優先バグ・改善はまとめて。
