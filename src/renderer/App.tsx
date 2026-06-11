/**
 * ルートコンポーネント。エンジンからの outputFrame / engineState / project を
 * 購読し、Project・再生・フェーダー・出力モニターを配置する。
 */

import { useEffect } from 'react';
import { SettingsBar } from './components/SettingsBar';
import { ProjectBar } from './components/ProjectBar';
import { PlaybackPanel } from './components/PlaybackPanel';
import { FaderBank } from './components/FaderBank';
import { OutputMeter } from './components/OutputMeter';
import { useDmxStore } from './store';

export default function App() {
  const setOutput = useDmxStore((s) => s.setOutput);
  const setProject = useDmxStore((s) => s.setProject);
  const setEngineState = useDmxStore((s) => s.setEngineState);

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
      {/* 上段: 再生パネル（並列グループ） */}
      <div className="min-h-0 flex-[2]">
        <PlaybackPanel />
      </div>
      {/* 下段: フェーダーバンク */}
      <div className="min-h-0 flex-[3]">
        <FaderBank />
      </div>
      <OutputMeter />
    </div>
  );
}
