import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ColorPickerApp } from './ColorPickerApp';
import './index.css';

// 別ウィンドウ（#picker）では RGB カラーピッカーのみを描画する。
const isPicker = window.location.hash.replace(/^#/, '') === 'picker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPicker ? <ColorPickerApp /> : <App />}</StrictMode>,
);
