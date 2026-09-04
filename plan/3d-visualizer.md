# 独立3Dフィクスチャービジュアライザー実装計画

## Summary

既存の `RgbFixture` とは完全に独立した3DフィクスチャーシステムをProjectへ追加する。

3Dフィクスチャーは再利用可能なプロファイルと開始DMXチャンネルを持ち、`Dimmer / RGB / Pan / Tilt / Zoom` の各パラメータをDMX出力または灯体固有の静的値から決定する。複数の3Dフィクスチャーが同じチャンネルを自由に参照できる。

## Data Model and Persistence

- `Project.version` を2へ更新し、任意の `stageLayout` を追加する。

```ts
interface StageLayout {
  widthM: number;
  depthM: number;
  heightM: number;
  profiles: VisualizerFixtureProfile[];
  fixtures: VisualizerFixture[];
}

type VisualizerParameter =
  | 'dimmer'
  | 'red'
  | 'green'
  | 'blue'
  | 'pan'
  | 'tilt'
  | 'zoom';

type DmxParameterBinding =
  | { resolution: '8bit'; coarseOffset: number }
  | { resolution: '16bit'; coarseOffset: number; fineOffset: number };

interface VisualizerFixtureProfile {
  id: string;
  name: string;
  bindings: Partial<Record<VisualizerParameter, DmxParameterBinding>>;
  panRangeDeg: { min: number; max: number };
  tiltRangeDeg: { min: number; max: number };
  zoomRangeDeg: { min: number; max: number };
  defaultStaticParameters: StaticFixtureParameters;
}

interface VisualizerFixture {
  id: string;
  name: string;
  profileId: string;
  startChannel?: number;
  positionM: Vector3;
  mountRotationDeg: Vector3;
  staticParameters: StaticFixtureParameters;
}
```

- `startChannel` とオフセットは保存時0-based、UIではCH1–512とプロファイルスロット1–Nで表示する。
- プロファイル内に割当済みパラメータがある場合、開始CHと最大オフセットが512ch内に収まらない変更は確定させない。
- 同じプロファイルと開始CHを複数の3Dフィクスチャーが使用することを許可する。
- 既存 `Project.fixtures?: RgbFixture[]` は変更しない。3D側からID参照せず、名称変更・CH変更・削除も互いに影響しない。
- v1 Projectは、空のStage Layoutとして読み込む。既存RGB Fixtureからの3D灯体生成や移行は行わない。
- 不正な寸法、数値、プロファイル参照、チャンネル範囲を正規化・検証する。

## Profiles and Parameter Evaluation

- 共通プロファイルライブラリを `userData/visualizer-fixture-profiles.json` に保存する。
- 共通ライブラリからProjectへの取込と、Projectプロファイルの共通ライブラリへの「別名で保存」を提供する。
- コピー時に新しいIDを発行し、コピー後は同期しない。
- 使用中のProjectプロファイルは削除禁止とし、参照中の灯体数を表示する。
- 共通ライブラリの編集はUndo/Redo対象外とし、削除前に確認する。

初期ライブラリには編集可能な4プロファイルを登録する。

- Dimmer 1ch：Dimmer `+0`
- RGB 3ch：Red `+0`、Green `+1`、Blue `+2`
- RGB＋Dimmer 4ch：Dimmer `+0`、Red `+1`、Green `+2`、Blue `+3`
- RGB Moving Head 9ch：Pan coarse/fine `+0/+1`、Tilt coarse/fine `+2/+3`、Dimmer `+4`、RGB `+5/+6/+7`、Zoom `+8`

Moving Headテンプレートの初期物理範囲はPan `-270〜270°`、Tilt `-135〜135°`、Zoom `5〜45°` とする。静的初期値はDimmer 100%、RGB白、Pan/Tilt 0°、Zoom 25°とする。

パラメータ評価は以下に統一する。

- 8bit：`channel / 255`
- 16bit：`(coarse * 256 + fine) / 65535`
- Pan/Tilt/Zoom：正規化値をプロファイルの最小・最大へ線形変換する。最小値を最大値より大きく設定すれば反転として機能する。
- CH割当済みパラメータはEngineの最終 `outputFrame` を使用する。
- 未割当パラメータは3Dフィクスチャー固有の静的値を使用する。
- 割当を解除した場合に備え、割当中も静的値は保持する。
- 照射方向は設置XYZ回転に、ローカルPan回転とTilt回転を順に合成する。
- Zoomはビームの全開き角として扱う。
- 表示強度は `Dimmer × max(R,G,B)`、表示色は最大RGB成分で正規化する。

## Visualizer and Editing UI

