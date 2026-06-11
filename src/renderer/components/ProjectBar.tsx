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
  const [busy, setBusy] = useState(false);

  const shows = project?.shows ?? [];
  const isLoaded = activeShowId !== null;
  const canLoad = selectedShowId !== null && selectedShowId !== activeShowId;

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
      <span className="text-sm font-semibold text-sky-400">Project</span>
      <button
        onClick={() => window.dmx.newProject()}
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
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
        className="rounded bg-neutral-800 px-2.5 py-1 text-xs text-sky-300 hover:bg-neutral-700"
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
