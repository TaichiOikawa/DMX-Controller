/**
 * セットリスト再生パネル（中央）。読込中セットリストの Show エントリを縦1本で表示し、
 * 単一の「マスター GO」で先頭から順に「Show をロード＋その Timeline を頭から再生」する。
 * 各行クリックで setlistGoTo（頭出し）。EDIT モードでは並び替え・追加・削除ができる。
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Music2,
  Play,
  Plus,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDmxStore } from "../store";

export function SetlistPanel() {
  const project = useDmxStore((s) => s.project);
  const activeSetlistId = useDmxStore((s) => s.activeSetlistId);
  const setlistIndex = useDmxStore((s) => s.setlistIndex);
  const setlistGo = useDmxStore((s) => s.setlistGo);
  const setlistGoTo = useDmxStore((s) => s.setlistGoTo);
  const setlistReset = useDmxStore((s) => s.setlistReset);
  const editable = useDmxStore((s) => s.mode === "edit");
  const [adding, setAdding] = useState(false);

  // 現在行が変わったらスクロール表示する。
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (setlistIndex < 0) return;
    const el = listRef.current?.querySelector('[data-current="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [setlistIndex]);

  const setlist = project?.setlists?.find((s) => s.id === activeSetlistId) ?? null;

  if (!setlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg bg-neutral-900/40 text-sm text-neutral-600 ring-1 ring-neutral-800">
        <p>セットリストが読み込まれていません</p>
        <p className="mt-1 text-xs">左のサイドバーでセットリストを「読込」してください</p>
      </div>
    );
  }

  const entries = setlist.entries;
  const showName = (showId: string) =>
    project?.shows.find((s) => s.id === showId)?.name ?? "（削除済み）";
  const nextIndex = setlistIndex + 1;
  const curName = setlistIndex >= 0 ? showName(entries[setlistIndex]?.showId ?? "") : "—";
  const nextName = nextIndex < entries.length ? showName(entries[nextIndex].showId) : "（終端）";

  return (
    <div className="flex h-full flex-col gap-2">
      {/* グローバル操作 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setlistGoTo(setlistIndex - 1)}
          disabled={setlistIndex <= 0}
          className="inline-flex items-center gap-1 rounded bg-neutral-700 px-4 py-2 text-base font-bold text-neutral-100 shadow hover:bg-neutral-600 disabled:opacity-30"
          title="前の Show へ"
        >
          <ChevronLeft size={18} /> BACK
        </button>
        <button
          onClick={setlistGo}
          disabled={nextIndex >= entries.length}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-8 py-2 text-base font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-30"
          title="次の Show をロードして Timeline を再生（Space/→）"
        >
          GO <Play size={18} fill="currentColor" />
        </button>
        <button
          onClick={setlistReset}
          disabled={setlistIndex < 0}
          className="inline-flex items-center gap-1 rounded bg-neutral-700 px-3 py-2 text-sm font-bold text-neutral-100 shadow hover:bg-neutral-600 disabled:opacity-30"
          title="頭出し前（未開始）へ戻す"
        >
          <Square size={14} fill="currentColor" /> リセット
        </button>
        <div className="ml-1 flex min-w-0 flex-col text-xs leading-tight">
          <span className="truncate text-neutral-300">
            <span className="text-neutral-500">現在:</span> {curName}
          </span>
          <span className="truncate text-neutral-500">次: {nextName}</span>
        </div>
        <span className="ml-auto text-sm text-neutral-400">
          {setlist.name}
          <span className="ml-2 font-mono text-xs text-neutral-600">
            {setlistIndex < 0 ? "–" : setlistIndex + 1} / {entries.length}
          </span>
        </span>
      </div>

      {/* Show エントリ列 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto rounded-lg bg-neutral-900/60 p-2 ring-1 ring-neutral-800"
      >
        {entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-neutral-600">
            まだ空です。{editable ? "下の「＋ Show を追加」か、" : ""}サイドバーで Show を右クリック →
            「セットリストに追加」で登録してください。
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((entry, i) => {
              const current = setlistIndex === i;
              const hasTimeline =
                (project?.shows.find((s) => s.id === entry.showId)?.timeline?.points.length ?? 0) > 0;
              return (
                <li key={entry.id}>
                  <div
                    data-current={current || undefined}
                    onClick={() => setlistGoTo(i)}
                    className={`relative flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                      current
                        ? "bg-sky-800/50 ring-1 ring-sky-600"
                        : "bg-neutral-800/40 hover:bg-neutral-800"
                    }`}
                  >
                    <span className="w-6 text-right font-mono text-xs text-neutral-500">
                      {i + 1}
                    </span>
                    <Music2
                      size={14}
                      className={hasTimeline ? "shrink-0 text-emerald-400" : "shrink-0 text-neutral-600"}
                    />
                    <span className="min-w-0 flex-1 truncate text-neutral-200">
                      {showName(entry.showId)}
                    </span>
                    {editable && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex shrink-0 items-center gap-0.5"
                      >
                        <button
                          onClick={() =>
                            window.dmx.moveSetlistEntry(setlist.id, entry.id, i - 1)
                          }
                          disabled={i === 0}
                          className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
                          title="上へ"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() =>
                            window.dmx.moveSetlistEntry(setlist.id, entry.id, i + 1)
                          }
                          disabled={i === entries.length - 1}
                          className="inline-flex items-center rounded px-1 text-neutral-500 hover:bg-neutral-700 disabled:opacity-20"
                          title="下へ"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => window.dmx.removeFromSetlist(setlist.id, entry.id)}
                          className="inline-flex items-center rounded px-1 text-neutral-600 hover:bg-red-900/50 hover:text-red-300"
                          title="このエントリを削除"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Show 追加 */}
        {editable && (
          <div className="mt-2">
            {adding ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) window.dmx.addToSetlist(setlist.id, e.target.value);
                  setAdding(false);
                }}
                onBlur={() => setAdding(false)}
                className="w-full rounded bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 ring-1 ring-sky-500"
              >
                <option value="" disabled>
                  追加する Show を選択…
                </option>
                {(project?.shows ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-1 rounded bg-neutral-800 px-2 py-1.5 text-xs text-sky-300 hover:bg-neutral-700"
                title="Show をこのセットリストに追加"
              >
                <Plus size={13} /> Show を追加
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
