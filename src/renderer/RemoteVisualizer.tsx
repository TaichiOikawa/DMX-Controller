import { useEffect, useState } from 'react';
import type { StageLayout } from '../shared/types';
import { StageScene } from './components/visualizer/StageScene';
import { loadRenderQuality, normalizeRenderQuality, saveRenderQuality } from './components/visualizer/renderQuality';

export function RemoteVisualizer() {
  const [token, setToken] = useState(() => localStorage.getItem('dmxRemoteToken') ?? '');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('接続中…');
  const [connected, setConnected] = useState(false);
  const [stage, setStage] = useState<StageLayout | null>(null);
  const [frame, setFrame] = useState<number[]>([]);
  const [quality, setQuality] = useState(loadRenderQuality);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    const events = new EventSource(`/api/visualizer/events?token=${encodeURIComponent(token)}`);
    events.onopen = () => { setConnected(true); setMessage(''); };
    events.addEventListener('stage', event => setStage(JSON.parse(event.data)));
    events.addEventListener('frame', event => setFrame(JSON.parse(event.data)));
    events.onerror = () => {
      setConnected(false);
      setMessage('接続が切れました。再接続中…');
      void fetch('/api/ping', { headers: { 'x-token': token } }).then(response => {
        if (!disposed && response.status === 401) {
          localStorage.removeItem('dmxRemoteToken');
          setToken('');
          setStage(null);
          setMessage('PIN を入力して接続してください');
        }
      }).catch(() => {});
    };
    return () => { disposed = true; events.close(); };
  }, [token]);

  if (!token) return (
    <form style={{ height: '100dvh', display: 'grid', placeContent: 'center', gap: 16 }} onSubmit={event => {
      event.preventDefault();
      void fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      }).then(async response => {
        if (!response.ok) throw new Error(response.status === 429 ? 'しばらく待って再接続してください' : 'PIN が違います');
        const data = await response.json();
        localStorage.setItem('dmxRemoteToken', data.token);
        setToken(data.token);
        setMessage('接続中…');
      }).catch(error => setMessage(error.message));
    }}>
      <h1 style={{ fontSize: 20 }}>3D プレビュー</h1>
      <input aria-label="PIN" placeholder="PIN" inputMode="numeric" maxLength={4} value={pin} onChange={event => setPin(event.target.value)} style={{ fontSize: 28, width: 180 }} />
      <button type="submit">接続</button>
      <span role="status">{message}</span>
      <a href="/" style={{ color: '#bae6fd' }}>リモート操作へ</a>
    </form>
  );

  return (
    <main style={{ width: '100vw', height: '100dvh', position: 'relative' }} aria-label="3D プレビュー">
      {stage && <StageScene stage={stage} outputFrame={frame} selectedFixtureId={null} onSelectFixture={() => {}} showGrid={false} quality={quality} />}
      <label style={{ position: 'absolute', bottom: 'max(16px, env(safe-area-inset-bottom))', left: 'max(16px, env(safe-area-inset-left))', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#080b12cc', fontSize: 14 }}>
        プレビュー品質
        <select value={quality} onChange={event => {
          const next = normalizeRenderQuality(event.target.value);
          setQuality(next);
          saveRenderQuality(next);
        }} style={{ minHeight: 36, padding: '4px 8px', borderRadius: 6, border: '1px solid #475569', background: '#1e293b', color: '#e5e5e5', fontSize: 16 }}>
          <option value="low">低（軽量）</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
      </label>
      {(!connected || !stage) && <div role="status" style={{ position: 'absolute', top: 16, left: 16, padding: 12, background: '#080b12cc' }}>{message || 'ステージ情報を待っています…'}</div>}
    </main>
  );
}
