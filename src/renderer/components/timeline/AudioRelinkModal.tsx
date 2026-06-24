/**
 * 音声ファイル欠損時の再リンクモーダル。
 * Timeline の音声（Show.audio.filePath）が見つからない（移動/リネーム/削除）とき、
 * 別ファイルを選び直して紐づけ直すための小さなダイアログ。
 * 開閉は TimelineView のローカル状態から props 経由で制御する（ストアは使わない）。
 */

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

export function AudioRelinkModal({
  filePath,
  onRelink,
  onClose,
}: {
  filePath: string;
  onRelink: () => void;
  onClose: () => void;
}) {
  // Esc で閉じる（既存モーダルの idiom を踏襲）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[32rem] max-w-[90vw] rounded-xl bg-neutral-900 p-5 ring-1 ring-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-amber-400">
            音声ファイルが見つかりません
          </h2>
        </div>

        <p className="mb-2 text-xs text-neutral-400">
          紐づけられた音声ファイルを読み込めませんでした。移動・リネーム・削除された可能性があります。
          別のファイルを選んで紐づけ直してください。
        </p>
        <p className="mb-4 break-all rounded bg-neutral-800/80 px-2 py-1.5 font-mono text-[11px] text-neutral-300">
          {filePath}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            閉じる
          </button>
          <button
            onClick={onRelink}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500"
          >
            別ファイルを選択
          </button>
        </div>
      </div>
    </div>
  );
}
