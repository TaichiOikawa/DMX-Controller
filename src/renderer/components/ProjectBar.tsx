/**
 * Project / Show 管理バー。
 * New Project / Save / Load（ファイル）、Show 選択・新規・読込・解放。
 */

import { useState } from 'react';
import { useDmxStore } from '../store';

export function ProjectBar() {
  const project = useDmxStore((s) => s.project);
  const selectedShowId = useDmxStore((s) => s.selectedShowId);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const selectShow = useDmxStore((s) => s.selectShow);
  const mode = useDmxStore((s) => s.mode);
  const setMode = useDmxStore((s) => s.setMode);
  const dirty = useDmxStore((s) => s.dirty);
  const projectPath = useDmxStore((s) => s.projectPath);
  const canUndo = useDmxStore((s) => s.canUndo);
  const canRedo = useDmxStore((s) => s.canRedo);
  const [busy, setBusy] = useState(false);

  const fileName = projectPath ? projectPath.replace(/^.*[\\/]/, '') : '未保存';

  const shows = project?.shows ?? [];
  const isLoaded = activeShowId !== null;
  const canLoad = selectedShowId !== null && selectedShowId !== activeShowId;
  const editable = mode === 'edit';

  const save = async () => {
    setBusy(true);
    const r = await window.dmx.saveProject();
    setBusy(false);
    if (r.error) alert(`保存に失敗しました: ${r.error}`);
  };

  const load = async () => {
    setBusy(true);
    const r = await window.dmx.loadProject();
    setBusy(false);
    if (r.error) alert(`読込に失敗しました: ${r.error}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
      {/* モードトグル */}
      <div className="flex overflow-hidden rounded ring-1 ring-neutral-700">
        <button
          onClick={() => setMode('edit')}
          className={`px-3 py-1 text-xs font-bold ${
            editable ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
          title="編集モード: フェーダーで CUE を直接編集"
        >
          EDIT
        </button>
        <button
          onClick={() => setMode('show')}
          className={`px-3 py-1 text-xs font-bold ${
            !editable ? 'bg-amber-600 text-neutral-900' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
          title="本番モード: 編集ロック・フェーダーは一時上書き"
        >
          🔒 SHOW
        </button>
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-700" />

      <span className="text-sm font-semibold text-sky-400">Project</span>
      <button
        onClick={() => window.dmx.newProject()}
        disabled={!editable}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
      >
        新規
      </button>
      <button
        onClick={save}
        disabled={busy}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
      >
        保存
      </button>
      <button
        onClick={load}
        disabled={busy}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
      >
        開く
      </button>
      <span
        className={`flex items-center gap-1 text-xs ${dirty ? 'text-amber-400' : 'text-neutral-500'}`}
        title={dirty ? '未保存の変更があります' : '保存済み'}
      >
        <span>{dirty ? '●' : '○'}</span>
        <span className="max-w-[16ch] truncate">{fileName}</span>
        {dirty && <span>(未保存)</span>}
      </span>

      <div className="mx-1 h-5 w-px bg-neutral-700" />

      <button
        onClick={() => window.dmx.undo()}
        disabled={!editable || !canUndo}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        title="元に戻す（Ctrl+Z）"
      >
        ↶ 元に戻す
      </button>
      <button
        onClick={() => window.dmx.redo()}
        disabled={!editable || !canRedo}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        title="やり直し（Ctrl+Shift+Z / Ctrl+Y）"
      >
        ↷ やり直し
      </button>

      <div className="mx-1 h-5 w-px bg-neutral-700" />

      <span className="text-sm font-semibold text-sky-400">Show</span>
      <select
        value={selectedShowId ?? ''}
        onChange={(e) => selectShow(e.target.value)}
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-sky-500"
      >
        {shows.length === 0 && <option value="">（Show なし）</option>}
        {shows.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.id === activeShowId ? ' ●' : ''}
          </option>
        ))}
      </select>
      <button
        onClick={() => window.dmx.newShow()}
        disabled={!editable}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-sky-300 hover:bg-neutral-700 disabled:opacity-40"
      >
        ＋ Show
      </button>
      <button
        onClick={() => selectedShowId && window.dmx.loadShow(selectedShowId)}
        disabled={!canLoad}
        className="rounded bg-sky-700 px-2.5 py-1 text-xs text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600"
      >
        読込
      </button>
      <button
        onClick={() => window.dmx.unloadShow()}
        disabled={!isLoaded}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
      >
        解放
      </button>
    </div>
  );
}
