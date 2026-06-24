/**
 * Timeline タブ本体（§5.5・内部タイムコード）。
 * リファレンス（DMX-TimelineController）の横スクロール・トラックビューを、本プロジェクトの
 * 「GO点モデル」に合わせて再構成したもの:
 *   - ルーラー / 赤プレイヘッド / ズーム
 *   - GO ポイントをマーカー表示（クリック=シーク・ドラッグ=移動・✕=削除）
 *   - WaveSurfer 音声波形＋プレイヘッド同期再生（実再生はストアの <audio>）
 *
 * トランスポート（再生/シーク/停止）と音声クロックはストアが所有する。
 */

import { Music, Pause, Play, Plus, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cueAt } from "../../../engine/playback";
import { useDmxStore } from "../../store";
import { AudioRelinkModal } from "./AudioRelinkModal";
import { AudioTrack } from "./AudioTrack";
import { GoMarkers } from "./GoMarkers";
import { Playhead } from "./Playhead";
import { TimeRuler } from "./TimeRuler";
import {
  cueOptions,
  formatTimecode,
  timeToPx,
  type CueLabelMode,
} from "./utils";

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    default:
      return "audio/*";
  }
}

export function TimelineView({ active }: { active: boolean }) {
  const project = useDmxStore((s) => s.project);
  const activeShowId = useDmxStore((s) => s.activeShowId);
  const transport = useDmxStore((s) => s.transport);
  const play = useDmxStore((s) => s.transportPlay);
  const pause = useDmxStore((s) => s.transportPause);
  const stop = useDmxStore((s) => s.transportStop);
  const seek = useDmxStore((s) => s.transportSeek);
  const loadAudio = useDmxStore((s) => s.loadAudio);
  const unloadAudio = useDmxStore((s) => s.unloadAudio);
  const playback = useDmxStore((s) => s.playback);
  const editable = useDmxStore((s) => s.mode === "edit");

  const [zoom, setZoom] = useState(1);
  const [labelMode, setLabelMode] = useState<CueLabelMode>("lyrics");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMs, setAudioMs] = useState(0);
  // 音声ファイルが読み込めなかった（移動/リネーム/削除された）状態と、再リンクモーダルを
  // 一旦閉じたかどうか。filePath が変わるたびにリセットして再プロンプトする。
  const [audioMissing, setAudioMissing] = useState(false);
  const [relinkDismissed, setRelinkDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // タブ非表示（display:none）でスクロール位置がリセットされても復元できるよう保持する。
  const savedScrollLeft = useRef(0);

  const show = project?.shows.find((s) => s.id === activeShowId) ?? null;
  const points = show?.timeline?.points ?? [];
  const filePath = show?.audio?.filePath ?? null;
  const loaded = show !== null;
  const cues = useMemo(
    () => (show ? cueOptions(show.sequence, labelMode) : []),
    [show, labelMode],
  );
  // 「＋点」で新規ポイントに紐づける既定 CUE = 現在選択中（プレイヘッド位置）の CUE。
  const selectedCueId =
    show && (playback?.mainIndex ?? -1) >= 0
      ? (cueAt(show.sequence, {
          main: playback!.mainIndex,
          sub: playback!.subIndex,
        })?.id ?? undefined)
      : undefined;
  const scale = useMemo(() => ({ zoom }), [zoom]);
  const durationMs = Math.max(transport.durationMs, audioMs);

  // 音声ファイルが設定されたらバイト列を取得して Blob URL 化、ストアの <audio> へ読み込む。
  // setState は非同期コールバックと cleanup でのみ呼ぶ（同期 setState によるカスケード再描画を回避）。
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (filePath) {
      window.dmx.readAudioFile(filePath).then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          // ファイルが見つからない/読めない → 再リンクを促す。
          setAudioMissing(true);
          return;
        }
        setAudioMissing(false);
        const url = URL.createObjectURL(
          new Blob([res.data], { type: mimeFor(filePath) }),
        );
        createdUrl = url;
        setAudioUrl(url);
        loadAudio(url);
      });
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setAudioUrl(null);
      setAudioMs(0);
      // filePath が変わったら欠損状態と「閉じた」フラグをリセットして再プロンプトできるようにする。
      setAudioMissing(false);
      setRelinkDismissed(false);
      unloadAudio();
    };
  }, [filePath, loadAudio, unloadAudio]);

  // 再生中、プレイヘッドが表示域の右端を超えたら追従スクロール。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !transport.playing) return;
    const headPx = timeToPx(transport.playheadMs, scale);
    const right = el.scrollLeft + el.clientWidth;
    if (headPx > right - 80 || headPx < el.scrollLeft) {
      el.scrollLeft = Math.max(0, headPx - el.clientWidth * 0.5);
    }
  }, [transport.playheadMs, transport.playing, scale]);

  // タブ表示に戻ったとき、保持していたスクロール位置を復元する（display:none 対策）。
  useLayoutEffect(() => {
    if (active && scrollRef.current)
      scrollRef.current.scrollLeft = savedScrollLeft.current;
  }, [active]);

  const contentWidth = timeToPx(durationMs, scale);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* トランスポート行 */}
      <div className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-3 py-2 ring-1 ring-neutral-800">
        <div className="flex items-center gap-1">
          {transport.playing ? (
            <button
              onClick={pause}
              disabled={!loaded}
              className="inline-flex items-center rounded bg-neutral-800 px-2.5 py-1 text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
              title="一時停止"
            >
              <Pause size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={play}
              disabled={!loaded}
              className="inline-flex items-center rounded bg-emerald-700 px-2.5 py-1 text-white hover:bg-emerald-600 disabled:opacity-40"
              title="再生"
            >
              <Play size={14} fill="currentColor" />
            </button>
          )}
          <button
            onClick={stop}
            disabled={!loaded}
            className="inline-flex items-center rounded bg-neutral-800 px-2.5 py-1 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
            title="停止（先頭へ）"
          >
            <Square size={14} fill="currentColor" />
          </button>
        </div>

        <span className="font-mono text-xs text-neutral-200">
          {formatTimecode(transport.playheadMs)}
        </span>
        <span className="font-mono text-[10px] text-neutral-500">
          / {formatTimecode(durationMs)}
        </span>
        <span className="text-[10px] text-neutral-600">
          Space: 再生/一時停止
        </span>

        <button
          onClick={() =>
            activeShowId &&
            window.dmx.addTimelinePoint(
              activeShowId,
              transport.playheadMs,
              selectedCueId,
            )
          }
          disabled={!editable}
          className="inline-flex items-center gap-0.5 rounded bg-neutral-800 px-2 py-1 text-[11px] text-amber-300 hover:bg-neutral-700 disabled:opacity-40"
          title={
            selectedCueId
              ? "現在位置に GO ポイントを追加（選択中の CUE に紐づけ）"
              : "現在位置に GO ポイントを追加（順送り。CUE を選択すると紐づきます）"
          }
        >
          <Plus size={12} /> GO点
        </button>

        <button
          onClick={() =>
            setLabelMode((m) => (m === "lyrics" ? "name" : "lyrics"))
          }
          className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
          title="GO点ラベルの表示を 歌詞 / CUE名 で切り替え"
        >
          ラベル切替
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* 音声 */}
          <button
            onClick={() =>
              activeShowId && window.dmx.pickShowAudio(activeShowId)
            }
            disabled={!loaded}
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-emerald-300 hover:bg-neutral-700 disabled:opacity-40"
            title="音声ファイルを選択"
          >
            <Music size={12} /> 音声
          </button>
          {filePath && (
            <button
              onClick={() =>
                activeShowId && window.dmx.clearShowAudio(activeShowId)
              }
              className="inline-flex items-center rounded px-1.5 py-1 text-neutral-500 hover:text-red-400"
              title="音声を解除"
            >
              <X size={12} />
            </button>
          )}
          {/* ズーム */}
          <span className="text-[10px] text-neutral-500">zoom</span>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-28 accent-sky-500"
          />
        </div>
      </div>

      {/* トラックビュー（横スクロール） */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          savedScrollLeft.current = e.currentTarget.scrollLeft;
        }}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg bg-neutral-900/60 ring-1 ring-neutral-800"
      >
        <div
          className="relative"
          style={{ width: contentWidth, minWidth: "100%" }}
        >
          <TimeRuler
            durationMs={durationMs}
            scale={scale}
            onSeek={seek}
            playing={transport.playing}
          />

          {/* GO トラック */}
          <div className="relative h-12 border-b border-neutral-800 bg-neutral-900/40">
            {!loaded && (
              <span className="absolute left-2 top-1.5 text-[11px] text-neutral-600">
                Show を読み込むと GO 点を編集できます
              </span>
            )}
            <GoMarkers
              showId={activeShowId ?? ""}
              points={points}
              cues={cues}
              durationMs={durationMs}
              scale={scale}
              editable={editable}
              onSeek={seek}
            />
          </div>

          {/* 音声トラック */}
          <div className="relative p-1">
            <AudioTrack
              audioUrl={audioUrl}
              scale={scale}
              onDurationMs={setAudioMs}
            />
            {audioMissing && (
              <div className="absolute inset-1 flex items-center gap-2 rounded bg-neutral-900/80 px-2 text-[11px] text-red-400 ring-1 ring-red-500/40">
                <span>音声ファイルが見つかりません</span>
                <button
                  onClick={() => setRelinkDismissed(false)}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-sky-300 hover:bg-neutral-700"
                >
                  再リンク
                </button>
              </div>
            )}
          </div>

          {/* プレイヘッド（全高オーバーレイ） */}
          <Playhead
            playheadMs={transport.playheadMs}
            durationMs={durationMs}
            scale={scale}
            onSeek={seek}
          />
        </div>
      </div>

      {/* 音声欠損時の再リンクモーダル（Timeline タブ表示中のみ） */}
      {active && audioMissing && !relinkDismissed && filePath && (
        <AudioRelinkModal
          filePath={filePath}
          onClose={() => setRelinkDismissed(true)}
          onRelink={() => {
            if (!activeShowId) return;
            // 別ファイルを選ぶと filePath が変わり読み込み useEffect が再走する。
            // 選択（ok）したらモーダルは閉じる。キャンセル時は警告を残す。
            window.dmx.pickShowAudio(activeShowId).then((res) => {
              if (res.ok) setRelinkDismissed(true);
            });
          }}
        />
      )}
    </div>
  );
}
