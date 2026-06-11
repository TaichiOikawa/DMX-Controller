/**
 * ルートコンポーネント。エンジンからの outputFrame / engineState を購読し、
 * 設定バー・フェーダーバンク・出力モニターを配置する。
 */

import { useEffect } from 'react';
import { SettingsBar } from './components/SettingsBar';
import { FaderBank } from './components/FaderBank';
import { OutputMeter } from './components/OutputMeter';
import { useDmxStore } from './store';

export default function App() {
  const setOutput = useDmxStore((s) => s.setOutput);
  const setMeasuredHz = useDmxStore((s) => s.setMeasuredHz);

  useEffect(() => {
    const offFrame = window.dmx.onOutputFrame((frame) => setOutput(frame));
    const offState = window.dmx.onEngineState((state) => setMeasuredHz(state.measuredHz));
    // 初期状態を取得して反映。
    window.dmx.getEngineState().then((state) => setMeasuredHz(state.measuredHz));
    return () => {
      offFrame();
      offState();
    };
  }, [setOutput, setMeasuredHz]);

  return (
    <div className="flex h-screen flex-col gap-3 bg-neutral-950 p-3 text-neutral-100">
      <SettingsBar />
      <div className="min-h-0 flex-1">
        <FaderBank />
      </div>
      <OutputMeter />
    </div>
  );
}
