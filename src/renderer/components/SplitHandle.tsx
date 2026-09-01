/**
 * パネル間のドラッグ用スプリッタ（可変レイアウト）。
 *
 * 見た目は細い区切り線で、ホバー/ドラッグ中だけ強調表示する。
 * ドラッグ量（px）はコールバックへ渡すだけで、実際の寸法計算は利用側が行う
 * （比率で持つか px で持つかがパネルごとに異なるため）。
 * ダブルクリックで既定値へ戻す（onReset 指定時）。
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface SplitHandleProps {
  /** 'x' = 縦の区切り（左右の幅を変える） / 'y' = 横の区切り（上下の高さを変える）。 */
  axis: 'x' | 'y';
  /** ドラッグ開始時。利用側は現在の寸法を控えておく。 */
  onStart: () => void;
  /** ドラッグ中。delta はドラッグ開始点からの移動量（px・右/下が正）。 */
  onMove: (delta: number) => void;
  /** ダブルクリック時（既定サイズへ戻す）。 */
  onReset?: () => void;
  title?: string;
}

export function SplitHandle({ axis, onStart, onMove, onReset, title }: SplitHandleProps) {
  const origin = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = axis === 'x' ? e.clientX : e.clientY;
    setDragging(true);
    onStart();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onMove((axis === 'x' ? e.clientX : e.clientY) - origin.current);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title={title ?? 'ドラッグでサイズ変更（ダブルクリックで既定に戻す）'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      className={`group z-10 flex shrink-0 items-center justify-center ${
        axis === 'x' ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize'
      } ${dragging ? 'touch-none select-none' : ''}`}
    >
      <div
        className={`rounded-full transition-colors ${
          axis === 'x' ? 'h-8 w-0.5' : 'h-0.5 w-8'
        } ${dragging ? 'bg-sky-400' : 'bg-neutral-700 group-hover:bg-sky-500/70'}`}
      />
    </div>
  );
}
