/**
 * Action ボタン（§5.6）。最優先オーバーライド層。
 * - press-once: クリックで1回再生（自動解除）
 * - hold-once / hold-loop: 押している間アクティブ（離すと解除）
 *
 * オーサリング: 「＋Action」で現在のキャプチャ中フェーダーを1stepとして作成。
 * 各 Action は mode 変更 / ＋Step（チェイス用）/ 削除ができる。
 */

import type { ActionButton, ActionMode } from '../../shared/types';
import { useDmxStore } from '../store';

const MODE_LABEL: Record<ActionMode, string> = {
  'press-once': '1回',
  'hold-once': '押下',
  'hold-loop': 'ループ',
};

export function ActionPanel() {
  const project = useDmxStore((s) => s.project);
  const activeActionIds = useDmxStore((s) => s.activeActionIds);
  const capturedCount = useDmxStore((s) => s.captured.reduce((n, b) => (b ? n + 1 : n), 0));

  const actions = project?.actions ?? [];

  return (
    <div className="flex items-stretch gap-2 rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800">
      <div className="flex flex-col justify-between">
        <span className="text-[11px] font-semibold text-sky-400">Action</span>
        <button
          onClick={() => window.dmx.addAction()}
          disabled={capturedCount === 0}
          className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
          title="キャプチャ中のフェーダーから Action を作成"
        >
          ＋Action
        </button>
      </div>

      <div className="flex flex-1 gap-2 overflow-x-auto">
        {actions.length === 0 ? (
          <div className="flex items-center px-2 text-[11px] text-neutral-600">
            フェーダーを動かして「＋Action」で作成
          </div>
        ) : (
          actions.map((a) => (
            <ActionCard key={a.id} action={a} active={activeActionIds.includes(a.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function ActionCard({ action, active }: { action: ActionButton; active: boolean }) {
  const hold = action.mode !== 'press-once';

  const triggerProps = hold
    ? {
        onMouseDown: () => window.dmx.actionDown(action.id),
        onMouseUp: () => window.dmx.actionUp(action.id),
        onMouseLeave: () => window.dmx.actionUp(action.id),
      }
    : { onClick: () => window.dmx.actionDown(action.id) };

  return (
    <div className="flex w-32 shrink-0 flex-col gap-1 rounded bg-neutral-800/40 p-1.5 ring-1 ring-neutral-800">
      <button
        {...triggerProps}
        className={`select-none rounded py-3 text-sm font-bold transition-colors ${
          active
            ? 'bg-amber-500 text-neutral-900'
            : 'bg-neutral-700 text-neutral-100 hover:bg-neutral-600'
        }`}
        title={hold ? '押している間アクティブ' : 'クリックで1回再生'}
      >
        {action.name ?? 'Action'}
      </button>

      <div className="flex items-center gap-1">
        <select
          value={action.mode}
          onChange={(e) => window.dmx.updateAction(action.id, { mode: e.target.value as ActionMode })}
          className="flex-1 rounded bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-200 outline-none"
        >
          {(Object.keys(MODE_LABEL) as ActionMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <button
          onClick={() => window.dmx.deleteAction(action.id)}
          className="rounded px-1 text-[11px] text-neutral-500 hover:bg-red-900/50 hover:text-red-300"
          title="Action 削除"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span>{action.steps.length} step</span>
        <button
          onClick={() => window.dmx.addActionStep(action.id)}
          className="rounded px-1 text-sky-300 hover:bg-neutral-700"
          title="現在のキャプチャを step として追加（チェイス）"
        >
          ＋Step
        </button>
      </div>
    </div>
  );
}
