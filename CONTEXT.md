# DMX Controller

舞台照明のルックを作成・再生し、最終DMX出力と3Dプレビューを扱うコンテキスト。

## Language

**RGB Fixture**:
3本のDMXチャンネルをRGB色としてまとめ、カラーピッカー操作に使う定義。3D上の形状や位置は持たない。
_Avoid_: Fixture、3D Fixture

**3D Fixture**:
Stage Layout上に配置され、3D Fixture Profileと開始DMXチャンネルを使って見た目を評価する灯体。RGB Fixtureとは独立した概念である。
_Avoid_: Fixture、RGB Fixture、モデル

**3D Fixture Profile**:
3D Fixtureが共有できる、DMX Parameter Binding、可動範囲、静的初期値の定義。3D Fixtureの配置や個体名は含まない。
_Avoid_: Fixture、灯体設定、プリセット

**DMX Parameter Binding**:
Dimmer、RGB、Pan、Tilt、Zoomの各パラメータを、開始DMXチャンネルからのオフセットと8bitまたは16bit解像度へ対応づける定義。
_Avoid_: チャンネル割当、パッチ

**Stage Layout**:
舞台寸法、Project内の3D Fixture Profile、配置済み3D Fixtureから成る3Dプレビューの保存単位。
_Avoid_: Scene、3Dデータ

**CUE**:
DMXチャンネル値とフェード時間を持ち、Showのマスター列またはGROUP内で再生される照明状態。
_Avoid_: シーン、プリセット
