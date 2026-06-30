import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ColorPickerApp } from './ColorPickerApp';
import { MonitorApp } from './MonitorApp';
import './index.css';

// ハッシュで別ウィンドウのルートを切り替える（#picker / #monitor / 既定=メイン）。
const route = window.location.hash.replace(/^#/, '');
const root =
  route === 'picker' ? <ColorPickerApp /> : route === 'monitor' ? <MonitorApp /> : <App />;

createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>);
