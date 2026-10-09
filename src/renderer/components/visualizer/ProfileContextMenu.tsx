import { useEffect, useLayoutEffect, useRef } from 'react';

export function ProfileContextMenu({ x, y, onClose, onDuplicate }: { x: number; y: number; onClose(): void; onDuplicate(): void }) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  return <div ref={menu} role="menu" aria-label="プロファイル操作" style={{ left: x, top: y }}
    className="fixed z-[60] w-44 rounded-lg border border-slate-600 bg-slate-900 p-1 text-xs shadow-xl"
    onContextMenu={event => event.preventDefault()} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') onClose(); }}>
    <button role="menuitem" className="w-full rounded px-3 py-2 text-left hover:bg-cyan-800 focus:bg-cyan-800" onClick={() => { onClose(); onDuplicate(); }}>複製</button>
  </div>;
}
