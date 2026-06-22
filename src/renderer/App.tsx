/**
 * ルートコンポーネント。エンジンからの outputFrame / engineState / project を
 * 購読し、Project・再生・フェーダー・出力モニターを配置する。
 */

import { useEffect, useState } from 'react';
import { SettingsBar } from './components/SettingsBar';
import { ProjectBar } from './components/ProjectBar';
import { PlaybackPanel } from './components/PlaybackPanel';
import { NowNextPanel } from './components/NowNextPanel';
import { ActionPanel } from './components/ActionPanel';
import { TimelineView } from './components/timeline/TimelineView';
import { FaderBank } from './components/FaderBank';
import { OutputMeter } from './components/OutputMeter';
import { useDmxStore } from './store';

type Tab = 'cue' | 'timeline';

export default function App() {
  const setOutput = useDmxStore((s) => s.setOutput);
  const setProject = useDmxStore((s) => s.setProject);
  const setEngineState = useDmxStore((s) => s.setEngineState);
  const [tab, setTab] = useState<Tab>('cue');

  useEffect(() => {
    const offFrame = window.dmx.onOutputFrame((frame) => setOutput(frame));
    const offState = window.dmx.onEngineState((state) => setEngineState(state));
    const offProject = window.dmx.onProject((project) => setProject(project));
    // 初期状態を取得して反映。
    window.dmx.getProject().then(setProject);
    window.dmx.getEngineState().then(setEngineState);
    return () => {
      offFrame();
      offState();
      offProject();
    };
  }, [setOutput, setProject, setEngineState]);

  return (
    <div className="flex h-screen flex-col gap-2 bg-neutral-950 p-2 text-neutral-100">
      <SettingsBar />
      <ProjectBar />

      {/* 本番モードの「現在 / 次の CUE」帯（SHOW 時のみ表示） */}
      <NowNextPanel />

      {/* タブバー：CUE / Timeline を切り替え */}
      <div className="flex items-center gap-1 border-b border-neutral-800">
        <TabButton label="CUE" active={tab === 'cue'} onClick={() => setTab('cue')} />
        <TabButton label="Timeline" active={tab === 'timeline'} onClick={() => setTab('timeline')} />
      </div>

      {/* タブ内容（共通の高さ領域）。CUE はマスター列、Timeline はトランスポート。 */}
      <div className="min-h-0 flex-[2]">
        {tab === 'cue' ? <PlaybackPanel /> : <TimelineView />}
      </div>

      <ActionPanel />
      {/* フェーダーバンク */}
      <div className="min-h-0 flex-[3]">
        <FaderBank />
      </div>
      <OutputMeter />
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px rounded-t px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-b-2 border-sky-500 bg-neutral-900 text-sky-400'
          : 'border-b-2 border-transparent text-neutral-500 hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}
