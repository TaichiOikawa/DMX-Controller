/**
 * トップ操作バー。
 * モード切替（EDIT/SHOW）、保存状態表示、Undo/Redo、環境設定の起動。
 * Project の新規/保存/開く と Show の選択は左サイドツリーへ分離。
 */

import { Circle, Lock, Redo2, Settings, Undo2 } from "lucide-react";
import { useDmxStore } from "../store";

export function ProjectBar() {
  const mode = useDmxStore((s) => s.mode);
  const setMode = useDmxStore((s) => s.setMode);
  const dirty = useDmxStore((s) => s.dirty);
  const projectPath = useDmxStore((s) => s.projectPath);
  const canUndo = useDmxStore((s) => s.canUndo);
  const canRedo = useDmxStore((s) => s.canRedo);
  const setPrefsOpen = useDmxStore((s) => s.setPrefsOpen);

  const fileName = projectPath
    ? projectPath.replace(/^.*[\\/]/, "")
    : "New Project";

  const editable = mode === "edit";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
      {/* Undo/Redo */}
      <button
        onClick={() => window.dmx.undo()}
        disabled={!editable || !canUndo}
        className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        title="元に戻す（Ctrl+Z）"
      >
        <Undo2 size={13} /> 元に戻す
      </button>
      <button
        onClick={() => window.dmx.redo()}
        disabled={!editable || !canRedo}
        className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        title="やり直し（Ctrl+Shift+Z / Ctrl+Y）"
      >
        <Redo2 size={13} /> やり直し
      </button>

      <div className="mx-1 h-5 w-px bg-neutral-700" />

      {/* モードトグル */}
      <div className="flex overflow-hidden rounded ring-1 ring-neutral-700">
        <button
          onClick={() => setMode("edit")}
          className={`px-3 py-1 text-xs font-bold ${
            editable
              ? "bg-sky-600 text-white"
              : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
          }`}
          title="編集モード: フェーダーで CUE を直接編集"
        >
          EDIT
        </button>
        <button
          onClick={() => setMode("show")}
          className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-bold ${
            !editable
              ? "bg-amber-600 text-neutral-900"
              : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
          }`}
          title="本番モード: 編集ロック・フェーダーは一時上書き"
        >
          <Lock size={13} /> SHOW
        </button>
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-700" />

      {/* ファイル名 */}
      <span
        className={`flex items-center gap-1 text-xs ${dirty ? "text-amber-400" : "text-neutral-500"}`}
        title={dirty ? "未保存の変更があります" : "保存済み"}
      >
        <Circle size={10} fill={dirty ? "currentColor" : "none"} />
        <span
          className={`text-sm font-semibold ${dirty ? "text-amber-400" : "text-sky-400"}`}
        >
          {fileName}
        </span>
        {dirty && <span>(未保存)</span>}
      </span>

      <button
        onClick={() => setPrefsOpen(true)}
        className="ml-auto inline-flex items-center gap-1 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        title="環境設定（Ctrl+,）"
      >
        <Settings size={13} /> 環境設定
      </button>
    </div>
  );
}
