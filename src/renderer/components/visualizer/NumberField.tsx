import { useContext, useEffect, useRef, useState } from 'react';
import { createNumberScrub } from './numberScrub';
import { NumberGestureContext } from './NumberGestureContext';

interface NumberFieldProps {
  label?: string;
  value: number | '';
  onCommit(value: number | '', edit?: { delta: number }): void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  disabled?: boolean;
  immediate?: boolean;
  integer?: boolean;
  placeholder?: string;
  scrubValue?: number;
}

export function NumberField({ label, value, onCommit, min, max, step = 1, allowEmpty = false, disabled = false, immediate = false, integer = false, placeholder, scrubValue }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [observedValue, setObservedValue] = useState(value);
  const [scrubbing, setScrubbing] = useState(false);
  const transaction = useContext(NumberGestureContext);
  const gesture = useRef<{ pointerId: number; last: number; started: boolean; finish?: () => void; scrub: ReturnType<typeof createNumberScrub> } | null>(null);
  const skipBlurCommit = useRef(false);
  // Keep the input mounted and preserve intermediate text such as "1.".
  if (value !== observedValue) {
    setObservedValue(value);
    if ((draft.trim() === '' ? '' : Number(draft)) !== value) setDraft(String(value));
  }
  useEffect(() => () => { gesture.current?.scrub.stop(); gesture.current?.finish?.(); }, []);
  const clamp = (number: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number));
  const apply = (text: string, finish = false) => {
    if (text.trim() === '') {
      if (allowEmpty) { if (value !== '') onCommit(''); }
      else if (finish) setDraft(String(value));
      return;
    }
    const number = Number(text);
    if (!Number.isFinite(number)) { if (finish) setDraft(String(value)); return; }
    const next = clamp(integer ? Math.round(number) : number);
    // Permit partially typed out-of-range numbers; normalize only on blur.
    if (!finish && next !== number) return;
    if (finish) setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const stopGesture = (element: HTMLInputElement) => {
    const current = gesture.current;
    if (!current) return;
    current.scrub.stop();
    gesture.current = null;
    if (current.started) { skipBlurCommit.current = true; setDraft(String(value)); current.finish?.(); }
    setScrubbing(false);
    if (element.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId);
  };
  const input = <input type="number" value={draft} placeholder={placeholder} min={min} max={max} step={step} disabled={disabled}
    title={immediate ? '長押しして左右にドラッグで値を変更（Shiftで微調整）' : undefined}
    style={{ cursor: scrubbing ? 'ew-resize' : undefined, userSelect: scrubbing ? 'none' : undefined, touchAction: immediate ? 'pan-y' : undefined }}
    onChange={event => { skipBlurCommit.current = false; setDraft(event.target.value); if (immediate && !event.target.validity.badInput) apply(event.target.value); }}
    onBlur={event => { stopGesture(event.currentTarget); if (!skipBlurCommit.current) apply(event.currentTarget.value, true); skipBlurCommit.current = false; }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { stopGesture(event.currentTarget); setDraft(String(value)); }
    }}
    onPointerDown={event => {
      if (!immediate || event.button !== 0 || disabled) return;
      stopGesture(event.currentTarget);
      const element = event.currentTarget;
      const pointerId = event.pointerId;
      const number = draft.trim() === '' ? (scrubValue ?? Number(value)) : Number(draft);
      const initial = Number.isFinite(number) ? clamp(number) : 0;
      const current = { pointerId, last: initial, started: false, finish: transaction?.finish, scrub: createNumberScrub({
        x: event.clientX, value: Number.isFinite(number) ? clamp(number) : 0, step, min, max, integer,
        onActivate: () => {
          if (gesture.current !== current || !element.isConnected) return;
          current.started = true;
          transaction?.begin();
          element.setPointerCapture(pointerId);
          setScrubbing(true);
        },
      }) };
      gesture.current = current;
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const next = current.scrub.move(event.clientX, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      setDraft(String(next));
      const delta = Number((next - current.last).toFixed(6));
      current.last = next;
      if (delta !== 0) onCommit(next, { delta });
    }}
    onPointerUp={event => stopGesture(event.currentTarget)}
    onPointerCancel={event => stopGesture(event.currentTarget)}
    onLostPointerCapture={event => stopGesture(event.currentTarget)}
    onPointerLeave={event => { if (!gesture.current?.scrub.active) stopGesture(event.currentTarget); }}
    onContextMenu={event => { if (scrubbing) event.preventDefault(); }}
    className={`mt-1 w-full rounded border bg-slate-900 px-2 py-1 font-mono text-slate-100 disabled:opacity-40 ${scrubbing ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-700'}`} />;
  return label ? <label className="block text-slate-400">{label}{input}</label> : input;
}
