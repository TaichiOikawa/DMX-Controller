import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DmxBridge, EngineStateSnapshot } from '../shared/ipc';
import { createDefaultProject, type StageLayout } from '../shared/types';
import { createDefaultVisualizerProfileLibrary } from '../shared/visualizerProfiles';
import { VisualizerApp } from './VisualizerApp';
import './index.css';

const library = createDefaultVisualizerProfileLibrary();
const profile = structuredClone(library.profiles[0]);
profile.bindings.strobe = { resolution: '8bit', coarseOffset: 1 };
profile.strobeSettings = { startValue: 11, maxFrequencyHz: 20 };
const stage: StageLayout = {
  widthM: 10,
  depthM: 8,
  heightM: 5,
  profiles: [profile],
  fixtures: [
    {
      id: 'fixture-browser-test',
      name: 'Browser Test Fixture',
      profileId: profile.id,
      startChannel: 0,
      positionM: { x: 0, y: 2.5, z: 3 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: structuredClone(profile.defaultStaticParameters),
    },
  ],
};
const project = createDefaultProject();
project.stageLayout = stage;
const emptyEngineState = {
  canStageLayoutUndo: false,
  canStageLayoutRedo: false,
} as EngineStateSnapshot;
const unsubscribe = () => {};
const outputFrame = new Array(512).fill(0);
outputFrame[0] = 255;
outputFrame[1] = 10;
const outputListeners = new Set<(frame: number[]) => void>();
const projectListeners = new Set<(next: typeof project) => void>();

function setTestStrobeDmxValue(value: number) {
  outputFrame[1] = value;
  for (const listener of outputListeners) listener(outputFrame.slice());
}

const dmxMock = {
  beginStageLayoutEdit() {},
  endStageLayoutEdit() {},
  getEngineState: async () => emptyEngineState,
  getProject: async () => project,
  getVisualizerProfileLibrary: async () => library,
  onEngineState: () => unsubscribe,
  onOutputFrame: (listener) => {
    outputListeners.add(listener);
    queueMicrotask(() => listener(outputFrame.slice()));
    return () => outputListeners.delete(listener);
  },
  onProject: listener => { projectListeners.add(listener); return () => projectListeners.delete(listener); },
  setStageLayout(next) { project.stageLayout = next; },
  setVisualizerProfileLibrary: async (next) => next,
  stageLayoutRedo() {},
  stageLayoutUndo() {},
} satisfies Pick<
  DmxBridge,
  | 'beginStageLayoutEdit'
  | 'endStageLayoutEdit'
  | 'getEngineState'
  | 'getProject'
  | 'getVisualizerProfileLibrary'
  | 'onEngineState'
  | 'onOutputFrame'
  | 'onProject'
  | 'setStageLayout'
  | 'setVisualizerProfileLibrary'
  | 'stageLayoutRedo'
  | 'stageLayoutUndo'
>;

window.dmx = dmxMock as unknown as DmxBridge;

export function VisualizerSelectionTest() {
  const [strobeDmxValue, setStrobeDmxValue] = useState(10);
  const isSteady = strobeDmxValue < profile.strobeSettings.startValue;
  return (
    <>
      <VisualizerApp />
      <div className="fixed bottom-3 left-3 z-50 rounded border border-cyan-700 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl">
        <button className="mb-2 rounded bg-slate-700 px-2 py-1" onClick={() => {
          const current = project.stageLayout!;
          project.stageLayout = { ...current, fixtures: current.fixtures.map((fixture, index) => index === 0 ? { ...fixture, profileId: fixture.profileId === profile.id ? 'missing-profile-test' : profile.id } : fixture) };
          for (const listener of projectListeners) listener({ ...project });
        }}>Test Profile参照切替</button>
        <label className="flex items-center gap-2">
          <span>Test Strobe DMX</span>
          <input
            aria-label="Test Strobe DMX"
            className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1"
            type="number"
            min={0}
            max={255}
            value={strobeDmxValue}
            onChange={(event) => {
              const next = Math.min(255, Math.max(0, Number(event.currentTarget.value)));
              setStrobeDmxValue(next);
              setTestStrobeDmxValue(next);
            }}
          />
        </label>
        <div className={isSteady ? 'mt-1 text-emerald-300' : 'mt-1 text-amber-300'}>
          {isSteady ? '常時点灯' : 'ストロボ'}（開始値 11 / 最大 20Hz）
        </div>
      </div>
    </>
  );
}

const root = createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
root.render(
  <StrictMode>
    <VisualizerSelectionTest />
  </StrictMode>,
);
