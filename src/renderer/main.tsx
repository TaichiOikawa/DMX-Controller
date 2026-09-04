import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ColorPickerApp } from './ColorPickerApp';
import { LazyVisualizerApp } from './LazyVisualizerApp';
import { MonitorApp } from './MonitorApp';
import './index.css';

// ハッシュで別ウィンドウのルートを切り替える（#picker / #monitor / 既定=メイン）。
const route = window.location.hash.replace(/^#/, '');
const root =
  route === 'picker' ? (
    <ColorPickerApp />
  ) : route === 'monitor' ? (
    <MonitorApp />
  ) : route === 'visualizer' ? (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">3D Visualizerを読み込み中…</div>}>
      <LazyVisualizerApp />
    </Suspense>
  ) : (
    <App />
  );

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>);
