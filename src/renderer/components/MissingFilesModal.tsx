/**
 * 欠損音声ファイルの一括再リンクモーダル。
 *
 * Project を開いた直後の存在確認（main: findMissingFiles）で見つからなかった音声を
 * store.missingFiles が保持し、非 null のとき表示する。
 *   - 「フォルダを選択して自動マッチ」: 選んだフォルダ直下から同名ファイルを探して一括再リンク
 *   - 行ごとの「選択」: ファイル名が変わったものを個別に紐づけ直す（pickShowAudio）
 *
 * 各行の解決状態はライブ project から導出する（現在の audio.filePath が
 * 読込時の欠損パスと変われば「再リンク済み」）。再リンクは Engine がパスを更新して
 * project イベントを再ブロードキャストするため、表示は自動で更新される。
 */

import { AlertTriangle, FolderSearch } from "lucide-react";
import { useEffect } from "react";
import { useDmxStore } from "../store";

export function MissingFilesModal() {
  const missing = useDmxStore((s) => s.missingFiles);
  const setMissing = useDmxStore((s) => s.setMissingFiles);
  const project = useDmxStore((s) => s.project);

  // Esc で閉じる（表示中のみ）。
  useEffect(() => {
    if (!missing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMissing(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [missing, setMissing]);

  if (!missing) return null;

  // ライブ project から各行の現在パスと解決状態を導出する。
  const rows = missing.map((m) => {
    const currentPath = project?.shows.find((s) => s.id === m.showId)?.audio
      ?.filePath;
    return {
      ...m,
      currentPath,
      resolved: !!currentPath && currentPath !== m.filePath,
    };
  });
  const unresolved = rows.filter((r) => !r.resolved).length;

  const relinkFolder = async () => {
    const res = await window.dmx.relinkAudioFromFolder();
    if (res.error) alert(`再リンクに失敗しました: ${res.error}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setMissing(null)}
    >
      <div
        className="flex max-h-[88vh] w-[40rem] max-w-[92vw] flex-col rounded-xl bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400">
              音声ファイルが見つかりません
            </h2>
          </div>
          <button
            onClick={() => setMissing(null)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
        </div>

        {/* 本体 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <p className="mb-3 text-xs text-neutral-400">
            プロジェクトが参照する音声ファイルが見つかりませんでした。フォルダを選ぶと、
            その直下から同名ファイルを探して一括で再リンクします。見つからない分は行ごとに個別選択してください。
          </p>

          <button
            onClick={relinkFolder}
            className="mb-3 inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500"
          >
            <FolderSearch size={14} /> フォルダを選択して自動マッチ
          </button>

          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.showId}
                className="flex items-center gap-2 rounded bg-neutral-800/60 px-2.5 py-2"
              >
                <span
                  className={`shrink-0 text-xs ${
                    r.resolved ? "text-emerald-400" : "text-red-400"
                  }`}
                  title={r.resolved ? "再リンク済み" : "見つかりません"}
                >
                  {r.resolved ? "✓" : "✗"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-neutral-200">
                    {r.showName}
                  </div>
                  <div
                    className={`truncate font-mono text-[10px] ${
                      r.resolved ? "text-emerald-400/80" : "text-neutral-500"
                    }`}
                    title={r.resolved ? r.currentPath : r.filePath}
                  >
                    {r.resolved ? r.currentPath : r.filePath}
                  </div>
                </div>
                {!r.resolved && (
                  <button
                    onClick={() => window.dmx.pickShowAudio(r.showId)}
                    className="shrink-0 rounded bg-neutral-700 px-2 py-1 text-[11px] text-neutral-100 hover:bg-neutral-600"
                  >
                    選択…
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* フッタ */}
        <div className="flex items-center justify-between border-t border-neutral-800 px-5 py-2.5 text-[11px]">
          <span className="text-neutral-500">
            {unresolved === 0
              ? "すべて再リンクしました"
              : `未解決 ${unresolved} / ${rows.length} 件`}
          </span>
          <button
            onClick={() => setMissing(null)}
            className="rounded bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
}
