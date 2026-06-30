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

import { Pause, Play, Plus, Square, Volume2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cueAt } from "../../../engine/playback";
import { AUDIO_TRACK_COUNT } from "../../../shared/types";
import { useDmxStore } from "../../store";
import { AudioRelinkModal } from "./AudioRelinkModal";
import { AudioTrack } from "./AudioTrack";
import { AudioTrackLane } from "./AudioTrackLane";
import { GoMarkers } from "./GoMarkers";
import { MixerHeader } from "./MixerHeader";
import { useAudioOutputDevices } from "./useAudioOutputDevices";
import { Playhead } from "./Playhead";
import { TimeRuler } from "./TimeRuler";
import {
  cueOptions,
  formatTimecode,
  snapMs,
  timeToPx,
  type CueLabelMode,
} from "./utils";

/** 左ヘッダ列の幅（px）。全トラックの t=0 をここで揃える。 */
const HEADER_W = 144;

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
  const audioFileStatus = useDmxStore((s) => s.audioFileStatus);
  const audioDevices = useAudioOutputDevices();

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
  const audioTracks = show?.timeline?.audioTracks ?? [];
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

  // メイン音声のミキサー値（音量/ミュート/ソロ）。
  const mainVol = show?.audio?.volume ?? 1;
  const mainMuted = show?.audio?.muted ?? false;
  const mainSolo = show?.audio?.solo ?? false;
  const setMainProps = (props: {
    volume?: number;
    muted?: boolean;
    solo?: boolean;
    outputDeviceId?: string | null;
  }) => {
    if (activeShowId) window.dmx.setMainAudioProps(activeShowId, props);
  };
  const setTrackProps = (
    i: number,
    props: { volume?: number; muted?: boolean; solo?: boolean; outputDeviceId?: string | null },
  ) => {
    if (activeShowId) window.dmx.setAudioTrackProps(activeShowId, i, props);
  };

  // ＋音声: ファイルを選び、尺をデコードで確定してから現在位置へクリップ追加。
  const addClipToTrack = async (i: number) => {
    if (!activeShowId) return;
    const res = await window.dmx.pickAudioClip();
    if (!res.ok || !res.path) return;
    const file = await window.dmx.readAudioFile(res.path);
    if (!file.ok || !file.data) return;
    let clipMs: number;
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(file.data);
      clipMs = Math.round(buf.duration * 1000);
      void ctx.close();
    } catch {
      return;
    }
    window.dmx.addAudioClip(activeShowId, i, res.path, snapMs(transport.playheadMs), clipMs);
  };

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
        // Blob は res.data をコピーするため先に生成する（直後の decodeAudioData が
        // ArrayBuffer を detach するため。WaveSurfer 表示用 URL は影響を受けない）。
        const url = URL.createObjectURL(
          new Blob([res.data], { type: mimeFor(filePath) }),
        );
        createdUrl = url;
        setAudioUrl(url);
        loadAudio(url, res.data);
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
    // 左ヘッダ列ぶんオフセットした実 x 座標で判定する。
    const headPx = HEADER_W + timeToPx(transport.playheadMs, scale);
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
          {/* 音量モニター（別ウインドウ） */}
          <button
            onClick={() => window.dmx.openMonitor()}
            className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-700"
            title="音量モニターを別ウインドウで開く"
          >
            <Volume2 size={12} /> モニター
          </button>
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

      {/* トラックビュー（左ヘッダ列 + 横スクロールの時間軸エリア。t=0 を全トラックで揃える） */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          savedScrollLeft.current = e.currentTarget.scrollLeft;
        }}
        className="min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-900/60 ring-1 ring-neutral-800"
      >
        <div className="flex" style={{ width: HEADER_W + contentWidth, minWidth: "100%" }}>
          {/* 左ヘッダ列（横スクロールでも左端に固定） */}
          <div
            className="sticky left-0 z-40 shrink-0 border-r border-neutral-800 bg-neutral-900"
            style={{ width: HEADER_W }}
          >
            {/* ルーラー分のスペーサ */}
            <div className="h-7 border-b border-neutral-700 bg-neutral-800" />
            {/* GO */}
            <div className="flex h-12 items-center border-b border-neutral-800 px-2 text-[11px] font-medium text-neutral-400">
              GO
            </div>
            {/* メイン音声 */}
            <div className="h-20 border-b border-neutral-800">
              <MixerHeader
                name="メイン"
                volume={mainVol}
                muted={mainMuted}
                solo={mainSolo}
                onVolume={(v) => setMainProps({ volume: v })}
                onToggleMute={() => setMainProps({ muted: !mainMuted })}
                onToggleSolo={() => setMainProps({ solo: !mainSolo })}
                onAdd={() => activeShowId && void window.dmx.pickShowAudio(activeShowId)}
                addDisabled={!loaded}
                onDelete={() => {
                  if (activeShowId && window.confirm("メイン音声を削除しますか？"))
                    window.dmx.clearShowAudio(activeShowId);
                }}
                canDelete={!!filePath}
                devices={audioDevices}
                deviceId={show?.audio?.outputDeviceId ?? ""}
                onDevice={(id) => setMainProps({ outputDeviceId: id || null })}
                disabled={!filePath}
              />
            </div>
            {/* 追加トラック */}
            {Array.from({ length: AUDIO_TRACK_COUNT }, (_, i) => (
              <div key={i} className="h-20 border-b border-neutral-800">
                <MixerHeader
                  name={audioTracks[i]?.name ?? `Track ${i + 1}`}
                  volume={audioTracks[i]?.volume ?? 1}
                  muted={audioTracks[i]?.muted ?? false}
                  solo={audioTracks[i]?.solo ?? false}
                  onVolume={(v) => setTrackProps(i, { volume: v })}
                  onToggleMute={() => setTrackProps(i, { muted: !(audioTracks[i]?.muted ?? false) })}
                  onToggleSolo={() => setTrackProps(i, { solo: !(audioTracks[i]?.solo ?? false) })}
                  onAdd={() => void addClipToTrack(i)}
                  addDisabled={!editable}
                  onDelete={() => {
                    if (
                      activeShowId &&
                      window.confirm(
                        `${audioTracks[i]?.name ?? `Track ${i + 1}`} の音声を全て削除しますか？`,
                      )
                    )
                      window.dmx.clearAudioTrack(activeShowId, i);
                  }}
                  canDelete={editable && (audioTracks[i]?.clips.length ?? 0) > 0}
                  devices={audioDevices}
                  deviceId={audioTracks[i]?.outputDeviceId ?? ""}
                  onDevice={(id) => setTrackProps(i, { outputDeviceId: id || null })}
                />
              </div>
            ))}
          </div>

          {/* 時間軸エリア（クリップ・マーカー・波形・プレイヘッド。relative=配置基準） */}
          <div className="relative shrink-0" style={{ width: contentWidth }}>
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

            {/* メイン音声トラック（時刻0固定・マスター） */}
            <div className="relative flex h-20 items-center border-b border-neutral-800 p-1">
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

            {/* 追加オーディオトラック（複数クリップ） */}
            {Array.from({ length: AUDIO_TRACK_COUNT }, (_, i) => (
              <AudioTrackLane
                key={i}
                showId={activeShowId ?? ""}
                trackIndex={i}
                track={audioTracks[i]}
                scale={scale}
                editable={editable}
                audioFileStatus={audioFileStatus}
                onSeek={seek}
              />
            ))}

            {/* プレイヘッド（時間軸エリアの全高オーバーレイ） */}
            <Playhead
              playheadMs={transport.playheadMs}
              durationMs={durationMs}
              scale={scale}
              onSeek={seek}
            />
          </div>
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
