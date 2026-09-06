/** 3D Fixture Profile と最終DMXフレームから表示パラメータを評価する純粋関数群。 */

import {
  UNIVERSE_SIZE,
  createDefaultStrobeSettings,
  createDefaultStaticFixtureParameters,
  type DmxParameterBinding,
  type StaticFixtureParameters,
  type VisualizerFixture,
  type VisualizerFixtureProfile,
  type VisualizerParameter,
} from './types';

export interface VisualizerDisplayState {
  parameters: StaticFixtureParameters;
  intensity: number;
  color: { red: number; green: number; blue: number };
}

/** Profileが参照する最大0-basedオフセット。未割当なら -1。 */
export function maxVisualizerBindingOffset(profile: VisualizerFixtureProfile): number {
  let max = -1;
  for (const binding of Object.values(profile.bindings)) {
    max = Math.max(
      max,
      binding.coarseOffset,
      binding.resolution === '16bit' ? binding.fineOffset : -1,
    );
  }
  return max;
}

/** 開始CHとProfileの全割当が1ユニバース内に収まるかを返す。 */
export function isVisualizerStartChannelValid(
  startChannel: number | undefined,
  profile: VisualizerFixtureProfile,
): boolean {
  if (startChannel === undefined) return true;
  return (
    Number.isInteger(startChannel) &&
    startChannel >= 0 &&
    startChannel + maxVisualizerBindingOffset(profile) < UNIVERSE_SIZE
  );
}

/** 1パラメータを0..1へ評価する。CH未割当・不足時は undefined。 */
export function evaluateDmxBinding(
  binding: DmxParameterBinding | undefined,
  startChannel: number | undefined,
  outputFrame: readonly number[],
): number | undefined {
  if (!binding || startChannel === undefined) return undefined;
  const coarse = dmxAt(outputFrame, startChannel + binding.coarseOffset);
  if (coarse === undefined) return undefined;
  if (binding.resolution === '8bit') return coarse / 255;
  const fine = dmxAt(outputFrame, startChannel + binding.fineOffset);
  return fine === undefined ? undefined : (coarse * 256 + fine) / 65535;
}

/** 3D FixtureのDMX割当値と静的値を合成し、表示用の物理パラメータへ変換する。 */
export function evaluateVisualizerFixture(
  profile: VisualizerFixtureProfile,
  fixture: VisualizerFixture,
  outputFrame: readonly number[],
  timeMs = 0,
): VisualizerDisplayState {
  const parameters = { ...fixture.staticParameters };
  for (const parameter of VISUALIZER_PARAMETERS) {
    const normalized = evaluateDmxBinding(
      profile.bindings[parameter],
      fixture.startChannel,
      outputFrame,
    );
    if (normalized === undefined) continue;
    parameters[parameter] = toParameterValue(parameter, normalized, profile);
  }

  const maxColor = Math.max(parameters.red, parameters.green, parameters.blue);
  const strobeGate = evaluateStrobeGate(
    parameters.strobe,
    timeMs,
    profile.strobeSettings.maxFrequencyHz,
  );
  return {
    parameters,
    intensity: parameters.dimmer * maxColor * strobeGate,
    color:
      maxColor === 0
        ? { red: 0, green: 0, blue: 0 }
        : {
            red: parameters.red / maxColor,
            green: parameters.green / maxColor,
            blue: parameters.blue / maxColor,
          },
  };
}

/** 共通ライブラリを初回作成するときの編集可能な4プロファイル。 */
export function createInitialVisualizerProfiles(): VisualizerFixtureProfile[] {
  const fixed = {
    panRangeDeg: { min: -270, max: 270 },
    tiltRangeDeg: { min: -135, max: 135 },
    zoomRangeDeg: { min: 5, max: 45 },
    strobeSettings: createDefaultStrobeSettings(),
    defaultStaticParameters: createDefaultStaticFixtureParameters(),
  };
  return [
    {
      ...structuredClone(fixed),
      id: 'builtin-dimmer-1ch',
      name: 'Dimmer 1ch',
      bindings: { dimmer: { resolution: '8bit', coarseOffset: 0 } },
    },
    {
      ...structuredClone(fixed),
      id: 'builtin-rgb-3ch',
      name: 'RGB 3ch',
      bindings: {
        red: { resolution: '8bit', coarseOffset: 0 },
        green: { resolution: '8bit', coarseOffset: 1 },
        blue: { resolution: '8bit', coarseOffset: 2 },
      },
    },
    {
      ...structuredClone(fixed),
      id: 'builtin-rgb-dimmer-4ch',
      name: 'RGB + Dimmer 4ch',
      bindings: {
        dimmer: { resolution: '8bit', coarseOffset: 0 },
        red: { resolution: '8bit', coarseOffset: 1 },
        green: { resolution: '8bit', coarseOffset: 2 },
        blue: { resolution: '8bit', coarseOffset: 3 },
      },
    },
    {
      ...structuredClone(fixed),
      id: 'builtin-rgb-moving-head-9ch',
      name: 'RGB Moving Head 9ch',
      bindings: {
        pan: { resolution: '16bit', coarseOffset: 0, fineOffset: 1 },
        tilt: { resolution: '16bit', coarseOffset: 2, fineOffset: 3 },
        dimmer: { resolution: '8bit', coarseOffset: 4 },
        red: { resolution: '8bit', coarseOffset: 5 },
        green: { resolution: '8bit', coarseOffset: 6 },
        blue: { resolution: '8bit', coarseOffset: 7 },
        zoom: { resolution: '8bit', coarseOffset: 8 },
      },
    },
  ];
}

const VISUALIZER_PARAMETERS: VisualizerParameter[] = [
  'dimmer',
  'red',
  'green',
  'blue',
  'strobe',
  'pan',
  'tilt',
  'zoom',
];

/** 0は連続点灯、0より大きい値は1Hz〜指定上限・デューティ比50%の点滅として評価する。 */
export function evaluateStrobeGate(
  strobe: number,
  timeMs: number,
  maxFrequencyHz = 20,
): 0 | 1 {
  if (strobe <= 0) return 1;
  const maximumHz = Number.isFinite(maxFrequencyHz) ? Math.max(1, maxFrequencyHz) : 20;
  const frequencyHz = 1 + Math.min(1, strobe) * (maximumHz - 1);
  const phase = Math.floor((Math.max(0, timeMs) / 1000) * frequencyHz * 2);
  return phase % 2 === 0 ? 1 : 0;
}

function toParameterValue(
  parameter: VisualizerParameter,
  normalized: number,
  profile: VisualizerFixtureProfile,
): number {
  if (parameter === 'pan') return lerp(profile.panRangeDeg, normalized);
  if (parameter === 'tilt') return lerp(profile.tiltRangeDeg, normalized);
  if (parameter === 'zoom') return lerp(profile.zoomRangeDeg, normalized);
  if (parameter === 'strobe') {
    const start = Math.min(255, Math.max(0, profile.strobeSettings.startValue)) / 255;
    if (normalized < start) return 0;
    if (start >= 1) return Number.EPSILON;
    return Math.max(Number.EPSILON, (normalized - start) / (1 - start));
  }
  return normalized;
}

function lerp(range: { min: number; max: number }, value: number): number {
  return range.min + (range.max - range.min) * value;
}

function dmxAt(frame: readonly number[], channel: number): number | undefined {
  const value = frame[channel];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(255, Math.round(value)));
}