- `#visualizer` の独立Electronウィンドウを単一インスタンスで追加する。
- Fader Bankのボタンと「表示」メニューから開き、開いていれば前面化する。
- Art-Netは受信せず、既存の最終DMXフレーム購読を利用する。
- 3D灯体はProjectプロファイルと開始CHを選択して直接作成する。「未配置RGB Fixture一覧」は設けない。
- 複製はプロファイル、開始CH、静的値、設置回転を引き継ぎ、新しいIDと連番名を発行してX方向へ0.5mずらす。
- 灯体名は `<Profile Name> #<連番>` を初期値とし、個別に変更可能とする。
- Profile Managerに「共通ライブラリ」と「Project」のタブを用意し、コピー、作成、編集、削除を行う。
- 灯体Inspectorでプロファイル、開始CH、位置、設置回転、静的パラメータを編集する。
- 選択中灯体についてのみ、名前、使用CH、解釈後パラメータ値を表示する。

## Dedicated Undo/Redo

- Engine内に既存履歴とは独立したStage Layout専用履歴を設ける。
- 編集モード開始時に空のUndo/Redoスタックを作成し、終了時に破棄する。
- 履歴上限は100件とする。
- 以下のProject内3D操作をすべて履歴化する。
  - 舞台寸法
  - 3D灯体の作成、複製、削除、改名
  - 位置、設置回転、静的パラメータ
  - プロファイル割当、開始CH
  - Projectプロファイルの作成、コピー、編集、削除
  - DMXバインディング、解像度、物理範囲
- 数値入力はEnterまたはフォーカス移動による項目確定を1操作とし、入力中のキーごとには記録しない。
- 新しい編集後はRedoスタックを破棄する。
- 既存Project Undo/Redoは、復元時に現在のStage Layoutを保持する。
- 3D専用Undo/RedoはStage Layoutだけを復元し、既存RGB Fixture、CUE、Show、フェーダーなどを変更しない。
- 共通プロファイルライブラリは専用履歴へ含めない。
- `Ctrl+Z`・`Ctrl+Y` はビジュアライザーの編集モード中かつ入力欄へフォーカスしていない場合だけ専用履歴へ割り当てる。

## 3D Rendering

- React 19対応の `@react-three/fiber` v9、Three.js、OrbitControlsを使用する。[公式の対応表](https://r3f.docs.pmnd.rs/getting-started/installation)
- 舞台初期寸法は10m×8m×5m。床面中央を原点とし、X=客席から見て右、Y=上、Z=舞台奥とする。
- 床、背景、1mグリッド、汎用灯体形状、半透明ビーム円錐、床面照射マーカーを描画する。
- 灯体、ビーム、マーカーはインスタンス描画し、最大170台を対象にする。
- 実SpotLight、影、煙シミュレーション、Gobo、3Dモデル取込はv1対象外とする。
- カメラは回転・パン・ズームと、正面・上面・斜め・全体表示を提供する。
- 最後のカメラ視点はProjectに含めず、端末ローカルへ保存する。
- WebGLが利用できない場合は、Profile Managerと数値編集UIを残してエラーを表示する。

## Documentation

- `CONTEXT.md` に `RGB Fixture`、`3D Fixture`、`3D Fixture Profile`、`DMX Parameter Binding`、`Stage Layout`、`CUE` を定義する。
- `RGB Fixture` と `3D Fixture` が別概念であることを明記し、曖昧な `Fixture` 単独表記を避ける。
- ADR 0001に、既存RGB Fixtureから3Dモデルを完全分離し、パラメータバインディング方式を採用する判断を記録する。
- ADR 0002に、Stage Layout履歴を既存Project履歴から分離する判断を記録する。
- 利用ガイドへ、プロファイル管理、CH割当、静的値、共有CH、編集モード、専用Undo/Redoを追記する。
- 既存の未コミット文書変更は保全する。

## Test Plan

- v1 Projectから空Stage Layoutへの移行とv2保存・再読込。
- 既存RGB Fixtureの追加・変更・削除が3Dデータへ影響しないこと。
- 複数3D灯体が同一プロファイル・開始CHを共有し、同じDMX値を参照すること。
- 未割当、8bit、16bit、反転範囲、最大オフセット、CH512境界の評価。
- DMX値と静的値の切替、Pan/Tilt合成、Zoom、Dimmer×RGB計算。
- 共通・Project間コピー後の独立性と、使用中Projectプロファイルの削除禁止。
- 全Project内3D操作のUndo/Redo、Redo破棄、編集モード終了時の履歴破棄。
- 既存UndoがStage Layoutを変更せず、3D Undoが既存Projectデータを変更しないこと。
- 別窓再利用、ライブ出力、ショートカット、カメラ保存、WebGL失敗表示。
- 1080pの開発機で170台を表示し、30fps以上かつ操作・DMX更新に目立つ遅延がないこと。
- `yarn test`、`yarn typecheck`、`yarn lint`、`yarn build` を通す。
