/**
 * Action ボタン（§5.6）。最優先オーバーライド層。
 *
 * 表示（App がレイアウトを制御）:
 *   - big: Show 未読込時。CUE/Timeline を隠した領域を占有して大きく表示。
 *   - 通常（strip）: SHOW × Show 読込時。横スクロールの帯。
 *   - 折りたたみ（bar）: EDIT × Show 読込時の既定。細いバー＋展開ボタン。
 *
 * カードのメインボタン:
 *   - SHOW × Show 読込: 発火（press-once=look へ動かし保持 / hold=押下中）
 *   - それ以外（EDIT、または Show 未読込）: look を programmer（フェーダー）へキャプチャ
 * 編集対象の選択は右下の小さな ✎ ボタン（EDIT のみ）。フェーダー操作が選択 look へ書かれる。
 * Action は全 Show で共通。
 */

import { ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, TrendingUp, X } from 'lucide-react';
import type { ActionButton } from '../../shared/types';
import { useDmxStore } from '../store';
import { InlineText } from './InlineText';

export function ActionPanel({ big = false }: { big?: boolean }) {
  const project = useDmxStore((s) => s.project);
  const editingActionId = useDmxStore((s) => s.editingActionId);
  const liveFaderCount = useDmxStore((s) => s.faders.reduce((n, v) => (v > 0 ? n + 1 : n), 0));
  const editable = useDmxStore((s) => s.mode === 'edit');
  const released = useDmxStore((s) => s.activeShowId === null);
  const collapsed = useDmxStore((s) => s.actionsCollapsed);
  const toggleCollapsed = useDmxStore((s) => s.toggleActionsCollapsed);
  const actionFadeMs = useDmxStore((s) => s.actionFadeMs);
  const setActionFadeMs = useDmxStore((s) => s.setActionFadeMs);

  const actions = project?.actions ?? [];

  // 折りたたみ（big でないときのみ）: 細いバー＋展開ボタン。
  if (!big && collapsed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-1.5 ring-1 ring-neutral-800">
        <button
          onClick={toggleCollapsed}
          className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-neutral-700"
          title="Action を展開"
        >
          <ChevronRight size={13} /> Action
        </button>
        <span className="text-[11px] text-neutral-500">{actions.length} 個</span>
        {editable && (
          <button
            onClick={() => {
              toggleCollapsed();
              window.dmx.addAction();
            }}
            className="ml-auto inline-flex items-center gap-0.5 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700"
            title="空の Action を追加して作り込む"
          >
            <Plus size={11} /> Action
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800 ${
        big ? 'flex h-full flex-col gap-2' : 'flex flex-col gap-2'
      }`}
    >
      {/* ヘッダ */}
      <div className="flex items-center gap-2">
        {!big && (
          <button
            onClick={toggleCollapsed}
            className="inline-flex items-center rounded bg-neutral-800 px-1.5 py-1 text-neutral-200 hover:bg-neutral-700"
            title="Action を折りたたむ"
          >
            <ChevronDown size={14} />
          </button>
        )}
        <span className="text-[11px] font-semibold text-sky-400">Action</span>
        {editable && (
          <button
            onClick={() => window.dmx.addAction()}
            className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700"
            title="空の Action を追加して選択（フェーダーで look を作り込む）"
          >
            <Plus size={11} /> Action
          </button>
        )}
        <span className="text-[10px] text-neutral-600">
          {editable
            ? '✎ で編集対象を選び、フェーダーで作成'
            : released
              ? 'クリックで look をフェーダーへ取り込み'
              : 'クリックで発火'}
        </span>

        {/* フェードボタンの取り込み時間（秒）。 */}
        <label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-400" title="フェードボタンの取り込み時間（秒）">
          <span>フェード</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={(actionFadeMs / 1000).toString()}
            onChange={(e) => setActionFadeMs((Number(e.target.value) || 0) * 1000)}
            className="w-14 rounded bg-neutral-900 px-1 py-0.5 text-right text-[11px] text-neutral-200 outline-none"
          />
          <span>秒</span>
        </label>
      </div>

      {/* カード列。big は折り返してフィル、通常は横スクロール。 */}
      <div
        className={
          big
            ? 'flex flex-1 flex-wrap content-start gap-2 overflow-y-auto'
            : 'flex gap-2 overflow-x-auto'
        }
      >
        {actions.length === 0 ? (
          <div className="flex items-center px-2 text-[11px] text-neutral-600">
            {editable ? '「＋Action」で追加し、フェーダーで作り込む' : 'Action はありません'}
          </div>
        ) : (
          actions.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              selected={editingActionId === a.id}
              editable={editable}
              released={released}
              big={big}
              liveFaderCount={liveFaderCount}
              fadeMs={actionFadeMs}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ActionCard({
  action,
  selected,
  editable,
  released,
  big,
  liveFaderCount,
  fadeMs,
}: {
  action: ActionButton;
  selected: boolean;
  editable: boolean;
  released: boolean;
  big: boolean;
  liveFaderCount: number;
  fadeMs: number;
}) {
  const triggerMode = !editable && !released; // SHOW × Show 読込時のみ発火、ほかはキャプチャ
  const chCount = Object.keys(action.steps[0]?.values ?? {}).length;

  // メイン（即時）とフェード取り込み。発火 / キャプチャいずれも look を取り込んで保持。
  const apply = (ms: number): void => {
    if (triggerMode) window.dmx.actionDown(action.id, ms);
    else window.dmx.captureAction(action.id, ms);
  };
  const fadeSec = (fadeMs / 1000).toString();

  return (
    <div
      className={`flex shrink-0 flex-col gap-1 rounded bg-neutral-800/40 p-1.5 ring-1 ${
        selected ? 'ring-sky-500' : 'ring-neutral-800'
      } ${big ? 'w-40' : 'w-32'}`}
    >
      {/* メインボタンを 3:2 に分割。左=即時、右=フェード取り込み。 */}
      <div className="flex gap-px">
        <button
          onClick={() => apply(0)}
          className={`flex-[3] select-none rounded-l font-bold transition-colors ${
            big ? 'py-5 text-base' : 'py-3 text-sm'
          } bg-neutral-700 text-neutral-100 hover:bg-neutral-600`}
          title={
            triggerMode
              ? 'クリックでフェーダーをこの look へ即時で動かして保持'
              : 'クリックで look をフェーダーへ取り込み（キャプチャ）'
          }
        >
          {action.name || 'Action'}
        </button>
        <button
          onClick={() => apply(fadeMs)}
          className={`flex flex-[2] select-none items-center justify-center gap-0.5 rounded-r font-bold transition-colors ${
            big ? 'py-5 text-xs' : 'py-3 text-[11px]'
          } bg-sky-700 text-sky-50 hover:bg-sky-600`}
          title={`${fadeSec} 秒かけてこの look へフェード`}
        >
          <TrendingUp size={big ? 14 : 12} />
          {fadeSec}s
        </button>
      </div>

      {triggerMode && (
        // 本番中のみ: 現在のフェーダー位置を取り込み直す（上書き）。
        <button
          onClick={() => window.dmx.overwriteAction(action.id)}
          disabled={liveFaderCount === 0}
          className="inline-flex items-center justify-center gap-0.5 rounded bg-neutral-900 py-0.5 text-[10px] text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
          title="現在のフェーダー位置でこの Action を上書き"
        >
          <RefreshCw size={10} /> 上書き
        </button>
      )}

      {editable && (
        <>
          {/* 名前を編集（クリックでインライン入力）。 */}
          <InlineText
            value={action.name ?? ''}
            placeholder="名前を入力"
            editable
            onCommit={(v) => window.dmx.updateAction(action.id, { name: v })}
            className="w-full px-1 py-0.5 text-center text-[11px]"
            title="クリックで Action 名を編集"
          />
          <div className="flex items-center gap-1">
            <span className="flex-1 truncate text-[10px] text-neutral-500" title={`${chCount} ch`}>
              {selected ? '編集中・フェーダーで作成' : `${chCount} ch`}
            </span>
            {/* 右下の小さな編集選択ボタン（クリックで選択/解除）。 */}
            <button
              onClick={() =>
                selected
                  ? window.dmx.deselectAction()
                  : window.dmx.selectActionForEdit(action.id)
              }
              className={`inline-flex items-center rounded px-1 py-0.5 ${
                selected
                  ? 'bg-sky-600 text-white'
                  : 'text-neutral-400 hover:bg-neutral-700 hover:text-sky-300'
              }`}
              title={selected ? '編集対象を解除' : '編集対象に選択（フェーダーで look を作成）'}
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Action「${action.name || 'Action'}」を削除しますか？`))
                  window.dmx.deleteAction(action.id);
              }}
              className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-red-900/50 hover:text-red-300"
              title="Action 削除"
            >
              <X size={12} />
            </button>
          </div>
        </>
      )}

      {!editable && (
        <div className="text-center text-[10px] text-neutral-500">{chCount} ch</div>
      )}
    </div>
  );
}
