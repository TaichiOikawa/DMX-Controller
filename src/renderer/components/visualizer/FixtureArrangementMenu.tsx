import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ArrangementAxis, ArrangementMode } from './multiSelection';

export function FixtureArrangementMenu({ x, y, count, onClose, onArrange, onGroup, grouped }: {
  x: number; y: number; count: number;
  onClose(): void;
  onArrange(axis: ArrangementAxis, mode: ArrangementMode): void;
  onGroup(): void;
  grouped: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return <div ref={menu} role="menu" aria-label="灯体の整列・均等配置"
    className="fixed z-50 w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 p-1 text-xs shadow-xl"
    style={{ left: x, top: y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { onClose(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
    <p className="px-3 py-2 text-slate-400">{count}台を選択中</p>
    <button role="menuitem" type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-800 focus:bg-cyan-800 focus:outline-none"
      onClick={() => { onGroup(); onClose(); }}>{grouped ? 'グループ解除' : 'グループ化'}</button>
    {(['align', 'distribute'] as const).map(mode => <div key={mode} className="border-t border-slate-700 py-1">
      <p className="px-3 py-1 text-slate-400">{mode === 'align' ? '選択範囲の中心に揃える' : '両端を固定して等間隔にする（3台以上）'}</p>
      {(['x', 'y', 'z'] as const).map(axis => <button key={axis} role="menuitem" type="button"
        disabled={mode === 'distribute' && count < 3}
        className="block w-full rounded px-3 py-2 text-left hover:bg-cyan-800 focus:bg-cyan-800 focus:outline-none disabled:opacity-40"
        onClick={() => { onArrange(axis, mode); onClose(); }}>
        {axis.toUpperCase()}{mode === 'align' ? '整列' : '均等配置'}
      </button>)}
    </div>)}
  </div>;
}
